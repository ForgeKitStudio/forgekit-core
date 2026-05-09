extends GutTest
## Unit tests for McpPhysicsRuntimeTools: three runtime-channel Physics MCP
## tools on top of a duck-typed PhysicsRuntimeBackend.
##
##   physics.raycast(from, to, collision_mask?, exclude?)      → {hit, position, normal, collider_path}
##   physics.shape_cast(shape, from, motion, collision_mask?)  → {hits: [...]}
##   physics.query_point(position, collision_mask?)            → {collider_paths: [...]}


const PHYSICS_RUNTIME_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/runtime_bridge/tools/physics_runtime_tools.gd")
const DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")


class FakePhysicsRuntimeBackend:
	extends RefCounted

	var calls: Array = []

	func raycast(from: Variant, to: Variant, collision_mask: int, exclude: Variant) -> Variant:
		calls.append({"op": "raycast", "from": from, "to": to, "collision_mask": collision_mask, "exclude": exclude})
		return {"hit": false, "position": [0, 0, 0], "normal": [0, 0, 0], "collider_path": ""}

	func shape_cast(shape: Variant, from: Variant, motion: Variant, collision_mask: int) -> Variant:
		calls.append({"op": "shape_cast", "shape": shape, "from": from, "motion": motion, "collision_mask": collision_mask})
		return {"hits": []}

	func query_point(position: Variant, collision_mask: int) -> Variant:
		calls.append({"op": "query_point", "position": position, "collision_mask": collision_mask})
		return {"collider_paths": []}

	func find_calls(op: String) -> Array:
		var out: Array = []
		for c in calls:
			if (c as Dictionary).get("op", "") == op:
				out.append(c)
		return out


func _new_env() -> Dictionary:
	var backend: FakePhysicsRuntimeBackend = FakePhysicsRuntimeBackend.new()
	var tools: Object = PHYSICS_RUNTIME_SCRIPT.new(backend)
	return {"backend": backend, "tools": tools}


func test_raycast_forwards_from_and_to() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).raycast({
		"from": [0, 0, 0],
		"to": [10, 0, 0],
		"collision_mask": 1,
	})
	var call: Dictionary = (env["backend"] as FakePhysicsRuntimeBackend).find_calls("raycast")[0]
	assert_eq(call.get("collision_mask", -1), 1, "collision_mask forwarded")


func test_raycast_defaults_collision_mask_to_all_layers() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).raycast({"from": [0, 0, 0], "to": [1, 0, 0]})
	var call: Dictionary = (env["backend"] as FakePhysicsRuntimeBackend).find_calls("raycast")[0]
	assert_eq(call.get("collision_mask", -1), 0xFFFFFFFF,
		"collision_mask defaults to all layers (0xFFFFFFFF)")


func test_shape_cast_forwards_all_params() -> void:
	var env: Dictionary = _new_env()
	var shape: Dictionary = {"type": "box", "size": [1, 1, 1]}
	var _r: Variant = (env["tools"] as Object).shape_cast({
		"shape": shape,
		"from": [0, 0, 0],
		"motion": [5, 0, 0],
		"collision_mask": 2,
	})
	var call: Dictionary = (env["backend"] as FakePhysicsRuntimeBackend).find_calls("shape_cast")[0]
	assert_eq(call.get("shape", {}), shape, "shape forwarded verbatim")


func test_query_point_forwards_position() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).query_point({
		"position": [5, 5, 5],
		"collision_mask": 3,
	})
	var call: Dictionary = (env["backend"] as FakePhysicsRuntimeBackend).find_calls("query_point")[0]
	assert_eq(call.get("collision_mask", -1), 3, "collision_mask forwarded")


func test_register_on_wires_all_three_runtime_physics_methods() -> void:
	var env: Dictionary = _new_env()
	var dispatcher: Object = DISPATCHER_SCRIPT.new()
	(env["tools"] as Object).register_on(dispatcher)
	var expected: Array = [
		"physics.raycast",
		"physics.shape_cast",
		"physics.query_point",
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
