extends RefCounted
## McpEditorResourceTools — JSON-RPC handler adapter for the six
## editor-channel Resource MCP tools.
##
##   resource.load(path)                        → {type, fields}
##   resource.save(path, fields)                → {path, size_bytes}
##   resource.inspect(path)                     → {type, fields, issues, suggested_fix?}
##   resource.apply_fix(path, fix)              → {applied, path} | {error}
##   resource.duplicate(from, to, transform?)   → {source, target, size_bytes}
##   resource.list_by_type(class_name, root?)   → {resources}
##
## The adapter is intentionally thin. It translates by-name (Dictionary) and
## by-position (Array) JSON-RPC params into calls on an injected
## EditorResourceBackend. The backend wraps the production editor APIs
## (`ResourceLoader`, `ResourceSaver`, the TresLoader schema validator, and
## the McpUndoRedoWrapper used by `resource.save` and `resource.apply_fix`)
## and is duck-typed so the adapter runs headlessly against a fake in tests.
##
## Self-healing contract for `resource.inspect` / `resource.apply_fix`:
##
## `resource.inspect(path)` surfaces detected issues as a list of
## `{kind, field, ...}` entries covering missing `ext_resource` targets,
## type mismatches, and absent required fields. When the backend can
## describe a deterministic repair it returns a `suggested_fix` object
## alongside the issues; the adapter forwards both verbatim so the AI agent
## can feed the suggested fix straight back into `resource.apply_fix(path, fix)`.
## The apply path routes through the UndoRedoWrapper inside the backend so a
## single Ctrl+Z undoes the repair.
##
## Backends signal business-level failures (FILE_NOT_FOUND,
## CORE_BOUNDARY_VIOLATION, ATOMIC_WRITE_FAILED, ...) by returning a
## Dictionary shaped `{"error": {...}}`. The adapter returns that envelope
## verbatim so the JSON-RPC dispatcher can hoist it into a top-level JSON-RPC
## error response.


class_name McpEditorResourceTools


# Injected EditorResourceBackend (duck-typed). Only invoked through its
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

func load(params: Variant) -> Variant:
	var path: String = _get_string_param(params, "path", 0, "")
	return _backend.load_resource(path)


func save(params: Variant) -> Variant:
	var path: String = _get_string_param(params, "path", 0, "")
	var fields: Dictionary = _get_dict_param(params, "fields", 1, {})
	return _backend.save_resource(path, fields)


func inspect(params: Variant) -> Variant:
	var path: String = _get_string_param(params, "path", 0, "")
	return _backend.inspect_resource(path)


func apply_fix(params: Variant) -> Variant:
	var path: String = _get_string_param(params, "path", 0, "")
	var fix: Dictionary = _get_dict_param(params, "fix", 1, {})
	return _backend.apply_fix(path, fix)


func duplicate(params: Variant) -> Variant:
	var from_path: String = _get_string_param(params, "from", 0, "")
	var to_path: String = _get_string_param(params, "to", 1, "")
	var transform: Variant = _get_variant_param(params, "transform", 2, null)
	return _backend.duplicate_resource(from_path, to_path, transform)


func list_by_type(params: Variant) -> Variant:
	var class_name_: String = _get_string_param(params, "class_name", 0, "")
	var root_path: String = _get_string_param(params, "root", 1, "")
	return _backend.list_by_type(class_name_, root_path)


## Bulk-register all six Resource MCP methods on the supplied dispatcher.
## Returns `self` so the caller can chain. Duck-types against
## `McpJsonRpcDispatcher.register_handler`.
func register_on(dispatcher: Object) -> Object:
	dispatcher.register_handler("resource.load", Callable(self, "load"))
	dispatcher.register_handler("resource.save", Callable(self, "save"))
	dispatcher.register_handler("resource.inspect", Callable(self, "inspect"))
	dispatcher.register_handler("resource.apply_fix", Callable(self, "apply_fix"))
	dispatcher.register_handler("resource.duplicate", Callable(self, "duplicate"))
	dispatcher.register_handler("resource.list_by_type", Callable(self, "list_by_type"))
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


static func _get_dict_param(params: Variant, key: String, index: int, default_value: Dictionary) -> Dictionary:
	if params is Dictionary:
		var dict: Dictionary = params as Dictionary
		if dict.has(key):
			var v: Variant = dict[key]
			if v is Dictionary:
				return v as Dictionary
	elif params is Array:
		var arr: Array = params as Array
		if index >= 0 and index < arr.size():
			var v: Variant = arr[index]
			if v is Dictionary:
				return v as Dictionary
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
