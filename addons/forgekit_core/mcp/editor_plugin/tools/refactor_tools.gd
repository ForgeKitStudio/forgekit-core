extends RefCounted
## McpEditorRefactorTools — JSON-RPC handler adapter for the five
## editor-channel Refactor MCP tools.
##
##   refactor.rename_class(old_name, new_name)              → {files_changed}
##   refactor.rename_method(class_name, old, new)           → {files_changed}
##   refactor.move_file(from, to, update_refs?)             → {moved, refs_updated}
##   refactor.find_unused_assets(root?)                     → {unused}
##   refactor.organize_imports(path)                        → {modified}
##
## The adapter is intentionally thin. It translates by-name (Dictionary) and
## by-position (Array) JSON-RPC params into calls on an injected
## EditorRefactorBackend. The backend wraps the production editor APIs
## (Project_Settings_Atomic_Writer for safe writes to `project.godot`,
## EditorFileSystem for resource reference scans, and the UndoRedoWrapper
## so refactors land on the Undo stack) and is duck-typed so the adapter
## runs headlessly against a fake in tests.
##
## Rename contract (Requirements 35.3 / 35.4):
##
## `refactor.rename_class` scans every `.gd` and `.tscn` file under the
## project root, replaces matches for `old_name` with `new_name`, and
## returns the full list of touched files. `refactor.rename_method`
## rewrites call-site identifiers for the named class's method. Both
## walk through the UndoRedoWrapper so a single Ctrl+Z reverses every
## edit.
##
## Move contract (Requirement 35.5):
##
## `refactor.move_file` relocates a file from `from` to `to`. When
## `update_refs` is true the backend rewrites every `res://...` reference
## to the old path in `.tscn`, `.tres`, `.gd`, and `.cfg` files and
## returns the count of updated references alongside `moved = true`. When
## `update_refs` is false only the file itself is moved and callers are
## responsible for fixing references.
##
## Backends signal business-level failures (CORE_BOUNDARY_VIOLATION,
## FILE_NOT_FOUND, ATOMIC_WRITE_FAILED, ...) by returning a Dictionary
## shaped `{"error": {...}}`. This adapter returns that envelope verbatim
## so the JSON-RPC dispatcher can hoist it into a top-level JSON-RPC error
## response.


class_name McpEditorRefactorTools


# Injected EditorRefactorBackend (duck-typed). Only invoked through its
# public methods so the adapter parses cleanly on headless builds without
# editor types being available.
var _backend: Object = null


func _init(backend: Object = null) -> void:
	_backend = backend


func set_backend(backend: Object) -> void:
	_backend = backend


# ---------------------------------------------------------------------------
# MCP tool handlers.
# ---------------------------------------------------------------------------

func rename_class(params: Variant) -> Variant:
	var old_name: String = _get_string_param(params, "old_name", 0, "")
	var new_name: String = _get_string_param(params, "new_name", 1, "")
	return _backend.rename_class(old_name, new_name)


func rename_method(params: Variant) -> Variant:
	var class_name_: String = _get_string_param(params, "class_name", 0, "")
	var old_name: String = _get_string_param(params, "old", 1, "")
	var new_name: String = _get_string_param(params, "new", 2, "")
	return _backend.rename_method(class_name_, old_name, new_name)


func move_file(params: Variant) -> Variant:
	var from_path: String = _get_string_param(params, "from", 0, "")
	var to_path: String = _get_string_param(params, "to", 1, "")
	var update_refs: bool = _get_bool_param(params, "update_refs", 2, false)
	return _backend.move_file(from_path, to_path, update_refs)


func find_unused_assets(params: Variant) -> Variant:
	var root: String = _get_string_param(params, "root", 0, "")
	return _backend.find_unused_assets(root)


func organize_imports(params: Variant) -> Variant:
	var path: String = _get_string_param(params, "path", 0, "")
	return _backend.organize_imports(path)


## Bulk-register all five Refactor MCP methods on the supplied dispatcher.
## Returns `self` so the caller can chain. Duck-types against
## `McpJsonRpcDispatcher.register_handler`.
func register_on(dispatcher: Object) -> Object:
	dispatcher.register_handler("refactor.rename_class", Callable(self, "rename_class"))
	dispatcher.register_handler("refactor.rename_method", Callable(self, "rename_method"))
	dispatcher.register_handler("refactor.move_file", Callable(self, "move_file"))
	dispatcher.register_handler("refactor.find_unused_assets", Callable(self, "find_unused_assets"))
	dispatcher.register_handler("refactor.organize_imports", Callable(self, "organize_imports"))
	return self


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


static func _get_bool_param(params: Variant, key: String, index: int, default_value: bool) -> bool:
	if params is Dictionary:
		var dict: Dictionary = params as Dictionary
		if dict.has(key):
			var v: Variant = dict[key]
			if typeof(v) == TYPE_BOOL:
				return bool(v)
	elif params is Array:
		var arr: Array = params as Array
		if index >= 0 and index < arr.size():
			var v: Variant = arr[index]
			if typeof(v) == TYPE_BOOL:
				return bool(v)
	return default_value
