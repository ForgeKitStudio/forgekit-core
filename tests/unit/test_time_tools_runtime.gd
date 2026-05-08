extends GutTest
## Unit tests for McpRuntimeTimeTools: JSON-RPC handler adapter that
## exposes the runtime-channel time-control MCP tools on top of a
## duck-typed RuntimeTimeBackend.
##
## Covered handlers:
##   runtime.pause                         → {paused: true}
##   runtime.resume                        → {paused: false}
##   runtime.set_time_scale(scale)         → {time_scale, previous}
##   runtime.get_time_scale                → {time_scale}


const TIME_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/runtime_bridge/tools/time_tools.gd")
const DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")


class FakeRuntimeTimeBackend:
	extends RefCounted

	var calls: Array = []
	var overrides: Dictionary = {}

	func pause() -> Variant:
		calls.append({"op": "pause"})
		if overrides.has("pause"):
			return overrides["pause"]
		return {"paused": true}

	func resume() -> Variant:
		calls.append({"op": "resume"})
		if overrides.has("resume"):
			return overrides["resume"]
		return {"paused": false}

	func set_time_scale(scale: float) -> Variant:
		calls.append({"op": "set_time_scale", "scale": scale})
		if overrides.has("set_time_scale"):
			return overrides["set_time_scale"]
		return {"time_scale": scale, "previous": 1.0}

	func get_time_scale() -> Variant:
		calls.append({"op": "get_time_scale"})
		if overrides.has("get_time_scale"):
			return overrides["get_time_scale"]
		return {"time_scale": 1.0}

	func find_calls(op: String) -> Array:
		var out: Array = []
		for c in calls:
			if (c as Dictionary).get("op", "") == op:
				out.append(c)
		return out


func _new_env() -> Dictionary:
	var backend: FakeRuntimeTimeBackend = FakeRuntimeTimeBackend.new()
	var tools: Object = TIME_TOOLS_SCRIPT.new(backend)
	return {"backend": backend, "tools": tools}


# ---------------------------------------------------------------------------
# 1) runtime.pause — calls backend and returns paused: true
# ---------------------------------------------------------------------------

func test_pause_calls_backend_and_returns_paused_true() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeTimeBackend = env["backend"]

	var result: Variant = tools.pause({})

	assert_eq(backend.find_calls("pause").size(), 1, "Backend.pause called once")
	var dict: Dictionary = result as Dictionary
	assert_true(dict.get("paused", false), "Result must contain 'paused: true'")


# ---------------------------------------------------------------------------
# 2) runtime.resume — calls backend and returns paused: false
# ---------------------------------------------------------------------------

func test_resume_calls_backend_and_returns_paused_false() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeTimeBackend = env["backend"]

	var result: Variant = tools.resume({})

	assert_eq(backend.find_calls("resume").size(), 1, "Backend.resume called once")
	var dict: Dictionary = result as Dictionary
	assert_false(dict.get("paused", true), "Result must contain 'paused: false'")


# ---------------------------------------------------------------------------
# 3) runtime.set_time_scale — forwards scale value
# ---------------------------------------------------------------------------

func test_set_time_scale_forwards_scale_value() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeTimeBackend = env["backend"]

	var _result: Variant = tools.set_time_scale({"scale": 0.5})

	var call: Dictionary = backend.find_calls("set_time_scale")[0]
	assert_almost_eq(float(call.get("scale", 0.0)), 0.5, 0.0001, "scale forwarded")


func test_set_time_scale_accepts_positional_param() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeTimeBackend = env["backend"]

	var _result: Variant = tools.set_time_scale([2.0])

	var call: Dictionary = backend.find_calls("set_time_scale")[0]
	assert_almost_eq(float(call.get("scale", 0.0)), 2.0, 0.0001, "positional scale forwarded")


func test_set_time_scale_accepts_integer_value() -> void:
	# JSON parses `1` as an integer; the adapter must coerce it to float
	# before forwarding so the backend's strongly-typed signature accepts it.
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeTimeBackend = env["backend"]

	var _result: Variant = tools.set_time_scale({"scale": 1})

	var call: Dictionary = backend.find_calls("set_time_scale")[0]
	assert_almost_eq(float(call.get("scale", 0.0)), 1.0, 0.0001, "integer scale coerced to 1.0")


# ---------------------------------------------------------------------------
# 4) runtime.get_time_scale — calls backend and returns time_scale
# ---------------------------------------------------------------------------

func test_get_time_scale_calls_backend_and_returns_time_scale() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeTimeBackend = env["backend"]

	var result: Variant = tools.get_time_scale({})

	assert_eq(backend.find_calls("get_time_scale").size(), 1, "Backend called once")
	var dict: Dictionary = result as Dictionary
	assert_true(dict.has("time_scale"), "Result must contain 'time_scale'")


# ---------------------------------------------------------------------------
# 5) register_on — wires all four runtime time-control methods
# ---------------------------------------------------------------------------

func test_register_on_wires_all_four_time_methods_on_dispatcher() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var dispatcher: Object = DISPATCHER_SCRIPT.new()

	tools.register_on(dispatcher)

	var cases: Array = [
		{"method": "runtime.pause", "params": {}},
		{"method": "runtime.resume", "params": {}},
		{"method": "runtime.set_time_scale", "params": {"scale": 1.0}},
		{"method": "runtime.get_time_scale", "params": {}},
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
