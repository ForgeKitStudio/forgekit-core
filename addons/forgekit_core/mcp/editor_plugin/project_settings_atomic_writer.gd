extends RefCounted
## McpProjectSettingsAtomicWriter — performs atomic writes to `project.godot`
## and `.tres` files by running the sequence:
##     read → parse → modify → write-temp → fsync → rename
## as a single atomic operation.
##
## The writer parses the target file into a two-level dictionary keyed by
## `<section>` → `<key>` → `Variant` using Godot's `ConfigFile`. A flat
## `patch` dictionary keyed by `"<section>/<key>"` (or a nested
## `"<section>/<sub_path>"` path for dictionary values such as
## `"input/ui_accept/events"`) is then merged per-key: only the paths listed
## in `patch` are modified; every other key in the original file is
## preserved byte-for-byte at the ConfigFile level.
##
## Per-key merge is strict — the writer never replaces an entire section or
## an entire action entry. When a patch key targets a sub-path of a
## dictionary value (e.g. `input/ui_accept/events`) the writer loads the
## existing dictionary, sets the sub-path, and stores the merged dictionary
## back. This is the fix for the known tomyud1 `update_project_settings`
## bug where modifying `events` would overwrite the sibling `deadzone` and
## modifying any action would erase all other actions.
##
## Atomicity is guaranteed by writing to a sibling temp file `<path>.tmp`,
## flushing it (FileAccess.close flushes to the OS page cache; Godot's
## GDScript surface does not expose a lower-level fsync), then renaming the
## temp file over the target via `DirAccess.rename_absolute`. If any step
## fails, the temp sidecar is cleaned up and the original file is left
## untouched.
##
## The renamer is dependency-injected via `set_renamer()` so tests can
## simulate rename failures without mutating the filesystem or holding
## OS-level locks.


class_name McpProjectSettingsAtomicWriter


const MCP_ERROR_CODES: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/mcp_error_codes.gd")


# Renamer callable — `func(from_path: String, to_path: String) -> int` where
# the returned int follows `@GlobalScope.Error` conventions (OK on success).
# Defaults to `DirAccess.rename_absolute` but can be overridden in tests.
var _renamer: Callable = Callable(DirAccess, "rename_absolute")


func set_renamer(renamer: Callable) -> void:
	_renamer = renamer


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

## Parse a `project.godot`-style file into a two-level dictionary of
## `{section: {key: value}}`. Intended as a headless-testable helper so
## tests can assert the parser round-trips the fixture. Returns an empty
## dictionary if the file cannot be loaded.
static func parse(path: String) -> Dictionary:
	var cfg: ConfigFile = ConfigFile.new()
	var err: int = cfg.load(path)
	if err != OK:
		return {}
	var out: Dictionary = {}
	for section in cfg.get_sections():
		var section_dict: Dictionary = {}
		for key in cfg.get_section_keys(section):
			section_dict[key] = cfg.get_value(section, key)
		out[section] = section_dict
	return out


## Apply `patch` to `path` atomically. Returns either
## `{"applied": true, "keys_changed": [String, ...]}` on success, or
## `{"applied": false, "error": {code, message, data}}` on failure.
func update(path: String, patch: Dictionary) -> Dictionary:
	if not FileAccess.file_exists(path):
		return _fail(MCP_ERROR_CODES.FILE_NOT_FOUND, {"path": path})

	# 1) read + parse. ConfigFile.load handles the Godot INI-with-dict-values
	# format natively, including nested dictionaries for input actions.
	var cfg: ConfigFile = ConfigFile.new()
	var load_err: int = cfg.load(path)
	if load_err != OK:
		return _fail(MCP_ERROR_CODES.ATOMIC_WRITE_FAILED, {
			"path": path,
			"stage": "parse",
			"godot_error": load_err,
		})

	# 2) modify — apply each patch entry as a per-key merge.
	var keys_changed: Array = []
	for raw_key in patch.keys():
		var key_path: String = String(raw_key)
		var parts: PackedStringArray = key_path.split("/", false)
		if parts.size() < 2:
			return _fail(MCP_ERROR_CODES.ATOMIC_WRITE_FAILED, {
				"path": path,
				"stage": "modify",
				"key": key_path,
				"reason": "Patch key must be 'section/subkey[/sub_path...]'",
			})
		var section: String = parts[0]
		var value: Variant = patch[raw_key]
		_apply_patch_entry(cfg, section, parts, value)
		keys_changed.append(key_path)

	# 3) write-temp. Writing to a sibling `.tmp` keeps the rename on the same
	# filesystem, which is a precondition for the kernel-level atomic rename.
	var tmp_path: String = path + ".tmp"
	var save_err: int = cfg.save(tmp_path)
	if save_err != OK:
		_remove_if_exists(tmp_path)
		return _fail(MCP_ERROR_CODES.ATOMIC_WRITE_FAILED, {
			"path": path,
			"stage": "write-temp",
			"godot_error": save_err,
		})

	# 4) fsync — GDScript does not expose a direct fsync(2), but opening the
	# temp file and closing it forces FileAccess to release any buffered
	# writes held above the OS page cache boundary. This is the strongest
	# durability primitive available without engine-level changes.
	if not _flush_temp(tmp_path):
		_remove_if_exists(tmp_path)
		return _fail(MCP_ERROR_CODES.ATOMIC_WRITE_FAILED, {
			"path": path,
			"stage": "fsync",
		})

	# 5) rename — atomic on POSIX and on Windows when source and destination
	# live on the same volume.
	var rename_err: int = int(_renamer.call(tmp_path, path))
	if rename_err != OK:
		_remove_if_exists(tmp_path)
		return _fail(MCP_ERROR_CODES.ATOMIC_WRITE_FAILED, {
			"path": path,
			"stage": "rename",
			"godot_error": rename_err,
		})

	return {
		"applied": true,
		"keys_changed": keys_changed,
	}


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------

