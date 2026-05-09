extends RefCounted
## McpStateMachineTools — JSON-RPC handler adapter for the one
## editor-channel State Machine MCP tool on top of a duck-typed
## StateMachineBackend.
##
##   state_machine.list_states(tree_path, playback_param)  → {states}
##
## The two runtime-channel State Machine tools (`state_machine.travel` and
## `state_machine.get_current`) live on the runtime dispatcher under
## `runtime_bridge/tools/state_machine_runtime_tools.gd`.


class_name McpStateMachineTools


var _backend: Object = null


func _init(backend: Object = null) -> void:
	_backend = backend


func set_backend(backend: Object) -> void:
	_backend = backend


# ---------------------------------------------------------------------------
# MCP tool handlers.
# ---------------------------------------------------------------------------

func list_states(params: Variant) -> Variant:
	var tree_path: String = _get_string_param(params, "tree_path", 0, "")
	var playback_param: String = _get_string_param(params, "playback_param", 1, "parameters/playback")
	return _backend.list_states(tree_path, playback_param)


## Register the one editor-channel State Machine MCP method on the
## supplied dispatcher. Returns `self` so the caller can chain.
func register_on(dispatcher: Object) -> Object:
	dispatcher.register_handler("state_machine.list_states", Callable(self, "list_states"))
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
