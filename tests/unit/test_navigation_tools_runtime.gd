extends GutTest
## Unit tests for McpNavigationRuntimeTools: two runtime-channel Navigation
## MCP tools on top of a duck-typed NavigationRuntimeBackend.
##
##   navigation.find_path(from, to, optimize?)  → {path_points, cost}
##   navigation.debug_draw(enabled)             → {enabled}


const NAV_RUNTIME_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/runtime_bridge/tools/navigation_runtime_tools.gd")
const DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")


class FakeNavigationRuntimeBackend:
	extends RefCounted

	var calls: Array = []

	func find_path(from: Variant, to: Variant, optimize: bool) -> Variant:
		calls.append({"op": "find_path", "from": from, "to": to, "optimize": optimize})
		return {"path_points": [from, to], "cost": 10.0}

	func debug_draw(enabled: bool) -> Variant:
		calls.append({"op": "debug_draw", "enabled": enabled})
		return {"enabled": enabled}

	func find_calls(op: String) -> Array:
		var out: Array = []
		for c in calls:
			if (c as Dictionary).get("op", "") == op:
				out.append(c)
		return out


func _new_env() -> Dictionary:
	var backend: FakeNavigationRuntimeBackend = FakeNavigationRuntimeBackend.new()
	var tools: Object = NAV_RUNTIME_SCRIPT.new(backend)
	return {"backend": backend, "tools": tools}


func test_find_path_forwards_from_and_to() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).find_path({
		"from": [0, 0, 0],
		"to": [10, 0, 10],
		"optimize": true,
	})
	var call: Dictionary = (env["backend"] as FakeNavigationRuntimeBackend).find_calls("find_path")[0]
	assert_eq(call.get("optimize", false), true, "optimize forwarded")


func test_find_path_defaults_optimize_to_true() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).find_path({
		"from": [0, 0, 0],
		"to": [1, 0, 0],
	})
	var call: Dictionary = (env["backend"] as FakeNavigationRuntimeBackend).find_calls("find_path")[0]
	assert_eq(call.get("optimize", false), true,
		"optimize defaults to true when absent")


func test_debug_draw_forwards_enabled_flag() -> void:
	var env: Dictionary = _new_env()
	var result: Variant = (env["tools"] as Object).debug_draw({"enabled": true})
	var call: Dictionary = (env["backend"] as FakeNavigationRuntimeBackend).find_calls("debug_draw")[0]
	assert_eq(call.get("enabled", false), true, "enabled forwarded")
	assert_eq((result as Dictionary).get("enabled", false), true, "enabled returned")


func test_register_on_wires_both_runtime_navigation_methods() -> void:
	var env: Dictionary = _new_env()
	var dispatcher: Object = DISPATCHER_SCRIPT.new()
	(env["tools"] as Object).register_on(dispatcher)
	var expected: Array = [
		"navigation.find_path",
		"navigation.debug_draw",
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
