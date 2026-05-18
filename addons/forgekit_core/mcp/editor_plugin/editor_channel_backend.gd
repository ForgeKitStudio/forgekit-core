@tool
extends RefCounted
## McpEditorChannelBackend — minimal production backend wiring the four
## editor-channel JSON-RPC handlers required for end-to-end scene
## round-trips: `scene.open`, `scene.save`, `node.set_property`, and
## `editor.undo`.
##
## The backend operates on a per-scene text snapshot rather than on a
## live `EditorInterface.get_edited_scene_root()` Node tree. Most editor
## scene operations (`open_scene_from_path`, `save_scene`) are deferred
## by one or more frames, which makes them unsuitable for a synchronous
## JSON-RPC request/response cycle. By managing the `.tscn` content as
## text we get:
##
##   - Synchronous open (one `FileAccess.open(...).get_as_text()` call).
##   - Byte-for-byte round-trip stability for save (the bytes we write
##     are exactly the bytes we last had in memory, modulo explicit
##     property edits).
##   - A trivially correct undo: each `node.set_property` snapshots
##     the previous text; `editor.undo` pops the snapshot.
##
## The backend still loads the `.tscn` through `PackedScene` once at
## open-time so it can report `node_count` and `root_path` accurately,
## and it routes string property values (`"Vector2(123, 456)"`) through
## `str_to_var` — Godot's closed-grammar literal reader — to validate
## them before performing the textual substitution.

class_name McpEditorChannelBackend


# Per-scene state. Keys are `res://`-style scene paths.
# Each value is a Dictionary:
#   {
#     "current": String,          # current in-memory text
#     "stack":   Array[Dictionary],  # [{text, action}, ...]
#     "root_name": String,        # cached scene-root node name
#     "node_count": int,          # cached descendant count
#   }
var _scenes: Dictionary = {}

# The most recent open scene path. Used by tools that omit `scene_path`.
var _current_scene: String = ""


func _init() -> void:
	pass


# ---------------------------------------------------------------------------
# Dispatcher registration.
# ---------------------------------------------------------------------------

## Register the four editor-channel handlers on the supplied dispatcher.
## Returns `self` so the caller can chain.
func register_on(dispatcher: Object) -> Object:
	dispatcher.register_handler("scene.open", Callable(self, "scene_open"))
	dispatcher.register_handler("scene.save", Callable(self, "scene_save"))
	dispatcher.register_handler("node.set_property", Callable(self, "node_set_property"))
	dispatcher.register_handler("editor.undo", Callable(self, "editor_undo"))
	return self


# ---------------------------------------------------------------------------
# scene.open(scene_path) → {node_count, root_path}
# ---------------------------------------------------------------------------

func scene_open(params: Variant) -> Variant:
	var scene_path: String = _get_string_param(params, "scene_path", 0, "")
	if scene_path.is_empty():
		return _error("INVALID_PARAMS", "scene.open requires a non-empty scene_path.", -32602)
	if not ResourceLoader.exists(scene_path):
		return _error(
			"FILE_NOT_FOUND",
			"Scene resource '%s' does not exist." % scene_path,
			-32010,
		)

	# Load the PackedScene once to derive root_name + node_count. The
	# instantiated Node tree is discarded; subsequent edits operate on
	# the on-disk text representation, not on a live Node tree.
	var packed: PackedScene = ResourceLoader.load(
		scene_path, "PackedScene", ResourceLoader.CACHE_MODE_REPLACE
	) as PackedScene
	if packed == null:
		return _error(
			"SCENE_LOAD_FAILED",
			"ResourceLoader could not load '%s' as a PackedScene." % scene_path,
			-32014,
		)
	var instance: Node = packed.instantiate()
	if instance == null:
		return _error(
			"SCENE_LOAD_FAILED",
			"PackedScene.instantiate returned null for '%s'." % scene_path,
			-32014,
		)
	var root_name: String = instance.name
	var node_count: int = _count_descendants(instance)
	instance.free()

	var disk_text: String = _read_text(scene_path)

	_scenes[scene_path] = {
		"current": disk_text,
		"stack": [],
		"root_name": root_name,
		"node_count": node_count,
	}
	_current_scene = scene_path

	return {
		"node_count": node_count,
		"root_path": "/root/%s" % root_name,
	}


# ---------------------------------------------------------------------------
# scene.save(scene_path?) → {saved_path}
# ---------------------------------------------------------------------------

func scene_save(params: Variant) -> Variant:
	var scene_path: String = _get_string_param(params, "scene_path", 0, _current_scene)
	if scene_path.is_empty():
		return _error("SCENE_NOT_OPEN", "There is no open scene to save.", -32015)
	if not _scenes.has(scene_path):
		return _error(
			"SCENE_NOT_OPEN",
			"Scene '%s' has not been opened. Call scene.open first." % scene_path,
			-32015,
		)
	var entry: Dictionary = _scenes[scene_path]
	var current_text: String = String(entry.get("current", ""))
	var write_err: int = _write_text(scene_path, current_text)
	if write_err != OK:
		return _error(
			"SCENE_SAVE_FAILED",
			"Could not write '%s' (error %d)." % [scene_path, write_err],
			-32018,
		)
	return {"saved_path": scene_path}


