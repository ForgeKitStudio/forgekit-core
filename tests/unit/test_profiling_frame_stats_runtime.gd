extends GutTest
## Unit tests for the `profiling.get_frame_stats` handler on
## McpRuntimeProfilingTools: JSON-RPC adapter that returns percentile
## summaries of recent frame times plus the current draw-call count.
##
## This file is owned by task 3.13.2 and intentionally tests only the
## `get_frame_stats` handler. The `get_performance_monitors` handler on
## the same adapter class is covered by test_profiling_tools_runtime.gd
## (task 3.13.1).
##
## Covered handler:
##   profiling.get_frame_stats(window_frames?) →
##       {window_frames, samples, frame_time_ms: {p50, p95, p99}, draw_calls}
##
## The adapter is responsible for:
##   - Defaulting `window_frames` to 120 when omitted.
##   - Rejecting non-positive `window_frames` by returning an
##     `{error: {...}}` envelope that the dispatcher hoists to a
##     top-level JSON-RPC error.
##   - Computing p50/p95/p99 of the most recent `window_frames` samples
##     from the backend's circular buffer using the nearest-rank method.


const PROFILING_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/runtime_bridge/tools/profiling_tools.gd")
const DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")


class FakeRuntimeProfilingBackend:
	extends RefCounted

	var calls: Array = []
	var samples: Array = []
	var draw_calls_value: int = 0

	# Required by the adapter for the sibling handler; returns a benign
	# empty result so the adapter instantiation with this fake does not
	# rely on the sibling 3.13.1 test infrastructure.
	func get_performance_monitors(monitors: Array) -> Variant:
		calls.append({"op": "get_performance_monitors", "monitors": monitors.duplicate()})
		return {"monitors": {}}

	func get_frame_samples(window_frames: int) -> Array:
		calls.append({"op": "get_frame_samples", "window_frames": window_frames})
		# Return at most `window_frames` most recent samples, mirroring
		# the production backend's circular buffer semantics.
		var count: int = min(window_frames, samples.size())
		var out: Array = []
		var start_index: int = samples.size() - count
		for i in range(count):
			out.append(samples[start_index + i])
		return out

	func get_draw_calls() -> int:
		calls.append({"op": "get_draw_calls"})
		return draw_calls_value

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
# 1) Default window_frames — defaults to 120 when absent
# ---------------------------------------------------------------------------

func test_get_frame_stats_defaults_window_frames_to_120() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeProfilingBackend = env["backend"]

	var _result: Variant = tools.get_frame_stats({})

	var call: Dictionary = backend.find_calls("get_frame_samples")[0]
	assert_eq(int(call.get("window_frames", 0)), 120, "window_frames defaults to 120 when absent")


# ---------------------------------------------------------------------------
# 2) Explicit window_frames is forwarded to the backend
# ---------------------------------------------------------------------------

func test_get_frame_stats_forwards_explicit_window_frames() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeProfilingBackend = env["backend"]

	var _result: Variant = tools.get_frame_stats({"window_frames": 60})

	var call: Dictionary = backend.find_calls("get_frame_samples")[0]
	assert_eq(int(call.get("window_frames", 0)), 60, "Explicit window_frames forwarded")


func test_get_frame_stats_accepts_positional_param() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeProfilingBackend = env["backend"]

	var _result: Variant = tools.get_frame_stats([300])

	var call: Dictionary = backend.find_calls("get_frame_samples")[0]
	assert_eq(int(call.get("window_frames", 0)), 300, "Positional window_frames forwarded")


# ---------------------------------------------------------------------------
# 3) Percentile computation over a known sequence (nearest-rank method)
# ---------------------------------------------------------------------------

func test_get_frame_stats_computes_p50_p95_p99_on_known_sequence() -> void:
	# Feed a sorted 1..100 sequence. Using the nearest-rank definition,
	# p50 = ceil(0.50 * 100) = index 50 → value 50
	# p95 = ceil(0.95 * 100) = index 95 → value 95
	# p99 = ceil(0.99 * 100) = index 99 → value 99
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeProfilingBackend = env["backend"]
	backend.samples = []
	for i in range(1, 101):
		backend.samples.append(float(i))

	var result: Variant = tools.get_frame_stats({"window_frames": 100})
	var dict: Dictionary = result as Dictionary
	var ft: Dictionary = dict["frame_time_ms"] as Dictionary

	assert_almost_eq(float(ft.get("p50", 0.0)), 50.0, 0.0001, "p50 on 1..100")
	assert_almost_eq(float(ft.get("p95", 0.0)), 95.0, 0.0001, "p95 on 1..100")
	assert_almost_eq(float(ft.get("p99", 0.0)), 99.0, 0.0001, "p99 on 1..100")


