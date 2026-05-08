extends GutTest
## Unit tests for McpRuntimeEventTools: JSON-RPC handler adapter that exposes
## the runtime-channel event / log MCP tools on top of a duck-typed
## RuntimeEventBackend.
##
## Covered handlers:
##   runtime.emit_event(signal_name, payload)   → {emitted: true, signal_name}
##                                               | {"error": {...}}
##   runtime.get_logs(max_lines?, level?)       → {lines: [{ts, level, message}]}


const EVENT_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/runtime_bridge/tools/event_tools.gd")
const DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")


class FakeRuntimeEventBackend:
	extends RefCounted

	var calls: Array = []
	var overrides: Dictionary = {}

	func emit_event(signal_name: String, payload: Variant) -> Variant:
		calls.append({"op": "emit_event", "signal_name": signal_name, "payload": payload})
		if overrides.has("emit_event"):
			return overrides["emit_event"]
		return {"emitted": true, "signal_name": signal_name}

	func get_logs(max_lines: int, level: String) -> Variant:
		calls.append({"op": "get_logs", "max_lines": max_lines, "level": level})
		if overrides.has("get_logs"):
			return overrides["get_logs"]
		return {"lines": []}

	func find_calls(op: String) -> Array:
		var out: Array = []
		for c in calls:
			if (c as Dictionary).get("op", "") == op:
				out.append(c)
		return out


func _new_env() -> Dictionary:
	var backend: FakeRuntimeEventBackend = FakeRuntimeEventBackend.new()
	var tools: Object = EVENT_TOOLS_SCRIPT.new(backend)
	return {"backend": backend, "tools": tools}


# ---------------------------------------------------------------------------
# 1) runtime.emit_event — forwards signal_name and payload verbatim
# ---------------------------------------------------------------------------

func test_emit_event_forwards_signal_name_and_payload() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeEventBackend = env["backend"]

	var payload: Dictionary = {"source": "player", "damage": 10, "damage_type": "fire"}
	var _result: Variant = tools.emit_event({"signal_name": "damage_dealt", "payload": payload})

	var call: Dictionary = backend.find_calls("emit_event")[0]
	assert_eq(String(call.get("signal_name", "")), "damage_dealt", "signal_name forwarded")
	var forwarded_payload: Dictionary = call.get("payload") as Dictionary
	assert_eq(String(forwarded_payload.get("source", "")), "player", "payload.source forwarded")
	assert_eq(int(forwarded_payload.get("damage", 0)), 10, "payload.damage forwarded")


func test_emit_event_accepts_positional_params() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeEventBackend = env["backend"]

	var _result: Variant = tools.emit_event(["crafting_completed", {"recipe_id": "iron_ingot"}])

	var call: Dictionary = backend.find_calls("emit_event")[0]
	assert_eq(String(call.get("signal_name", "")), "crafting_completed", "positional signal_name forwarded")


func test_emit_event_defaults_payload_to_empty_dict_when_absent() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeEventBackend = env["backend"]

	var _result: Variant = tools.emit_event({"signal_name": "item_added"})

	var call: Dictionary = backend.find_calls("emit_event")[0]
	var forwarded_payload: Variant = call.get("payload", null)
	assert_true(forwarded_payload is Dictionary, "Missing payload forwards as an empty Dictionary")
	assert_eq((forwarded_payload as Dictionary).size(), 0, "Empty Dictionary has size 0")


func test_emit_event_passes_through_error_envelope() -> void:
	# When the backend rejects a signal (e.g. unknown signal name or
	# payload-type mismatch), it returns an `{"error": {...}}` envelope.
	# The adapter must pass it through unchanged so the dispatcher can
	# hoist it into a top-level JSON-RPC error response.
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeEventBackend = env["backend"]

	backend.overrides["emit_event"] = {
		"error": {
			"code": -32004,
			"message": "UNKNOWN_SIGNAL",
			"data": {"signal_name": "no_such_signal"},
		},
	}

	var result: Variant = tools.emit_event({"signal_name": "no_such_signal", "payload": {}})

	var dict: Dictionary = result as Dictionary
	assert_true(dict.has("error"), "Adapter must pass through the error envelope unchanged")


# ---------------------------------------------------------------------------
# 2) runtime.get_logs — forwards optional max_lines and level
# ---------------------------------------------------------------------------

func test_get_logs_forwards_max_lines_and_level() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeEventBackend = env["backend"]

	var _result: Variant = tools.get_logs({"max_lines": 50, "level": "warn"})

	var call: Dictionary = backend.find_calls("get_logs")[0]
	assert_eq(int(call.get("max_lines", -99)), 50, "max_lines forwarded")
	assert_eq(String(call.get("level", "")), "warn", "level forwarded")


func test_get_logs_defaults_max_lines_to_minus_one_and_level_to_empty_string() -> void:
	# Defaults: -1 max_lines means "no limit" on the backend; empty level
	# means "any level" (no filter).
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeEventBackend = env["backend"]

	var _result: Variant = tools.get_logs({})

	var call: Dictionary = backend.find_calls("get_logs")[0]
	assert_eq(int(call.get("max_lines", -99)), -1, "Missing max_lines forwards as -1")
	assert_eq(String(call.get("level", "X")), "", "Missing level forwards as empty string")


func test_get_logs_accepts_positional_params() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeEventBackend = env["backend"]

	var _result: Variant = tools.get_logs([100, "error"])

	var call: Dictionary = backend.find_calls("get_logs")[0]
	assert_eq(int(call.get("max_lines", -99)), 100, "positional max_lines forwarded")
	assert_eq(String(call.get("level", "")), "error", "positional level forwarded")


func test_get_logs_returns_lines_array() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]

	var result: Variant = tools.get_logs({})

	assert_true(result is Dictionary, "Result must be a Dictionary")
	var dict: Dictionary = result as Dictionary
	assert_true(dict.has("lines"), "Result must contain 'lines'")
	assert_true(dict.get("lines") is Array, "'lines' must be an Array")


# ---------------------------------------------------------------------------
# 3) register_on — wires both runtime event methods on the dispatcher
# ---------------------------------------------------------------------------

func test_register_on_wires_both_event_methods_on_dispatcher() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var dispatcher: Object = DISPATCHER_SCRIPT.new()

	tools.register_on(dispatcher)

	var cases: Array = [
		{"method": "runtime.emit_event", "params": {"signal_name": "item_added", "payload": {}}},
		{"method": "runtime.get_logs", "params": {}},
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