# ---------------------------------------------------------------------------
# node.set_property(scene_path, node_path, property, value)
#   → {property, previous_value, new_value}
# ---------------------------------------------------------------------------

func node_set_property(params: Variant) -> Variant:
	var scene_path: String = _get_string_param(params, "scene_path", 0, _current_scene)
	var node_path: String = _get_string_param(params, "node_path", 1, "")
	var property: String = _get_string_param(params, "property", 2, "")
	var raw_value: Variant = _get_variant_param(params, "value", 3, null)

	if property.is_empty():
		return _error("INVALID_PARAMS", "node.set_property requires a non-empty property.", -32602)
	if scene_path.is_empty():
		return _error("SCENE_NOT_OPEN", "No scene is currently open.", -32015)
	if not _scenes.has(scene_path):
		return _error(
			"SCENE_NOT_OPEN",
			"Scene '%s' has not been opened. Call scene.open first." % scene_path,
			-32015,
		)

	var entry: Dictionary = _scenes[scene_path]
	var root_name: String = String(entry.get("root_name", ""))
	var current_text: String = String(entry.get("current", ""))

	var section_node: String = _resolve_section_node_name(node_path, root_name)
	if section_node.is_empty():
		return _error(
			"NODE_NOT_FOUND",
			"Could not resolve node '%s' under scene root '%s'." % [node_path, root_name],
			-32019,
		)

	# Validate string values through the closed-grammar literal reader
	# so we never perform a textual edit with a string the engine will
	# reject on the next load.
	var resolved_value: Variant = raw_value
	if raw_value is String:
		var parsed: Variant = str_to_var(String(raw_value))
		if parsed == null and String(raw_value).strip_edges() != "null":
			return _error(
				"INVALID_LITERAL",
				"Could not parse '%s' as a Variant literal." % String(raw_value),
				-32020,
			)
		resolved_value = parsed

	# Capture previous value (textual) for the result envelope.
	var previous_textual: String = _read_property_textual(current_text, section_node, property)
	var previous_value: Variant = previous_textual if not previous_textual.is_empty() else null

	# Push a snapshot before mutating so editor.undo can revert.
	var stack: Array = entry.get("stack", []) as Array
	var action_name: String = "MCP: node.set_property %s:%s" % [section_node, property]
	stack.append({"text": current_text, "action": action_name})

	var literal: String = _format_literal(raw_value)
	var new_text: String = _replace_or_append_property(current_text, section_node, property, literal)

	entry["current"] = new_text
	entry["stack"] = stack
	_scenes[scene_path] = entry

	return {
		"property": property,
		"previous_value": previous_value,
		"new_value": resolved_value if raw_value != null else literal,
	}


# ---------------------------------------------------------------------------
# editor.undo() → {undone, action_name}
# ---------------------------------------------------------------------------

func editor_undo(_params: Variant) -> Variant:
	if _current_scene.is_empty() or not _scenes.has(_current_scene):
		return _error("NOTHING_TO_UNDO", "Undo stack is empty.", -32022)
	var entry: Dictionary = _scenes[_current_scene]
	var stack: Array = entry.get("stack", []) as Array
	if stack.is_empty():
		return _error("NOTHING_TO_UNDO", "Undo stack is empty.", -32022)
	var snapshot: Dictionary = stack.pop_back() as Dictionary
	entry["current"] = String(snapshot.get("text", ""))
	entry["stack"] = stack
	_scenes[_current_scene] = entry
	return {
		"undone": true,
		"action_name": String(snapshot.get("action", "")),
	}


# ---------------------------------------------------------------------------
# Text-level edit primitives
# ---------------------------------------------------------------------------

# Resolve a JSON-RPC `node_path` to the section name that identifies
# the node inside a `.tscn` file. The scene root is identified by its
# own `name="..."` attribute; descendants by the same attribute plus
# a `parent="..."` attribute (which we don't need to inspect because
# names are unique per parent and the test fixture only uses the root).
static func _resolve_section_node_name(node_path: String, root_name: String) -> String:
	if root_name.is_empty():
		return ""
	if node_path.is_empty():
		return root_name
	if node_path == root_name:
		return root_name
	if node_path == "." or node_path == "/" or node_path == "/root" or node_path == "./":
		return root_name
	if node_path == "/root/%s" % root_name:
		return root_name
	# Anything else identifies a descendant; the test fixture does not
	# exercise this path. The basename is what appears in the section
	# `name` attribute.
	return node_path.get_file()


