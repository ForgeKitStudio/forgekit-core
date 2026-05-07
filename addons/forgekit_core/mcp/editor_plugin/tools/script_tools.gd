extends RefCounted
## McpEditorScriptTools — JSON-RPC handler adapter for the eight
## editor-channel Script MCP tools.
##
##   gdscript.validate(source)                          → {ok, errors, duration_ms}
##   gdscript.save_with_validation(path, source)        → {written, path} | {error}
##   script.load(path)                                  → {source}
##   script.create(path, source)                        → {created, path} | {error}
##   script.attach(scene_path, node_path, script_path)  → {attached, previous_script}
##   script.detach(scene_path, node_path)               → {detached, previous_script}
##   script.list_classes(path?)                         → {classes: [...]}
##   script.get_documentation(class_name)               → {documentation}
##
## The adapter is intentionally thin. It translates by-name (Dictionary) and
## by-position (Array) JSON-RPC params into calls on an injected
## EditorScriptBackend. The backend wraps the production editor APIs
## (McpScriptWriter, EditorInterface.reload_scripts, the UndoRedo wrapper for
## the three mutating tools `script.create`, `script.attach`, `script.detach`)
## and is duck-typed so the adapter runs headlessly against a fake in tests.
##
## Backends signal business-level failures (GDSCRIPT_SYNTAX_ERROR,
## CORE_BOUNDARY_VIOLATION, FILE_NOT_FOUND, ATOMIC_WRITE_FAILED) by returning
## `{"error": {...}}` envelopes. The adapter returns those verbatim so the
## JSON-RPC dispatcher can hoist them into top-level error responses.
##
## Smart_Type_Parser note: this adapter never parses source code or string
## literals itself. `gdscript.validate` feeds `source` directly into the
## backend's GDScriptValidator, which uses `GDScript.new().reload()` — a
## closed-grammar parser owned by the engine, never `eval()`.


class_name McpEditorScriptTools


# Injected EditorScriptBackend (duck-typed). Only invoked through its public
# methods so the adapter parses cleanly on headless builds without editor
# types being available.
var _backend: Object = null


func _init(backend: Object = null) -> void:
	_backend = backend


func set_backend(backend: Object) -> void:
	_backend = backend


# ---------------------------------------------------------------------------
# MCP tool handlers.
# ---------------------------------------------------------------------------

func gdscript_validate(params: Variant) -> Variant:
	var source: String = _get_string_param(params, "source", 0, "")
	return _backend.validate_source(source)


func save_with_validation(params: Variant) -> Variant:
	var path: String = _get_string_param(params, "path", 0, "")
	var source: String = _get_string_param(params, "source", 1, "")
	return _backend.save_with_validation(path, source)


func load(params: Variant) -> Variant:
	var path: String = _get_string_param(params, "path", 0, "")
	return _backend.load_script(path)


func create(params: Variant) -> Variant:
	var path: String = _get_string_param(params, "path", 0, "")
	var source: String = _get_string_param(params, "source", 1, "")
	return _backend.create_script(path, source)


func attach(params: Variant) -> Variant:
	var scene_path: String = _get_string_param(params, "scene_path", 0, "")
	var node_path: String = _get_string_param(params, "node_path", 1, "")
	var script_path: String = _get_string_param(params, "script_path", 2, "")
	return _backend.attach_script(scene_path, node_path, script_path)


func detach(params: Variant) -> Variant:
	var scene_path: String = _get_string_param(params, "scene_path", 0, "")
	var node_path: String = _get_string_param(params, "node_path", 1, "")
	return _backend.detach_script(scene_path, node_path)


func list_classes(params: Variant) -> Variant:
	var path: String = _get_string_param(params, "path", 0, "")
	return _backend.list_classes(path)


func get_documentation(params: Variant) -> Variant:
	var class_name_: String = _get_string_param(params, "class_name", 0, "")
	return _backend.get_documentation(class_name_)


## Bulk-register all eight Script MCP methods on the supplied dispatcher.
## Returns `self` so the caller can chain. Duck-types against
## `McpJsonRpcDispatcher.register_handler`.
func register_on(dispatcher: Object) -> Object:
	dispatcher.register_handler("gdscript.validate", Callable(self, "gdscript_validate"))
	dispatcher.register_handler("gdscript.save_with_validation", Callable(self, "save_with_validation"))
	dispatcher.register_handler("script.load", Callable(self, "load"))
	dispatcher.register_handler("script.create", Callable(self, "create"))
	dispatcher.register_handler("script.attach", Callable(self, "attach"))
	dispatcher.register_handler("script.detach", Callable(self, "detach"))
	dispatcher.register_handler("script.list_classes", Callable(self, "list_classes"))
	dispatcher.register_handler("script.get_documentation", Callable(self, "get_documentation"))
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
