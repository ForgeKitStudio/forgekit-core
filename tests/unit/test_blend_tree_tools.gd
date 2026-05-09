extends GutTest
## Unit tests for McpBlendTreeTools: one editor-channel Blend Tree MCP tool
## on top of a duck-typed BlendTreeBackend.
##
##   blend_tree.configure_node(tree_path, node_id, type, params?)  (UndoRedo)


const BT_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/tools/blend_tree_tools.gd")
const DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")


class FakeBlendTreeBackend:
	extends RefCounted

	var calls: Array = []

	func configure_node(tree_path: String, node_id: String, type: String, params: Dictionary) -> Variant:
		calls.append({
			"op": "configure_node",
			"tree_path": tree_path,
			"node_id": node_id,
			"type": type,
			"params": params,
		})
		return {"applied": true}

	func find_calls(op: String) -> Array:
		var out: Array = []
		for c in calls:
			if (c as Dictionary).get("op", "") == op:
				out.append(c)
		return out


func _new_env() -> Dictionary:
	var backend: FakeBlendTreeBackend = FakeBlendTreeBackend.new()
	var tools: Object = BT_TOOLS_SCRIPT.new(backend)
	return {"backend": backend, "tools": tools}


func test_configure_node_forwards_all_params() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).configure_node({
		"tree_path": "/root/M/AT",
		"node_id": "blend_walk_run",
		"type": "Blend2",
		"params": {"animation": "walk"},
	})
	var call: Dictionary = (env["backend"] as FakeBlendTreeBackend).find_calls("configure_node")[0]
	assert_eq(call.get("node_id", ""), "blend_walk_run", "node_id forwarded")
	assert_eq(call.get("type", ""), "Blend2", "type forwarded")
	assert_eq((call.get("params", {}) as Dictionary).get("animation", ""), "walk",
		"params forwarded")


func test_configure_node_defaults_params_to_empty_dict() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).configure_node({
		"tree_path": "/root/M/AT",
		"node_id": "blend",
		"type": "Blend2",
	})
	var call: Dictionary = (env["backend"] as FakeBlendTreeBackend).find_calls("configure_node")[0]
	assert_eq((call.get("params", {}) as Dictionary).size(), 0,
		"missing params defaults to empty dict")


func test_register_on_wires_blend_tree_method() -> void:
	var env: Dictionary = _new_env()
	var dispatcher: Object = DISPATCHER_SCRIPT.new()
	(env["tools"] as Object).register_on(dispatcher)
	var resp: Dictionary = dispatcher.dispatch({
		"jsonrpc": "2.0",
		"method": "blend_tree.configure_node",
		"params": {},
		"id": 1,
	})
	assert_true(resp.has("result"), "blend_tree.configure_node must reach the adapter")
