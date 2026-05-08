extends RefCounted
## McpRuntimeSceneControlTools — JSON-RPC handler adapter for the
## runtime-channel scene-control MCP tools.
##
## Exposes four handlers that translate JSON-RPC calls into calls on an
## injected RuntimeSceneControlBackend. The backend is duck-typed so the
## adapter can run headlessly against a fake in unit tests while the
## production backend drives `Engine.get_main_loop()` and
## `SceneTree.change_scene_to_file()` against the running game.
##
##   runtime.get_scene_tree(max_depth?)    → {tree}
##   runtime.get_current_scene             → {scene_path, root_path}
##   runtime.change_scene(scene_path)      → {changed: true}
##   runtime.reload_current_scene          → {reloaded: true}
##
## Note: `runtime.get_scene_tree` is the runtime-channel sibling of
## `scene.get_tree_snapshot`; Requirement 8.7 lists both as part of the
## runtime diagnostic surface, so they co-exist rather than one aliasing
## the other.


class_name McpRuntimeSceneControlTools


# Injected RuntimeSceneControlBackend (duck-typed).
var _backend: Object = null


func _init(backend: Object = null) -> void:
	_backend = backend


func set_backend(backend: Object) -> void:
	_backend = backend


# ---------------------------------------------------------------------------
# MCP tool handlers.
# ---------------------------------------------------------------------------

func get_scene_tree(params: Variant) -> Variant:
	var max_depth: int = _get_int_param(params, "max_depth", 0, -1)
	return _backend.get_scene_tree(max_depth)


func get_current_scene(_params: Variant) -> Variant:
	return _backend.get_current_scene()


func change_scene(params: Variant) -> Variant:
	var scene_path: String = _get_string_param(params, "scene_path", 0, "")
	return _backend.change_scene(scene_path)


func reload_current_scene(_params: Variant) -> Variant:
	return _backend.reload_current_scene()


## Bulk-register all four runtime scene-control MCP methods on the
## supplied dispatcher. Returns `self` so the caller can chain.
func register_on(dispatcher: Object) -> Object:
	dispatcher.register_handler("runtime.get_scene_tree", Callable(self, "get_scene_tree"))
	dispatcher.register_handler("runtime.get_current_scene", Callable(self, "get_current_scene"))
	dispatcher.register_handler("runtime.change_scene", Callable(self, "change_scene"))
	dispatcher.register_handler("runtime.reload_current_scene", Callable(self, "reload_current_scene"))
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
