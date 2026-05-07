extends RefCounted
## McpEditorSceneTools — JSON-RPC handler adapter for the editor-channel
## Scene MCP tools.
##
## Exposes eight handlers that translate JSON-RPC calls into calls on an
## injected EditorSceneBackend. The backend is duck-typed so the adapter
## can run headlessly against a fake in unit tests while the production
## backend wraps `EditorInterface.open_scene_from_path`, `EditorInterface.
## save_scene`, and similar editor APIs.
##
##   scene.open(scene_path)                    → {node_count, root_path}
##   scene.save(scene_path?)                   → {saved_path, size_bytes}
##   scene.save_as(scene_path, target_path)    → {saved_path}
##   scene.close(scene_path)                   → {closed: true}
##   scene.list_open()                         → {scenes: [...]}
##   scene.get_tree(scene_path?, max_depth?)   → {tree: {...}}
##   scene.instantiate(scene_path, parent_path, transform?) → {node_path}
##   scene.create(scene_path, root_type, root_name)         → {saved_path}
##
## Backends signal business-level failures (for example FILE_NOT_FOUND)
## by returning a Dictionary shaped `{"error": {...}}`. This adapter
## returns that envelope verbatim so the JSON-RPC dispatcher can hoist it
## into a top-level JSON-RPC error response.


class_name McpEditorSceneTools


# Injected EditorSceneBackend (duck-typed). The adapter parses headless
# without the editor types being available; the backend is only invoked
# via its public methods.
var _backend: Object = null


func _init(backend: Object = null) -> void:
	_backend = backend


func set_backend(backend: Object) -> void:
	_backend = backend


# ---------------------------------------------------------------------------
# MCP tool handlers.
# ---------------------------------------------------------------------------

func open(params: Variant) -> Variant:
	var scene_path: String = _get_string_param(params, "scene_path", 0, "")
	return _backend.open_scene(scene_path)


func save(params: Variant) -> Variant:
	var scene_path: String = _get_string_param(params, "scene_path", 0, "")
	return _backend.save_scene(scene_path)


func save_as(params: Variant) -> Variant:
	var scene_path: String = _get_string_param(params, "scene_path", 0, "")
	var target_path: String = _get_string_param(params, "target_path", 1, "")
	return _backend.save_scene_as(scene_path, target_path)


func close(params: Variant) -> Variant:
	var scene_path: String = _get_string_param(params, "scene_path", 0, "")
	return _backend.close_scene(scene_path)


func list_open(_params: Variant) -> Variant:
	return _backend.list_open_scenes()


func get_tree(params: Variant) -> Variant:
	var scene_path: String = _get_string_param(params, "scene_path", 0, "")
	var max_depth: int = _get_int_param(params, "max_depth", 1, -1)
	return _backend.get_scene_tree(scene_path, max_depth)


func instantiate(params: Variant) -> Variant:
	var scene_path: String = _get_string_param(params, "scene_path", 0, "")
	var parent_path: String = _get_string_param(params, "parent_path", 1, "")
	var transform: Variant = _get_variant_param(params, "transform", 2, null)
	return _backend.instantiate_scene(scene_path, parent_path, transform)


func create(params: Variant) -> Variant:
	var scene_path: String = _get_string_param(params, "scene_path", 0, "")
	var root_type: String = _get_string_param(params, "root_type", 1, "")
	var root_name: String = _get_string_param(params, "root_name", 2, "")
	return _backend.create_scene(scene_path, root_type, root_name)


## Bulk-register all eight Scene MCP methods on the supplied dispatcher.
## Returns `self` so the caller can chain. Duck-types against
## `McpJsonRpcDispatcher.register_handler`.
func register_on(dispatcher: Object) -> Object:
	dispatcher.register_handler("scene.open", Callable(self, "open"))
	dispatcher.register_handler("scene.save", Callable(self, "save"))
	dispatcher.register_handler("scene.save_as", Callable(self, "save_as"))
	dispatcher.register_handler("scene.close", Callable(self, "close"))
	dispatcher.register_handler("scene.list_open", Callable(self, "list_open"))
	dispatcher.register_handler("scene.get_tree", Callable(self, "get_tree"))
	dispatcher.register_handler("scene.instantiate", Callable(self, "instantiate"))
	dispatcher.register_handler("scene.create", Callable(self, "create"))
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
