extends GutTest
## Unit tests for McpStateMachineTools: one editor-channel State Machine
## MCP tool on top of a duck-typed StateMachineBackend.
##
##   state_machine.list_states(tree_path, playback_param)  → {states}


const SM_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/tools/state_machine_tools.gd")
const DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")


class FakeStateMachineBackend:
	extends RefCounted

	var calls: Array = []

	func list_states(tree_path: String, playback_param: String) -> Variant:
		calls.append({"op": "list_states", "tree_path": tree_path, "playback_param": playback_param})
		return {"states": ["idle", "run", "attack"]}

	func find_calls(op: String) -> Array:
		var out: Array = []
		for c in calls:
			if (c as Dictionary).get("op", "") == op:
				out.append(c)
		return out


func _new_env() -> Dictionary:
	var backend: FakeStateMachineBackend = FakeStateMachineBackend.new()
	var tools: Object = SM_TOOLS_SCRIPT.new(backend)
	return {"backend": backend, "tools": tools}


func test_list_states_forwards_both_params() -> void:
	var env: Dictionary = _new_env()
	var result: Variant = (env["tools"] as Object).list_states({
		"tree_path": "/root/M/AT",
		"playback_param": "parameters/playback",
	})
	var call: Dictionary = (env["backend"] as FakeStateMachineBackend).find_calls("list_states")[0]
	assert_eq(call.get("tree_path", ""), "/root/M/AT", "tree_path forwarded")
	assert_eq(call.get("playback_param", ""), "parameters/playback", "playback_param forwarded")
	assert_true(((result as Dictionary).get("states", []) as Array).size() > 0, "states returned")


func test_register_on_wires_editor_state_machine_method() -> void:
	var env: Dictionary = _new_env()
	var dispatcher: Object = DISPATCHER_SCRIPT.new()
	(env["tools"] as Object).register_on(dispatcher)
	var resp: Dictionary = dispatcher.dispatch({
		"jsonrpc": "2.0",
		"method": "state_machine.list_states",
		"params": {},
		"id": 1,
	})
	assert_true(resp.has("result"), "state_machine.list_states must reach the adapter")