## Apply a single `patch` entry to `cfg`.
##
## Path disambiguation follows Godot's `project.godot` conventions:
##
##   - The first path component is always the section.
##   - In the `input` section (or when the first key after the section
##     already maps to a Dictionary value), the second component is the
##     key and any further components address a sub-path inside that
##     dictionary — e.g. `input/ui_accept/events` sets `events` inside the
##     `ui_accept` action dict without clobbering `deadzone`.
##   - Everywhere else the remainder (including any slashes) is a single
##     key, matching Godot's sub-keyed setting format — e.g.
##     `application/config/name` stores value at key `config/name` and
##     `rendering/textures/canvas_textures/default_texture_filter` stores
##     at key `textures/canvas_textures/default_texture_filter`.
func _apply_patch_entry(
	cfg: ConfigFile,
	section: String,
	parts: PackedStringArray,
	value: Variant
) -> void:
	if parts.size() == 2:
		cfg.set_value(section, parts[1], value)
		return

	var first_key: String = parts[1]
	if _is_dict_valued_key(cfg, section, first_key):
		# Sub-path inside an existing Dictionary value — typical of input
		# actions. Deep-duplicate the existing dict so the merge is
		# copy-on-write.
		var existing: Dictionary = cfg.get_value(section, first_key, {})
		var merged: Dictionary = existing.duplicate(true)
		_set_nested(merged, parts.slice(2), value)
		cfg.set_value(section, first_key, merged)
		return

	# Flat slash-bearing key (e.g. `config/name`,
	# `textures/canvas_textures/default_texture_filter`). Reassemble the
	# remainder as the actual key string.
	var joined_key: String = _join_from(parts, 1)
	cfg.set_value(section, joined_key, value)


## Treat `section/first_key` as a dict-valued entry when:
##   - the section is `input` (canonical input-map layout), OR
##   - the cfg already stores a Dictionary at `(section, first_key)`.
static func _is_dict_valued_key(cfg: ConfigFile, section: String, first_key: String) -> bool:
	if section == "input":
		return true
	if not cfg.has_section_key(section, first_key):
		return false
	return cfg.get_value(section, first_key, {}) is Dictionary


static func _join_from(parts: PackedStringArray, start_index: int) -> String:
	var out: String = ""
	for i in range(start_index, parts.size()):
		if i > start_index:
			out += "/"
		out += parts[i]
	return out


## Walk / create nested dictionaries along `path` and set the final key to
## `value`. Intermediate non-Dictionary values are overwritten with fresh
## dictionaries so the target path is always reachable.
static func _set_nested(root: Dictionary, path: PackedStringArray, value: Variant) -> void:
	var cursor: Dictionary = root
	for i in range(path.size() - 1):
		var key: String = path[i]
		var next: Variant = cursor.get(key, null)
		if not (next is Dictionary):
			next = {}
			cursor[key] = next
		cursor = next
	cursor[path[path.size() - 1]] = value


## Open the temp file for read and immediately close it. This forces the
## FileAccess layer to flush any buffered writes to the OS; it is the
## closest GDScript primitive to fsync(2). Returns false if the temp file
## cannot be opened, which indicates the write step failed silently.
static func _flush_temp(tmp_path: String) -> bool:
	var f: FileAccess = FileAccess.open(tmp_path, FileAccess.READ)
	if f == null:
		return false
	f.close()
	return true


static func _remove_if_exists(path: String) -> void:
	if FileAccess.file_exists(path):
		DirAccess.remove_absolute(path)


static func _fail(code: int, extra_data: Dictionary) -> Dictionary:
	return {
		"applied": false,
		"error": MCP_ERROR_CODES.make_error(code, extra_data),
	}
