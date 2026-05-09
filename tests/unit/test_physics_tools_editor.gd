extends GutTest
## Unit tests for McpPhysicsTools (editor-channel): three editor-channel
## Physics MCP tools on top of a duck-typed PhysicsBackend.
##
##   physics.set_gravity(vector)              — atomic project.godot write
##   physics.get_collision_layer_names()      → {layers}
##   physics.configure_layer(index, name, mask?)  — atomic project.godot write


const PHYSICS_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/tools/physics_tools.gd")
const DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")


class FakePhysicsBackend:
	extends RefCounted

	var calls: Array = []

	func set_gravity(vector: Variant) -> Variant:
		calls.append({"op": "set_gravity", "vector": vector})
		return {"applied": true}

	func get_collision_layer_names() -> Variant:
		calls.append({"op": "get_collision_layer_names"})
		return {"layers": [{"index": 1, "name": "player"}, {"index": 2, "name": "enemy"}]}

	func configure_layer(index: int, name: String, mask: int) -> Variant:
		calls.append({"op": "configure_layer", "index": index, "name": name, "mask": mask})
		return {"applied": true}

	func find_calls(op: String) -> Array:
		var out: Array = []
		for c in calls:
			if (c as Dictionary).get("op", "") == op:
				out.append(c)
		return out


func _new_env() -> Dictionary:
	var backend: FakePhysicsBackend = FakePhysicsBackend.new()
	var tools: Object = PHYSICS_TOOLS_SCRIPT.new(backend)
	return {"backend": backend, "tools": tools}


func test_set_gravity_forwards_vector_verbatim() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).set_gravity({"vector": [0, -9.8, 0]})
	var call: Dictionary = (env["backend"] as FakePhysicsBackend).find_calls("set_gravity")[0]
	assert_eq((call.get("vector", []) as Array).size(), 3, "vector forwarded as 3-element array")


func test_get_collision_layer_names_returns_layers() -> void:
	var env: Dictionary = _new_env()
	var result: Variant = (env["tools"] as Object).get_collision_layer_names({})
	assert_true(((result as Dictionary).get("layers", []) as Array).size() > 0,
		"layers returned")


func test_configure_layer_forwards_all_params() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).configure_layer({
		"index": 3,
		"name": "hostile",
		"mask": 5,
	})
	var call: Dictionary = (env["backend"] as FakePhysicsBackend).find_calls("configure_layer")[0]
	assert_eq(call.get("index", -1), 3, "index forwarded")
	assert_eq(call.get("name", ""), "hostile", "name forwarded")
	assert_eq(call.get("mask", -1), 5, "mask forwarded")


func test_configure_layer_defaults_mask_to_zero() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).configure_layer({"index": 1, "name": "player"})
	var call: Dictionary = (env["backend"] as FakePhysicsBackend).find_calls("configure_layer")[0]
	assert_eq(call.get("mask", -1), 0, "mask defaults to 0 when absent")


func test_register_on_wires_all_three_editor_physics_methods() -> void:
	var env: Dictionary = _new_env()
	var dispatcher: Object = DISPATCHER_SCRIPT.new()
	(env["tools"] as Object).register_on(dispatcher)
	var expected: Array = [
		"physics.set_gravity",
		"physics.get_collision_layer_names",
		"physics.configure_layer",
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