func test_get_frame_stats_percentiles_independent_of_input_order() -> void:
	# Percentile values must be invariant under permutation of samples.
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeProfilingBackend = env["backend"]
	# Descending 100..1 should give identical percentiles to 1..100.
	backend.samples = []
	for i in range(100, 0, -1):
		backend.samples.append(float(i))

	var result: Variant = tools.get_frame_stats({"window_frames": 100})
	var dict: Dictionary = result as Dictionary
	var ft: Dictionary = dict["frame_time_ms"] as Dictionary

	assert_almost_eq(float(ft.get("p50", 0.0)), 50.0, 0.0001, "p50 invariant under permutation")
	assert_almost_eq(float(ft.get("p95", 0.0)), 95.0, 0.0001, "p95 invariant under permutation")
	assert_almost_eq(float(ft.get("p99", 0.0)), 99.0, 0.0001, "p99 invariant under permutation")


# ---------------------------------------------------------------------------
# 4) Response shape — includes window_frames, samples, frame_time_ms, draw_calls
# ---------------------------------------------------------------------------

func test_get_frame_stats_returns_required_envelope_fields() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeProfilingBackend = env["backend"]
	backend.samples = [10.0, 11.0, 12.0, 13.0, 14.0]
	backend.draw_calls_value = 742

	var result: Variant = tools.get_frame_stats({"window_frames": 120})
	var dict: Dictionary = result as Dictionary

	assert_true(dict.has("window_frames"), "Result must include 'window_frames'")
	assert_true(dict.has("samples"), "Result must include 'samples' (actual count)")
	assert_true(dict.has("frame_time_ms"), "Result must include 'frame_time_ms'")
	assert_true(dict.has("draw_calls"), "Result must include 'draw_calls'")
	assert_eq(int(dict.get("window_frames", 0)), 120, "window_frames echoes request")
	assert_eq(int(dict.get("samples", 0)), 5, "samples reports actual buffered count")
	assert_eq(int(dict.get("draw_calls", 0)), 742, "draw_calls forwarded from backend")
	var ft: Dictionary = dict["frame_time_ms"] as Dictionary
	assert_true(ft.has("p50"), "frame_time_ms.p50 present")
	assert_true(ft.has("p95"), "frame_time_ms.p95 present")
	assert_true(ft.has("p99"), "frame_time_ms.p99 present")


# ---------------------------------------------------------------------------
# 5) Empty buffer — percentiles are 0.0 when no samples are available
# ---------------------------------------------------------------------------

func test_get_frame_stats_returns_zero_percentiles_on_empty_buffer() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeProfilingBackend = env["backend"]
	backend.samples = []

	var result: Variant = tools.get_frame_stats({"window_frames": 120})
	var dict: Dictionary = result as Dictionary
	var ft: Dictionary = dict["frame_time_ms"] as Dictionary

	assert_eq(int(dict.get("samples", -1)), 0, "samples reports zero")
	assert_almost_eq(float(ft.get("p50", -1.0)), 0.0, 0.0001, "p50 is 0.0 on empty buffer")
	assert_almost_eq(float(ft.get("p95", -1.0)), 0.0, 0.0001, "p95 is 0.0 on empty buffer")
	assert_almost_eq(float(ft.get("p99", -1.0)), 0.0, 0.0001, "p99 is 0.0 on empty buffer")


# ---------------------------------------------------------------------------
# 6) Invalid window_frames — non-positive values produce an error envelope
# ---------------------------------------------------------------------------

func test_get_frame_stats_rejects_zero_window_frames() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]

	var result: Variant = tools.get_frame_stats({"window_frames": 0})
	var dict: Dictionary = result as Dictionary

	assert_true(dict.has("error"), "Zero window_frames returns an error envelope")
	var err: Dictionary = dict["error"] as Dictionary
	assert_eq(String(err.get("code", "")), "INVALID_ARGUMENT", "Error code is INVALID_ARGUMENT")


func test_get_frame_stats_rejects_negative_window_frames() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]

	var result: Variant = tools.get_frame_stats({"window_frames": -10})
	var dict: Dictionary = result as Dictionary

	assert_true(dict.has("error"), "Negative window_frames returns an error envelope")


# ---------------------------------------------------------------------------
# 7) register_on wires profiling.get_frame_stats onto the dispatcher
# ---------------------------------------------------------------------------

func test_register_on_wires_get_frame_stats_on_dispatcher() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeProfilingBackend = env["backend"]
	backend.samples = [16.0, 16.5, 17.0]
	var dispatcher: Object = DISPATCHER_SCRIPT.new()

	tools.register_on(dispatcher)

	var response: Dictionary = dispatcher.dispatch({
		"jsonrpc": "2.0",
		"method": "profiling.get_frame_stats",
		"params": {"window_frames": 3},
		"id": 1,
	})
	assert_true(response.has("result"), "profiling.get_frame_stats must be reachable via dispatcher")
	assert_false(response.has("error"), "profiling.get_frame_stats must not produce a dispatcher error")
