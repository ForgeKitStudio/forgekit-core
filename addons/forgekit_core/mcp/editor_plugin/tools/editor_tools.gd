extends RefCounted
## McpEditorTools — JSON-RPC handler adapter for the nine editor-channel
## Editor MCP tools.
##
##   editor.get_selection()                      → {selected}
##   editor.set_selection(node_paths)            → {selected}
##   editor.focus_node(node_path)                → {focused: true}
##   editor.get_output_log(max_lines?)           → {lines}
##   editor.get_errors()                         → {errors}
##   editor.clear_output()                       → {cleared: true}
##   editor.undo()                               → {undone, action_name}
##   editor.redo()                               → {redone, action_name}
##   editor.get_undo_stack(max?)                 → {entries}
##
## The adapter is intentionally thin. It translates by-name (Dictionary) and
## by-position (Array) JSON-RPC params into calls on an injected
## EditorEditorBackend. The backend wraps the production editor APIs
## (`EditorInterface.get_selection`, `EditorUndoRedoManager.undo/redo`, and a
## buffered ring that captures `push_error`/`push_warning` output) and is
## duck-typed so the adapter runs headlessly against a fake in tests.
##
## UPDATE_AVAILABLE integration
##
## Requirement 38.1 / design §11.6 mandate that when the MCP Server detects a
## newer ForgeKit_Core or `@forgekitstudio/core-mcp` release, it publishes an
## `UPDATE_AVAILABLE` entry into the editor output log so `editor.get_output_log`
## surfaces it to the caller alongside normal log lines. The canonical entry
## shape is produced by `build_update_available_entry(component, current, latest)`
## and the adapter forwards whatever the backend returns verbatim — no
## filtering, no transformation — so the same pipeline that carries engine
## logs also carries version notifications.
##
## Backends signal business-level failures (NON_UNDOABLE_OPERATION, ...) by
## returning `{"error": {...}}` envelopes. The adapter returns those verbatim
## so the JSON-RPC dispatcher can hoist them into top-level error responses.


class_name McpEditorTools


# Sentinel meaning "no upper bound" for the optional `max_lines` /
# `max` params. Backends interpret a negative cap as "return the full
# buffer" so callers can opt out of pagination without supplying the
# buffer size up-front.
const NO_LIMIT: int = -1


# Injected EditorEditorBackend (duck-typed). The adapter parses cleanly on
# headless builds without the editor types being available; the backend is
# only invoked through its public methods.
var _backend: Object = null


func _init(backend: Object = null) -> void:
	_backend = backend


func set_backend(backend: Object) -> void:
	_backend = backend


# ---------------------------------------------------------------------------
# MCP tool handlers.
# ---------------------------------------------------------------------------

func get_selection(_params: Variant) -> Variant:
	return _backend.get_selection()


func set_selection(params: Variant) -> Variant:
	var node_paths: Array = _get_array_param(params, "node_paths", 0, [])
	return _backend.set_selection(node_paths)


func focus_node(params: Variant) -> Variant:
	var node_path: String = _get_string_param(params, "node_path", 0, "")
	return _backend.focus_node(node_path)


func get_output_log(params: Variant) -> Variant:
	var max_lines: int = _get_int_param(params, "max_lines", 0, NO_LIMIT)
	return _backend.get_output_log(max_lines)


func get_errors(_params: Variant) -> Variant:
	return _backend.get_errors()


func clear_output(_params: Variant) -> Variant:
	return _backend.clear_output()


func undo(_params: Variant) -> Variant:
	return _backend.undo()


func redo(_params: Variant) -> Variant:
	return _backend.redo()


func get_undo_stack(params: Variant) -> Variant:
	var max_entries: int = _get_int_param(params, "max", 0, NO_LIMIT)
	return _backend.get_undo_stack(max_entries)


## Bulk-register all nine Editor MCP methods on the supplied dispatcher.
## Returns `self` so the caller can chain. Duck-types against
## `McpJsonRpcDispatcher.register_handler`.
func register_on(dispatcher: Object) -> Object:
	dispatcher.register_handler("editor.get_selection", Callable(self, "get_selection"))
	dispatcher.register_handler("editor.set_selection", Callable(self, "set_selection"))
	dispatcher.register_handler("editor.focus_node", Callable(self, "focus_node"))
	dispatcher.register_handler("editor.get_output_log", Callable(self, "get_output_log"))
	dispatcher.register_handler("editor.get_errors", Callable(self, "get_errors"))
	dispatcher.register_handler("editor.clear_output", Callable(self, "clear_output"))
	dispatcher.register_handler("editor.undo", Callable(self, "undo"))
	dispatcher.register_handler("editor.redo", Callable(self, "redo"))
	dispatcher.register_handler("editor.get_undo_stack", Callable(self, "get_undo_stack"))
	return self


# ---------------------------------------------------------------------------
# UPDATE_AVAILABLE entry builder (shared with the MCP Server via the
# publishing path; the shape is fixed by Requirement 38.1).
# ---------------------------------------------------------------------------

## Build the canonical `UPDATE_AVAILABLE` entry the MCP Server pushes into
## the editor output-log buffer when it detects a newer release. The entry
## flows through `editor.get_output_log` unchanged so callers can filter by
## `kind == "UPDATE_AVAILABLE"` to find version notifications.
static func build_update_available_entry(component: String, current: String, latest: String) -> Dictionary:
	return {
		"kind": "UPDATE_AVAILABLE",
		"severity": "info",
		"component": component,
		"current": current,
		"latest": latest,
	}


# ---------------------------------------------------------------------------
# Internals. Accept both by-name (Dictionary) and by-position (Array)
# JSON-RPC params conventions.
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


static func _get_int_param(params: Variant, key: String, index: int, default_value: int) -> int:
	if params is Dictionary:
		var dict: Dictionary = params as Dictionary
		if dict.has(key):
			var v: Variant = dict[key]
			if typeof(v) == TYPE_INT:
				return int(v)
			if typeof(v) == TYPE_FLOAT:
				return int(v)
	elif params is Array:
		var arr: Array = params as Array
		if index >= 0 and index < arr.size():
			var v: Variant = arr[index]
			if typeof(v) == TYPE_INT:
				return int(v)
			if typeof(v) == TYPE_FLOAT:
				return int(v)
	return default_value


static func _get_array_param(params: Variant, key: String, index: int, default_value: Array) -> Array:
	if params is Dictionary:
		var dict: Dictionary = params as Dictionary
		if dict.has(key):
			var v: Variant = dict[key]
			if v is Array:
				return v as Array
	elif params is Array:
		var arr: Array = params as Array
		if index >= 0 and index < arr.size():
			var v: Variant = arr[index]
			if v is Array:
				return v as Array
	return default_value
