extends RefCounted
## McpRuntimeTimeTools — JSON-RPC handler adapter for the runtime-channel
## time-control MCP tools.
##
## Exposes four handlers that translate JSON-RPC calls into calls on an
## injected RuntimeTimeBackend. The backend is duck-typed so the adapter
## can run headlessly against a fake in unit tests while the production
## backend toggles `SceneTree.paused` and updates `Engine.time_scale`.
##
##   runtime.pause                         → {paused: true}
##   runtime.resume                        → {paused: false}
##   runtime.set_time_scale(scale)         → {time_scale, previous}
##   runtime.get_time_scale                → {time_scale}


class_name McpRuntimeTimeTools


# Injected RuntimeTimeBackend (duck-typed).
var _backend: Object = null


func _init(backend: Object = null) -> void:
	_backend = backend


func set_backend(backend: Object) -> void:
	_backend = backend


# ---------------------------------------------------------------------------
# MCP tool handlers.
# ---------------------------------------------------------------------------

func pause(_params: Variant) -> Variant:
	return _backend.pause()


func resume(_params: Variant) -> Variant:
	return _backend.resume()


func set_time_scale(params: Variant) -> Variant:
	var scale: float = _get_float_param(params, "scale", 0, 1.0)
	return _backend.set_time_scale(scale)


func get_time_scale(_params: Variant) -> Variant:
	return _backend.get_time_scale()


## Bulk-register all four runtime time-control MCP methods on the
## supplied dispatcher. Returns `self` so the caller can chain.
func register_on(dispatcher: Object) -> Object:
	dispatcher.register_handler("runtime.pause", Callable(self, "pause"))
	dispatcher.register_handler("runtime.resume", Callable(self, "resume"))
	dispatcher.register_handler("runtime.set_time_scale", Callable(self, "set_time_scale"))
	dispatcher.register_handler("runtime.get_time_scale", Callable(self, "get_time_scale"))
	return self


# ---------------------------------------------------------------------------
# Internals. Accept both by-name (Dictionary) and by-position (Array)
# JSON-RPC params conventions.
# ---------------------------------------------------------------------------

static func _get_float_param(params: Variant, key: String, index: int, default_value: float) -> float:
	if params is Dictionary:
		var dict: Dictionary = params as Dictionary
		if dict.has(key):
			var v: Variant = dict[key]
			if typeof(v) == TYPE_FLOAT:
				return float(v)
			if typeof(v) == TYPE_INT:
				return float(v)
	elif params is Array:
		var arr: Array = params as Array
		if index >= 0 and index < arr.size():
			var v: Variant = arr[index]
			if typeof(v) == TYPE_FLOAT:
				return float(v)
			if typeof(v) == TYPE_INT:
				return float(v)
	return default_value
