extends GutTest
## Unit tests for McpRuntimeProfilingTools: JSON-RPC handler adapter that
## exposes the runtime-channel profiling MCP tools on top of a duck-typed
## RuntimeProfilingBackend.
##
## Covered handlers in this file (task 3.13.1):
##   profiling.get_performance_monitors(monitors?) → {monitors: {<name>: <value>, ...}}
##
## `monitors` is an optional array of Performance monitor names. When
## omitted the backend returns the full baseline set (at minimum `fps`,
## `draw_calls`, `physics_frames`); when provided, the backend returns
## only the requested monitors. The adapter itself does not query the
## live `Performance` singleton — all side-effects live in the backend.


const PROFILING_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/runtime_bridge/tools/profiling_tools.gd")
const DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")


class FakeRuntimeProfilingBackend:
	extends RefCounted

	var calls: Array = []
	var overrides: Dictionary = {}

	func get_performance_monitors(monitors: Array) -> Variant:
		calls.append({"op": "get_performance_monitors", "monitors": monitors.duplicate()})
		if overrides.has("get_performance_monitors"):
			return overrides["get_performance_monitors"]
		if monitors.is_empty():
			return {
				"monitors": {
					"fps": 60.0,
					"draw_calls": 128.0,
					"physics_frames": 60.0,
				},
			}
		var out: Dictionary = {}
		for name in monitors:
			out[String(name)] = 42.0
		return {"monitors": out}

	func find_calls(op: String) -> Array:
		var out: Array = []
		for c in calls:
			if (c as Dictionary).get("op", "") == op:
				out.append(c)
		return out


func _new_env() -> Dictionary:
	var backend: FakeRuntimeProfilingBackend = FakeRuntimeProfilingBackend.new()
	var tools: Object = PROFILING_TOOLS_SCRIPT.new(backend)
	return {"backend": backend, "tools": tools}


# ---------------------------------------------------------------------------
# 1) profiling.get_performance_monitors — without `monitors` returns the
#    baseline set (fps, draw_calls, physics_frames).
# ---------------------------------------------------------------------------

func test_get_performance_monitors_without_filter_returns_baseline_set() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeProfilingBackend = env["backend"]

	var result: Variant = tools.get_performance_monitors({})

	assert_eq(backend.find_calls("get_performance_monitors").size(), 1, "Backend called once")
	var dict: Dictionary = result as Dictionary
	assert_true(dict.has("monitors"), "Result must contain 'monitors'")
	var monitors: Dictionary = dict["monitors"] as Dictionary
	assert_true(monitors.has("fps"), "Baseline set contains 'fps'")
	assert_true(monitors.has("draw_calls"), "Baseline set contains 'draw_calls'")
	assert_true(monitors.has("physics_frames"), "Baseline set contains 'physics_frames'")


func test_get_performance_monitors_without_filter_forwards_empty_array() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeProfilingBackend = env["backend"]

	var _result: Variant = tools.get_performance_monitors({})

	var call: Dictionary = backend.find_calls("get_performance_monitors")[0]
	var monitors: Array = call.get("monitors", [null]) as Array
	assert_eq(monitors.size(), 0, "Missing 'monitors' forwards as empty array")


# ---------------------------------------------------------------------------
# 2) profiling.get_performance_monitors — with `monitors` forwards the
#    filter to the backend verbatim.
# ---------------------------------------------------------------------------

func test_get_performance_monitors_forwards_requested_monitors() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeProfilingBackend = env["backend"]

	var _result: Variant = tools.get_performance_monitors({"monitors": ["fps", "draw_calls"]})

	var call: Dictionary = backend.find_calls("get_performance_monitors")[0]
	var monitors: Array = call.get("monitors", []) as Array
	assert_eq(monitors.size(), 2, "Two monitors forwarded")
	assert_eq(String(monitors[0]), "fps", "First monitor name forwarded")
	assert_eq(String(monitors[1]), "draw_calls", "Second monitor name forwarded")


func test_get_performance_monitors_accepts_positional_params() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeProfilingBackend = env["backend"]

	var _result: Variant = tools.get_performance_monitors([["physics_frames"]])

	var call: Dictionary = backend.find_calls("get_performance_monitors")[0]
	var monitors: Array = call.get("monitors", []) as Array
	assert_eq(monitors.size(), 1, "Positional monitors forwarded")
	assert_eq(String(monitors[0]), "physics_frames", "Positional monitor name forwarded")


func test_get_performance_monitors_rejects_non_array_monitors() -> void:
	# A non-array `monitors` value is coerced to an empty array so the
	# adapter never forwards garbage to the backend. This mirrors the
	# defensive shape used by the other runtime adapters (see
	# `McpRuntimeInfoTools._get_string_param`).
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeProfilingBackend = env["backend"]

	var _result: Variant = tools.get_performance_monitors({"monitors": "not-an-array"})

	var call: Dictionary = backend.find_calls("get_performance_monitors")[0]
	var monitors: Array = call.get("monitors", []) as Array
	assert_eq(monitors.size(), 0, "Non-array monitors coerced to empty array")


# ---------------------------------------------------------------------------
# 3) register_on — wires profiling.get_performance_monitors on the dispatcher
# ---------------------------------------------------------------------------

func test_register_on_wires_get_performance_monitors_on_dispatcher() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var dispatcher: Object = DISPATCHER_SCRIPT.new()

	tools.register_on(dispatcher)

	var response: Dictionary = dispatcher.dispatch({
		"jsonrpc": "2.0",
		"method": "profiling.get_performance_monitors",
		"params": {},
		"id": 1,
	})
	assert_true(response.has("result"), "profiling.get_performance_monitors must be reachable via dispatcher")
	assert_false(response.has("error"), "profiling.get_performance_monitors must not produce a dispatcher error")
