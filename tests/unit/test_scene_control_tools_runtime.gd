extends GutTest
## Unit tests for McpRuntimeSceneControlTools: JSON-RPC handler adapter that
## exposes the runtime-channel scene-control MCP tools on top of a
## duck-typed RuntimeSceneControlBackend.
##
## Covered handlers:
##   runtime.get_scene_tree(max_depth?)    → {tree}
##   runtime.get_current_scene             → {scene_path, root_path}
##   runtime.change_scene(scene_path)      → {changed: true}
##   runtime.reload_current_scene          → {reloaded: true}


const SCENE_CONTROL_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/runtime_bridge/tools/scene_control_tools.gd")
const DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")


class FakeRuntimeSceneControlBackend:
	extends RefCounted

	var calls: Array = []
	var overrides: Dictionary = {}

	func get_scene_tree(max_depth: int) -> Variant:
		calls.append({"op": "get_scene_tree", "max_depth": max_depth})
		if overrides.has("get_scene_tree"):
			return overrides["get_scene_tree"]
		return {"tree": {"path": "/root/Main", "type": "Node", "children": []}}

	func get_current_scene() -> Variant:
		calls.append({"op": "get_current_scene"})
		if overrides.has("get_current_scene"):
			return overrides["get_current_scene"]
		return {"scene_path": "res://scenes/main.tscn", "root_path": "/root/Main"}

	func change_scene(scene_path: String) -> Variant:
		calls.append({"op": "change_scene", "scene_path": scene_path})
		if overrides.has("change_scene"):
			return overrides["change_scene"]
		return {"changed": true}

	func reload_current_scene() -> Variant:
		calls.append({"op": "reload_current_scene"})
		if overrides.has("reload_current_scene"):
			return overrides["reload_current_scene"]
		return {"reloaded": true}

	func find_calls(op: String) -> Array:
		var out: Array = []
		for c in calls:
			if (c as Dictionary).get("op", "") == op:
				out.append(c)
		return out


func _new_env() -> Dictionary:
	var backend: FakeRuntimeSceneControlBackend = FakeRuntimeSceneControlBackend.new()
	var tools: Object = SCENE_CONTROL_TOOLS_SCRIPT.new(backend)
	return {"backend": backend, "tools": tools}


# ---------------------------------------------------------------------------
# 1) runtime.get_scene_tree — forwards max_depth verbatim, defaults to -1
# ---------------------------------------------------------------------------

func test_get_scene_tree_forwards_max_depth() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeSceneControlBackend = env["backend"]

	var _result: Variant = tools.get_scene_tree({"max_depth": 2})

	var call: Dictionary = backend.find_calls("get_scene_tree")[0]
	assert_eq(int(call.get("max_depth", -99)), 2, "max_depth forwarded verbatim")


func test_get_scene_tree_defaults_max_depth_to_minus_one_when_absent() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeSceneControlBackend = env["backend"]

	var _result: Variant = tools.get_scene_tree({})

	var call: Dictionary = backend.find_calls("get_scene_tree")[0]
	assert_eq(int(call.get("max_depth", -99)), -1, "Missing max_depth forwards as -1")


# ---------------------------------------------------------------------------
# 2) runtime.get_current_scene — forwards to backend and returns envelope
# ---------------------------------------------------------------------------

func test_get_current_scene_calls_backend_and_returns_envelope() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeSceneControlBackend = env["backend"]

	var result: Variant = tools.get_current_scene({})

	assert_eq(backend.find_calls("get_current_scene").size(), 1, "Backend called once")
	var dict: Dictionary = result as Dictionary
	assert_true(dict.has("scene_path"), "Result must include 'scene_path'")
	assert_true(dict.has("root_path"), "Result must include 'root_path'")


# ---------------------------------------------------------------------------
# 3) runtime.change_scene — forwards scene_path
# ---------------------------------------------------------------------------

func test_change_scene_forwards_scene_path() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeSceneControlBackend = env["backend"]

	var _result: Variant = tools.change_scene({"scene_path": "res://scenes/other.tscn"})

	var call: Dictionary = backend.find_calls("change_scene")[0]
	assert_eq(String(call.get("scene_path", "")), "res://scenes/other.tscn", "scene_path forwarded")


func test_change_scene_accepts_positional_params() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeSceneControlBackend = env["backend"]

	var _result: Variant = tools.change_scene(["res://scenes/a.tscn"])

	var call: Dictionary = backend.find_calls("change_scene")[0]
	assert_eq(String(call.get("scene_path", "")), "res://scenes/a.tscn", "positional scene_path forwarded")


# ---------------------------------------------------------------------------
# 4) runtime.reload_current_scene — calls backend and returns reloaded: true
# ---------------------------------------------------------------------------

func test_reload_current_scene_calls_backend_and_returns_envelope() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeSceneControlBackend = env["backend"]

	var result: Variant = tools.reload_current_scene({})

	assert_eq(backend.find_calls("reload_current_scene").size(), 1, "Backend called once")
	var dict: Dictionary = result as Dictionary
	assert_true(bool(dict.get("reloaded", false)), "Result must include 'reloaded: true'")


# ---------------------------------------------------------------------------
# 5) register_on — wires all four scene-control methods on the dispatcher
# ---------------------------------------------------------------------------

func test_register_on_wires_all_four_scene_control_methods_on_dispatcher() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var dispatcher: Object = DISPATCHER_SCRIPT.new()

	tools.register_on(dispatcher)

	var cases: Array = [
		{"method": "runtime.get_scene_tree", "params": {}},
		{"method": "runtime.get_current_scene", "params": {}},
		{"method": "runtime.change_scene", "params": {"scene_path": "res://scenes/x.tscn"}},
		{"method": "runtime.reload_current_scene", "params": {}},
	]
	for case in cases:
		var response: Dictionary = dispatcher.dispatch({
			"jsonrpc": "2.0",
			"method": case.get("method"),
			"params": case.get("params"),
			"id": 1,
		})
		assert_true(response.has("result"), "%s must be reachable via dispatcher" % case.get("method"))
		assert_false(response.has("error"), "%s must not produce a dispatcher error" % case.get("method"))
