extends RefCounted
## McpScene3dTools — JSON-RPC handler adapter for the six editor-channel
## 3D Scene MCP tools on top of a duck-typed Scene3dBackend.
##
##   scene3d.add_mesh_instance(scene_path, parent_path, mesh_path, transform?)  (UndoRedo)
##   scene3d.add_light(scene_path, parent_path, type, transform?, params?)      (UndoRedo)
##   scene3d.add_camera(scene_path, parent_path, transform?, params?)           (UndoRedo)
##   scene3d.set_environment(scene_path, env_path)                              (UndoRedo)
##   scene3d.bake_lightmap(scene_path, quality?)                                → {success, lightmap_path, duration_ms}
##   scene3d.import_gltf(source_path, target_path)                              (UndoRedo)
##
## `type` for `scene3d.add_light` is one of `directional`, `omni`, `spot`.
## `quality` for `scene3d.bake_lightmap` is one of `low`, `medium`
## (default), `high`. Lightmap baking can be long-running; the backend
## decides whether to block the caller or dispatch through a deferred
## callable.


class_name McpScene3dTools


const DEFAULT_BAKE_QUALITY: String = "medium"


var _backend: Object = null


func _init(backend: Object = null) -> void:
	_backend = backend


func set_backend(backend: Object) -> void:
	_backend = backend


# ---------------------------------------------------------------------------
# MCP tool handlers.
# ---------------------------------------------------------------------------

func add_mesh_instance(params: Variant) -> Variant:
	var scene_path: String = _get_string_param(params, "scene_path", 0, "")
	var parent_path: String = _get_string_param(params, "parent_path", 1, "")
	var mesh_path: String = _get_string_param(params, "mesh_path", 2, "")
	var transform: Variant = _get_variant_param(params, "transform", 3, null)
	return _backend.add_mesh_instance(scene_path, parent_path, mesh_path, transform)


func add_light(params: Variant) -> Variant:
	var scene_path: String = _get_string_param(params, "scene_path", 0, "")
	var parent_path: String = _get_string_param(params, "parent_path", 1, "")
	var type: String = _get_string_param(params, "type", 2, "omni")
	var transform: Variant = _get_variant_param(params, "transform", 3, null)
	var p: Dictionary = _get_dict_param(params, "params", 4, {})
	return _backend.add_light(scene_path, parent_path, type, transform, p)


func add_camera(params: Variant) -> Variant:
	var scene_path: String = _get_string_param(params, "scene_path", 0, "")
	var parent_path: String = _get_string_param(params, "parent_path", 1, "")
	var transform: Variant = _get_variant_param(params, "transform", 2, null)
	var p: Dictionary = _get_dict_param(params, "params", 3, {})
	return _backend.add_camera(scene_path, parent_path, transform, p)


func set_environment(params: Variant) -> Variant:
	var scene_path: String = _get_string_param(params, "scene_path", 0, "")
	var env_path: String = _get_string_param(params, "env_path", 1, "")
	return _backend.set_environment(scene_path, env_path)


func bake_lightmap(params: Variant) -> Variant:
	var scene_path: String = _get_string_param(params, "scene_path", 0, "")
	var quality: String = _get_string_param(params, "quality", 1, DEFAULT_BAKE_QUALITY)
	return _backend.bake_lightmap(scene_path, quality)


func import_gltf(params: Variant) -> Variant:
	var source_path: String = _get_string_param(params, "source_path", 0, "")
	var target_path: String = _get_string_param(params, "target_path", 1, "")
	return _backend.import_gltf(source_path, target_path)


## Bulk-register all six editor-channel 3D Scene MCP methods on the
## supplied dispatcher. Returns `self` so the caller can chain.
func register_on(dispatcher: Object) -> Object:
	dispatcher.register_handler("scene3d.add_mesh_instance", Callable(self, "add_mesh_instance"))
	dispatcher.register_handler("scene3d.add_light", Callable(self, "add_light"))
	dispatcher.register_handler("scene3d.add_camera", Callable(self, "add_camera"))
	dispatcher.register_handler("scene3d.set_environment", Callable(self, "set_environment"))
	dispatcher.register_handler("scene3d.bake_lightmap", Callable(self, "bake_lightmap"))
	dispatcher.register_handler("scene3d.import_gltf", Callable(self, "import_gltf"))
	return self


# ---------------------------------------------------------------------------
# Internals.
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