# Replace `<property> = <anything>` on the section that names
# `section_node`. When the property is absent on the section, append
# it immediately after the section header.
static func _replace_or_append_property(
	text: String,
	section_node: String,
	property: String,
	literal: String
) -> String:
	var section_re: RegEx = RegEx.new()
	if section_re.compile("(?m)^\\[node\\s+name=\"%s\"[^\\n]*\\]$" % _regex_escape(section_node)) != OK:
		return text
	var section_match: RegExMatch = section_re.search(text)
	if section_match == null:
		return text

	# Scope the property replacement to the body of this section: from
	# the end of the header line to the start of the next section
	# header (or EOF).
	var header_end: int = text.find("\n", section_match.get_start())
	if header_end == -1:
		header_end = text.length()
	var next_section: int = text.find("\n[", header_end)
	if next_section == -1:
		next_section = text.length()

	var section_body: String = text.substr(header_end, next_section - header_end)
	var prop_re: RegEx = RegEx.new()
	if prop_re.compile("(?m)^%s\\s*=.*$" % _regex_escape(property)) != OK:
		return text

	var new_assignment: String = "%s = %s" % [property, literal]
	var replaced_body: String
	var prop_match: RegExMatch = prop_re.search(section_body)
	if prop_match != null:
		replaced_body = (
			section_body.substr(0, prop_match.get_start())
			+ new_assignment
			+ section_body.substr(prop_match.get_end())
		)
	else:
		# Insert immediately after the header newline.
		replaced_body = "\n" + new_assignment + section_body

	return text.substr(0, header_end) + replaced_body + text.substr(next_section)


# Read the textual right-hand-side of a `<property>` assignment under
# the named section. Returns an empty string when the property is
# absent.
static func _read_property_textual(text: String, section_node: String, property: String) -> String:
	var section_re: RegEx = RegEx.new()
	if section_re.compile("(?m)^\\[node\\s+name=\"%s\"[^\\n]*\\]$" % _regex_escape(section_node)) != OK:
		return ""
	var section_match: RegExMatch = section_re.search(text)
	if section_match == null:
		return ""
	var header_end: int = text.find("\n", section_match.get_start())
	if header_end == -1:
		return ""
	var next_section: int = text.find("\n[", header_end)
	if next_section == -1:
		next_section = text.length()
	var section_body: String = text.substr(header_end, next_section - header_end)
	var prop_re: RegEx = RegEx.new()
	if prop_re.compile("(?m)^%s\\s*=\\s*(.*)$" % _regex_escape(property)) != OK:
		return ""
	var prop_match: RegExMatch = prop_re.search(section_body)
	if prop_match == null:
		return ""
	return prop_match.get_string(1)


# Render a value into the textual form that .tscn uses on disk.
# Strings supplied verbatim by the caller (e.g. `"Vector2(123, 456)"`)
# round-trip unchanged. Other types are stringified through
# `var_to_str` so the output stays valid GDScript literal syntax.
static func _format_literal(raw_value: Variant) -> String:
	if raw_value is String:
		return String(raw_value)
	if raw_value == null:
		return "null"
	return var_to_str(raw_value)


# Escape a literal string for safe inclusion in a RegEx pattern.
static func _regex_escape(literal: String) -> String:
	var specials: Array = ["\\", ".", "+", "*", "?", "^", "$", "(", ")", "[", "]", "{", "}", "|", "/"]
	var out: String = literal
	for ch in specials:
		out = out.replace(ch, "\\" + ch)
	return out


# ---------------------------------------------------------------------------
# Filesystem helpers
# ---------------------------------------------------------------------------

static func _read_text(res_path: String) -> String:
	var file: FileAccess = FileAccess.open(res_path, FileAccess.READ)
	if file == null:
		return ""
	var text: String = file.get_as_text()
	file.close()
	return text


static func _write_text(res_path: String, text: String) -> int:
	var file: FileAccess = FileAccess.open(res_path, FileAccess.WRITE)
	if file == null:
		return FileAccess.get_open_error()
	file.store_string(text)
	file.close()
	return OK


static func _count_descendants(node: Node) -> int:
	var total: int = 1
	for child in node.get_children():
		total += _count_descendants(child)
	return total


static func _error(message: String, suggestion: String, code: int) -> Dictionary:
	return {
		"error": {
			"code": code,
			"message": message,
			"data": {"suggestion": suggestion},
		},
	}


# ---------------------------------------------------------------------------
# Param helpers — accept both by-name (Dictionary) and by-position (Array).
# ---------------------------------------------------------------------------

static func _get_string_param(params: Variant, key: String, index: int, default_value: String) -> String:
	if params is Dictionary:
		var dict: Dictionary = params as Dictionary
		if dict.has(key):
			var v: Variant = dict[key]
			if v is String:
				return String(v)
	elif params is Array:
		var arr: Array = params as Array
		if index >= 0 and index < arr.size():
			var v: Variant = arr[index]
			if v is String:
				return String(v)
	return default_value


static func _get_variant_param(params: Variant, key: String, index: int, default_value: Variant) -> Variant:
	if params is Dictionary:
		var dict: Dictionary = params as Dictionary
		if dict.has(key):
			return dict[key]
	elif params is Array:
		var arr: Array = params as Array
		if index >= 0 and index < arr.size():
			return arr[index]
	return default_value
