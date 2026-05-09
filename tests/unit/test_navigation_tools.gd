extends GutTest
## Unit tests for McpNavigationTools: four editor-channel Navigation MCP
## tools on top of a duck-typed NavigationBackend.
##
##   navigation.bake_mesh(nav_region_path, quality?)         → {success, mesh_path}
##   navigation.add_agent(scene_path, parent_path, params?)  (UndoRedo)
##   navigation.set_avoidance(agent_path, enabled, params?)  (UndoRedo)
##   navigation.configure_layers(layers)                     — atomic project.godot write


const NAV_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/tools/navigation_tools.gd")
const DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")


class FakeNavigationBackend:
	extends RefCounted

	var calls: Array = []

	func bake_mesh(nav_region_path: String, quality: String) -> Variant:
		calls.append({"op": "bake_mesh", "nav_region_path": nav_region_path, "quality": quality})
		return {"success": true, "mesh_path": "res://nav/a.nav"}

	func add_agent(scene_path: String, parent_path: String, params: Dictionary) -> Variant:
		calls.append({"op": "add_agent", "scene_path": scene_path, "parent_path": parent_path, "params": params})
		return {"node_path": parent_path + "/NavAgent"}

	func set_avoidance(agent_path: String, enabled: bool, params: Dictionary) -> Variant:
		calls.append({"op": "set_avoidance", "agent_path": agent_path, "enabled": enabled, "params": params})
		return {"applied": true}

	func configure_layers(layers: Variant) -> Variant:
		calls.append({"op": "configure_layers", "layers": layers})
		return {"applied": true}

	func find_calls(op: String) -> Array:
		var out: Array = []
		for c in calls:
			if (c as Dictionary).get("op", "") == op:
				out.append(c)
		return out


func _new_env() -> Dictionary:
	var backend: FakeNavigationBackend = FakeNavigationBackend.new()
	var tools: Object = NAV_TOOLS_SCRIPT.new(backend)
	return {"backend": backend, "tools": tools}


func test_bake_mesh_forwards_quality_default() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).bake_mesh({"nav_region_path": "/root/NavRegion"})
	var call: Dictionary = (env["backend"] as FakeNavigationBackend).find_calls("bake_mesh")[0]
	assert_eq(call.get("quality", ""), "medium", "quality defaults to medium")


func test_add_agent_forwards_params() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).add_agent({
		"scene_path": "res://m.tscn",
		"parent_path": "/root/M/Enemy",
		"params": {"radius": 0.5},
	})
	var call: Dictionary = (env["backend"] as FakeNavigationBackend).find_calls("add_agent")[0]
	assert_eq((call.get("params", {}) as Dictionary).get("radius", 0.0), 0.5, "params forwarded")


func test_set_avoidance_forwards_enabled_flag() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).set_avoidance({
		"agent_path": "/root/M/Enemy/Nav",
		"enabled": true,
		"params": {"max_speed": 6.0},
	})
	var call: Dictionary = (env["backend"] as FakeNavigationBackend).find_calls("set_avoidance")[0]
	assert_eq(call.get("enabled", false), true, "enabled forwarded")


func test_configure_layers_forwards_layers_array() -> void:
	var env: Dictionary = _new_env()
	var layers: Array = [{"index": 1, "name": "walkable"}, {"index": 2, "name": "blocked"}]
	var _r: Variant = (env["tools"] as Object).configure_layers({"layers": layers})
	var call: Dictionary = (env["backend"] as FakeNavigationBackend).find_calls("configure_layers")[0]
	assert_eq((call.get("layers", []) as Array).size(), 2, "layers forwarded")


func test_register_on_wires_all_four_editor_navigation_methods() -> void:
	var env: Dictionary = _new_env()
	var dispatcher: Object = DISPATCHER_SCRIPT.new()
	(env["tools"] as Object).register_on(dispatcher)
	var expected: Array = [
		"navigation.bake_mesh",
		"navigation.add_agent",
		"navigation.set_avoidance",
		"navigation.configure_layers",
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
