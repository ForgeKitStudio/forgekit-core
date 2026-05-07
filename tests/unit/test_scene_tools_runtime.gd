extends GutTest
## Unit tests for McpRuntimeSceneTools: JSON-RPC handler adapter that exposes
## the runtime-channel Scene MCP tool (`scene.get_tree_snapshot`) on top of
## a duck-typed RuntimeSceneBackend.


const SCENE_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/runtime_bridge/tools/scene_tools.gd")
const DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")


# ---------------------------------------------------------------------------
# FakeRuntimeSceneBackend — records every call and returns either a canned
# snapshot payload or an injected override.
# ---------------------------------------------------------------------------

class FakeRuntimeSceneBackend:
	extends RefCounted

	var calls: Array = []
	var overrides: Dictionary = {}

	func get_scene_tree_snapshot(max_depth: int) -> Variant:
		calls.append({"op": "get_scene_tree_snapshot", "max_depth": max_depth})
		if overrides.has("get_scene_tree_snapshot"):
			return overrides["get_scene_tree_snapshot"]
		return {
			"tree": {"path": "/root/Main", "type": "Node", "children": []},
			"ts": "2025-01-01T00:00:00",
		}

	func find_calls(op: String) -> Array:
		var out: Array = []
		for c in calls:
			if (c as Dictionary).get("op", "") == op:
				out.append(c)
		return out


func _new_env() -> Dictionary:
	var backend: FakeRuntimeSceneBackend = FakeRuntimeSceneBackend.new()
	var tools: Object = SCENE_TOOLS_SCRIPT.new(backend)
	return {"backend": backend, "tools": tools}


# ---------------------------------------------------------------------------
# 1) scene.get_tree_snapshot — forwards max_depth verbatim
# ---------------------------------------------------------------------------

func test_get_tree_snapshot_forwards_max_depth() -> void:
	var env: Dictionary = _new_env()
	var backend: FakeRuntimeSceneBackend = env["backend"]
	var tools: Object = env["tools"]

	var _result: Variant = tools.get_tree_snapshot({"max_depth": 3})

	var calls: Array = backend.find_calls("get_scene_tree_snapshot")
	assert_eq(calls.size(), 1, "Backend.get_scene_tree_snapshot must be called once")
	assert_eq((calls[0] as Dictionary).get("max_depth", -99), 3, "max_depth must be forwarded verbatim")


# ---------------------------------------------------------------------------
# 2) scene.get_tree_snapshot — defaults max_depth to -1 when absent
# ---------------------------------------------------------------------------

func test_get_tree_snapshot_defaults_max_depth_to_minus_one_when_absent() -> void:
	var env: Dictionary = _new_env()
	var backend: FakeRuntimeSceneBackend = env["backend"]
	var tools: Object = env["tools"]

	var _result: Variant = tools.get_tree_snapshot({})

	var calls: Array = backend.find_calls("get_scene_tree_snapshot")
	assert_eq(calls.size(), 1, "Backend.get_scene_tree_snapshot must be called once")
	assert_eq((calls[0] as Dictionary).get("max_depth", -99), -1, "Missing max_depth must forward as -1")


# ---------------------------------------------------------------------------
# 3) scene.get_tree_snapshot — returns backend payload (tree + ts)
# ---------------------------------------------------------------------------

func test_get_tree_snapshot_returns_backend_payload() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]

	var result: Variant = tools.get_tree_snapshot({"max_depth": 1})

	assert_true(result is Dictionary, "get_tree_snapshot() must return a Dictionary")
	var dict: Dictionary = result as Dictionary
	assert_true(dict.has("tree"), "Snapshot must include a 'tree' field")
	assert_true(dict.has("ts"), "Snapshot must include a 'ts' timestamp field")


# ---------------------------------------------------------------------------
# 4) register_on — wires scene.get_tree_snapshot on the dispatcher
# ---------------------------------------------------------------------------

func test_register_on_wires_get_tree_snapshot_method() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var dispatcher: Object = DISPATCHER_SCRIPT.new()

	tools.register_on(dispatcher)

	var response: Dictionary = dispatcher.dispatch({
		"jsonrpc": "2.0",
		"method": "scene.get_tree_snapshot",
		"params": {"max_depth": 2},
		"id": 1,
	})

	assert_true(response.has("result"), "scene.get_tree_snapshot must be reachable after register_on()")
	assert_false(response.has("error"), "scene.get_tree_snapshot must not produce a dispatcher error")
	var result: Dictionary = response.get("result", {})
	assert_true(result.has("tree"), "Result must include 'tree'")
	assert_true(result.has("ts"), "Result must include 'ts'")
