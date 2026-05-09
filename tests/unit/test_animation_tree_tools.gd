extends GutTest
## Unit tests for McpAnimationTreeTools: four editor-channel AnimationTree
## MCP tools on top of a duck-typed AnimationTreeBackend.
##
##   animation_tree.create(scene_path, parent_path, anim_player_path)   (UndoRedo)
##   animation_tree.set_parameter(tree_path, parameter_path, value)     (UndoRedo)
##   animation_tree.get_parameters(tree_path)                           → {parameters}
##   animation_tree.set_active(tree_path, active)                       (UndoRedo)


const AT_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/tools/animation_tree_tools.gd")
const DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")


class FakeAnimationTreeBackend:
	extends RefCounted

	var calls: Array = []

	func create_tree(scene_path: String, parent_path: String, anim_player_path: String) -> Variant:
		calls.append({
			"op": "create_tree",
			"scene_path": scene_path,
			"parent_path": parent_path,
			"anim_player_path": anim_player_path,
		})
		return {"node_path": parent_path + "/AnimationTree"}

	func set_parameter(tree_path: String, parameter_path: String, value: Variant) -> Variant:
		calls.append({
			"op": "set_parameter",
			"tree_path": tree_path,
			"parameter_path": parameter_path,
			"value": value,
		})
		return {"applied": true}

	func get_parameters(tree_path: String) -> Variant:
		calls.append({"op": "get_parameters", "tree_path": tree_path})
		return {"parameters": [{"path": "parameters/blend_amount", "type": "float", "value": 0.5}]}

	func set_active(tree_path: String, active: bool) -> Variant:
		calls.append({"op": "set_active", "tree_path": tree_path, "active": active})
		return {"applied": true}

	func find_calls(op: String) -> Array:
		var out: Array = []
		for c in calls:
			if (c as Dictionary).get("op", "") == op:
				out.append(c)
		return out


func _new_env() -> Dictionary:
	var backend: FakeAnimationTreeBackend = FakeAnimationTreeBackend.new()
	var tools: Object = AT_TOOLS_SCRIPT.new(backend)
	return {"backend": backend, "tools": tools}


func test_create_forwards_all_params() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).create({
		"scene_path": "res://m.tscn",
		"parent_path": "/root/M",
		"anim_player_path": "/root/M/AnimationPlayer",
	})
	var call: Dictionary = (env["backend"] as FakeAnimationTreeBackend).find_calls("create_tree")[0]
	assert_eq(call.get("anim_player_path", ""), "/root/M/AnimationPlayer",
		"anim_player_path forwarded")


func test_set_parameter_forwards_value_verbatim() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).set_parameter({
		"tree_path": "/root/M/AnimationTree",
		"parameter_path": "parameters/blend_amount",
		"value": 0.75,
	})
	var call: Dictionary = (env["backend"] as FakeAnimationTreeBackend).find_calls("set_parameter")[0]
	assert_eq(call.get("parameter_path", ""), "parameters/blend_amount",
		"parameter_path forwarded")
	assert_eq(call.get("value", 0.0), 0.75, "value forwarded verbatim")


func test_get_parameters_returns_parameters() -> void:
	var env: Dictionary = _new_env()
	var result: Variant = (env["tools"] as Object).get_parameters({"tree_path": "/root/M/AT"})
	assert_true(((result as Dictionary).get("parameters", []) as Array).size() > 0,
		"parameters returned")


func test_set_active_forwards_active_flag() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).set_active({"tree_path": "/root/M/AT", "active": true})
	var call: Dictionary = (env["backend"] as FakeAnimationTreeBackend).find_calls("set_active")[0]
	assert_eq(call.get("active", false), true, "active flag forwarded")


func test_register_on_wires_all_four_animation_tree_methods() -> void:
	var env: Dictionary = _new_env()
	var dispatcher: Object = DISPATCHER_SCRIPT.new()
	(env["tools"] as Object).register_on(dispatcher)
	var expected: Array = [
		"animation_tree.create",
		"animation_tree.set_parameter",
		"animation_tree.get_parameters",
		"animation_tree.set_active",
	]
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
