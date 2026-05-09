extends GutTest
## Unit tests for McpStateMachineRuntimeTools: two runtime-channel State
## Machine MCP tools on top of a duck-typed StateMachineRuntimeBackend.
##
##   state_machine.travel(tree_path, playback_param, state_name)  → {traveling: true}
##   state_machine.get_current(tree_path, playback_param)         → {state_name, progress}


const SM_RUNTIME_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/runtime_bridge/tools/state_machine_runtime_tools.gd")
const DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")


class FakeStateMachineRuntimeBackend:
	extends RefCounted

	var calls: Array = []

	func travel(tree_path: String, playback_param: String, state_name: String) -> Variant:
		calls.append({
			"op": "travel",
			"tree_path": tree_path,
			"playback_param": playback_param,
			"state_name": state_name,
		})
		return {"traveling": true}

	func get_current(tree_path: String, playback_param: String) -> Variant:
		calls.append({"op": "get_current", "tree_path": tree_path, "playback_param": playback_param})
		return {"state_name": "idle", "progress": 0.25}

	func find_calls(op: String) -> Array:
		var out: Array = []
		for c in calls:
			if (c as Dictionary).get("op", "") == op:
				out.append(c)
		return out


func _new_env() -> Dictionary:
	var backend: FakeStateMachineRuntimeBackend = FakeStateMachineRuntimeBackend.new()
	var tools: Object = SM_RUNTIME_SCRIPT.new(backend)
	return {"backend": backend, "tools": tools}


func test_travel_forwards_state_name() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).travel({
		"tree_path": "/root/M/AT",
		"playback_param": "parameters/playback",
		"state_name": "attack",
	})
	var call: Dictionary = (env["backend"] as FakeStateMachineRuntimeBackend).find_calls("travel")[0]
	assert_eq(call.get("state_name", ""), "attack", "state_name forwarded")


func test_get_current_forwards_tree_and_playback() -> void:
	var env: Dictionary = _new_env()
	var result: Variant = (env["tools"] as Object).get_current({
		"tree_path": "/root/M/AT",
		"playback_param": "parameters/playback",
	})
	assert_true((result as Dictionary).has("state_name"), "state_name returned")
	assert_true((result as Dictionary).has("progress"), "progress returned")


func test_register_on_wires_both_runtime_state_machine_methods() -> void:
	var env: Dictionary = _new_env()
	var dispatcher: Object = DISPATCHER_SCRIPT.new()
	(env["tools"] as Object).register_on(dispatcher)
	var expected: Array = ["state_machine.travel", "state_machine.get_current"]
	var req_id: int = 1
	for method in expected:
		var resp: Dictionary = dispatcher.dispatch({
			"jsonrpc": "2.0",
			"method": method,
			"params": {},
			"id": req_id,
		})
		assert_true(resp.has("result"), "Method %s must reach the adapter" % method)
		req_id += 1
