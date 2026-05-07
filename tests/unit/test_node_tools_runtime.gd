extends GutTest
## Unit tests for McpRuntimeNodeTools: JSON-RPC handler adapter that exposes
## the runtime-channel `node.call_method` MCP tool on top of a duck-typed
## RuntimeNodeBackend.
##
## The adapter forwards `node_path`, `method`, and `args` verbatim to the
## backend and returns the backend's result unchanged. Business-level
## errors surface as `{"error": {...}}` envelopes that the dispatcher
## hoists to JSON-RPC error responses.


const NODE_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/runtime_bridge/tools/node_tools.gd")
const DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")
const MCP_ERROR_CODES_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/mcp_error_codes.gd")


class FakeRuntimeNodeBackend:
	extends RefCounted

	var calls: Array = []
	var overrides: Dictionary = {}

	func call_node_method(node_path: String, method: String, args: Array) -> Variant:
		calls.append({"op": "call_node_method", "node_path": node_path, "method": method, "args": args})
		if overrides.has("call_node_method"):
			return overrides["call_node_method"]
		return {"returned": null}

	func find_calls(op: String) -> Array:
		var out: Array = []
		for c in calls:
			if (c as Dictionary).get("op", "") == op:
				out.append(c)
		return out


func _new_env() -> Dictionary:
	var backend: FakeRuntimeNodeBackend = FakeRuntimeNodeBackend.new()
	var tools: Object = NODE_TOOLS_SCRIPT.new(backend)
	return {"backend": backend, "tools": tools}


# ---------------------------------------------------------------------------
# 1) node.call_method — forwards node_path, method, args
# ---------------------------------------------------------------------------

func test_call_method_forwards_node_path_method_and_args() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeNodeBackend = env["backend"]

	var _result: Variant = tools.call_method({
		"node_path": "/root/Main/Player",
		"method": "take_damage",
		"args": [10, "fire"],
	})

	var calls: Array = backend.find_calls("call_node_method")
	assert_eq(calls.size(), 1, "Backend.call_node_method must be called once")
	var call: Dictionary = calls[0]
	assert_eq(call.get("node_path", ""), "/root/Main/Player", "node_path forwarded")
	assert_eq(call.get("method", ""), "take_damage", "method forwarded")
	var args: Variant = call.get("args", null)
	assert_true(args is Array, "args must be forwarded as an Array")
	assert_eq((args as Array).size(), 2, "args length must be preserved")
	assert_eq((args as Array)[0], 10, "args[0] forwarded")
	assert_eq((args as Array)[1], "fire", "args[1] forwarded")


# ---------------------------------------------------------------------------
# 2) node.call_method — defaults args to [] when absent
# ---------------------------------------------------------------------------

func test_call_method_defaults_args_to_empty_array_when_absent() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeNodeBackend = env["backend"]

	var _result: Variant = tools.call_method({
		"node_path": "/root/Main/Player",
		"method": "jump",
	})

	var call: Dictionary = backend.find_calls("call_node_method")[0]
	var args: Variant = call.get("args", null)
	assert_true(args is Array, "Missing args must default to an Array")
	assert_eq((args as Array).size(), 0, "Default args must be empty")


# ---------------------------------------------------------------------------
# 3) node.call_method — passes through backend error envelope
# ---------------------------------------------------------------------------

func test_call_method_passes_through_backend_error_envelope() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeNodeBackend = env["backend"]
	backend.overrides["call_node_method"] = {
		"error": MCP_ERROR_CODES_SCRIPT.make_error(
			MCP_ERROR_CODES_SCRIPT.FILE_NOT_FOUND,
			{"node_path": "/root/Missing"}
		),
	}

	var result: Variant = tools.call_method({
		"node_path": "/root/Missing",
		"method": "foo",
	})

	assert_true((result as Dictionary).has("error"), "Backend error envelope must propagate")


# ---------------------------------------------------------------------------
# 4) register_on — wires node.call_method on the dispatcher
# ---------------------------------------------------------------------------

func test_register_on_wires_node_call_method_on_dispatcher() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var dispatcher: Object = DISPATCHER_SCRIPT.new()

	tools.register_on(dispatcher)

	var response: Dictionary = dispatcher.dispatch({
		"jsonrpc": "2.0",
		"method": "node.call_method",
		"params": {"node_path": "/root/Main/Player", "method": "jump"},
		"id": 1,
	})
	assert_true(response.has("result"), "node.call_method must be reachable via dispatcher")
	assert_false(response.has("error"), "node.call_method must not produce a dispatcher error")
