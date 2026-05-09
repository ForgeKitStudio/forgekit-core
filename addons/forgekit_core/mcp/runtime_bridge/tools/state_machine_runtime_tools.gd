extends RefCounted
## McpStateMachineRuntimeTools — JSON-RPC handler adapter for the two
## runtime-channel State Machine MCP tools on top of a duck-typed
## StateMachineRuntimeBackend.
##
##   state_machine.travel(tree_path, playback_param, state_name)  → {traveling: true}
##   state_machine.get_current(tree_path, playback_param)         → {state_name, progress}
##
## These tools require a running game launched with `--mcp-bridge`. The
## backend resolves the AnimationTree by node path and calls
## `AnimationNodeStateMachinePlayback.travel()` /
## `get_current_node()` + `get_current_play_position()`.


class_name McpStateMachineRuntimeTools


var _backend: Object = null


func _init(backend: Object = null) -> void:
	_backend = backend


func set_backend(backend: Object) -> void:
	_backend = backend


# ---------------------------------------------------------------------------
# MCP tool handlers.
# ---------------------------------------------------------------------------

func travel(params: Variant) -> Variant:
	var tree_path: String = _get_string_param(params, "tree_path", 0, "")
	var playback_param: String = _get_string_param(params, "playback_param", 1, "parameters/playback")
	var state_name: String = _get_string_param(params, "state_name", 2, "")
	return _backend.travel(tree_path, playback_param, state_name)


func get_current(params: Variant) -> Variant:
	var tree_path: String = _get_string_param(params, "tree_path", 0, "")
	var playback_param: String = _get_string_param(params, "playback_param", 1, "parameters/playback")
	return _backend.get_current(tree_path, playback_param)


## Bulk-register both runtime-channel State Machine MCP methods on the
## supplied dispatcher. Returns `self` so the caller can chain.
func register_on(dispatcher: Object) -> Object:
	dispatcher.register_handler("state_machine.travel", Callable(self, "travel"))
	dispatcher.register_handler("state_machine.get_current", Callable(self, "get_current"))
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
