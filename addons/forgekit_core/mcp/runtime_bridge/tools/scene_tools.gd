extends RefCounted
## McpRuntimeSceneTools — JSON-RPC handler adapter for the runtime-channel
## Scene MCP tool.
##
## Exposes a single handler that translates JSON-RPC calls into calls on
## an injected RuntimeSceneBackend. The backend is duck-typed so the
## adapter can run headlessly against a fake in unit tests while the
## production backend walks the live SceneTree via
## `Engine.get_main_loop().current_scene` or similar.
##
##   scene.get_tree_snapshot(max_depth?) → {tree, ts}


class_name McpRuntimeSceneTools


# Injected RuntimeSceneBackend (duck-typed).
var _backend: Object = null


func _init(backend: Object = null) -> void:
	_backend = backend


func set_backend(backend: Object) -> void:
	_backend = backend


# ---------------------------------------------------------------------------
# MCP tool handlers.
# ---------------------------------------------------------------------------

func get_tree_snapshot(params: Variant) -> Variant:
	var max_depth: int = _get_int_param(params, "max_depth", 0, -1)
	return _backend.get_scene_tree_snapshot(max_depth)


## Register the runtime Scene MCP method on the supplied dispatcher.
## Returns `self` so the caller can chain.
func register_on(dispatcher: Object) -> Object:
	dispatcher.register_handler("scene.get_tree_snapshot", Callable(self, "get_tree_snapshot"))
	return self


# ---------------------------------------------------------------------------
# Internals.
# ---------------------------------------------------------------------------

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
