extends RefCounted
## McpRuntimeProfilingTools — JSON-RPC handler adapter for the runtime-
## channel profiling MCP tools.
##
## Exposes two handlers that translate JSON-RPC calls into calls on an
## injected RuntimeProfilingBackend. The backend is duck-typed so the
## adapter can run headlessly against a fake in unit tests while the
## production backend queries the live `Performance` singleton,
## samples `Performance.TIME_PROCESS` per frame into a circular buffer
## and reads `Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME`.
##
##   profiling.get_performance_monitors(monitors?) →
##       {monitors: {<name>: <float>, ...}}
##   profiling.get_frame_stats(window_frames?) →
##       {window_frames, samples, frame_time_ms: {p50, p95, p99}, draw_calls}
##
## For `profiling.get_performance_monitors`, `monitors` is an optional
## array of Godot `Performance` monitor names (for example `"fps"`,
## `"draw_calls"`, `"physics_frames"`). When omitted the backend returns
## the full baseline set (at minimum the three named monitors above);
## when provided, only the requested monitors are returned.
##
## For `profiling.get_frame_stats`, `window_frames` defaults to 120
## (≈2 s at 60 fps) when omitted. Values that are not positive integers
## produce an `{error: {...}}` envelope which the dispatcher hoists to a
## top-level JSON-RPC error.
##
## Percentiles are computed with the nearest-rank method so the values
## returned are always drawn from the input sample set — avoiding the
## interpolation artefacts of Type-7 percentile definitions that would
## otherwise surface in tiny buffers during warm-up.


class_name McpRuntimeProfilingTools


const DEFAULT_WINDOW_FRAMES: int = 120


# Injected RuntimeProfilingBackend (duck-typed). The backend MUST expose:
#   get_performance_monitors(monitors: Array) -> Variant
#     (returns {"monitors": {<name>: <float>, ...}})
#   get_frame_samples(window_frames: int) -> Array[float]   (ms per frame)
#   get_draw_calls() -> int
var _backend: Object = null


func _init(backend: Object = null) -> void:
	_backend = backend


func set_backend(backend: Object) -> void:
	_backend = backend


# ---------------------------------------------------------------------------
# MCP tool handlers.
# ---------------------------------------------------------------------------

func get_performance_monitors(params: Variant) -> Variant:
	var monitors: Array = _get_array_param(params, "monitors", 0, [])
	return _backend.get_performance_monitors(monitors)


func get_frame_stats(params: Variant) -> Variant:
	var window_frames: int = _get_int_param(params, "window_frames", 0, DEFAULT_WINDOW_FRAMES)
	if window_frames < 1:
		return {
			"error": {
				"code": "INVALID_ARGUMENT",
				"message": "window_frames must be a positive integer (got %d)." % window_frames,
			}
		}

	var samples: Array = _backend.get_frame_samples(window_frames)
	var draw_calls: int = int(_backend.get_draw_calls())

	return {
		"window_frames": window_frames,
		"samples": samples.size(),
		"frame_time_ms": {
			"p50": _percentile(samples, 0.50),
			"p95": _percentile(samples, 0.95),
			"p99": _percentile(samples, 0.99),
		},
		"draw_calls": draw_calls,
	}


## Register the profiling MCP methods on the supplied dispatcher. Returns
## `self` so the caller can chain.
func register_on(dispatcher: Object) -> Object:
	dispatcher.register_handler("profiling.get_performance_monitors", Callable(self, "get_performance_monitors"))
	dispatcher.register_handler("profiling.get_frame_stats", Callable(self, "get_frame_stats"))
	return self


# ---------------------------------------------------------------------------
# Internals.
# ---------------------------------------------------------------------------

## Nearest-rank percentile. Given an unsorted `values` array and a
## fractional `p` in [0, 1], returns the sample at rank
## `ceil(p * n)` (1-indexed). Returns 0.0 for an empty input.
static func _percentile(values: Array, p: float) -> float:
	if values.is_empty():
		return 0.0
	var sorted: Array = values.duplicate()
	sorted.sort()
	var n: int = sorted.size()
	var rank: int = int(ceil(p * float(n)))
	if rank < 1:
		rank = 1
	if rank > n:
		rank = n
	return float(sorted[rank - 1])


static func _get_int_param(params: Variant, key: String, index: int, default_value: int) -> int:
	if params is Dictionary:
		var dict: Dictionary = params as Dictionary
		if dict.has(key):
			var v: Variant = dict[key]
			if typeof(v) == TYPE_INT:
				return int(v)
			if typeof(v) == TYPE_FLOAT:
				return int(v)
	elif params is Array:
		var arr: Array = params as Array
		if index >= 0 and index < arr.size():
			var v: Variant = arr[index]
			if typeof(v) == TYPE_INT:
				return int(v)
			if typeof(v) == TYPE_FLOAT:
				return int(v)
	return default_value


## Read an Array-valued JSON-RPC parameter. When the caller omits the
## key, supplies a non-array value, or uses a positional param list
## without a matching entry, the default is returned. Arrays are
## duplicated so the backend cannot observe later mutations from the
## dispatcher side.
static func _get_array_param(params: Variant, key: String, index: int, default_value: Array) -> Array:
	if params is Dictionary:
		var dict: Dictionary = params as Dictionary
		if dict.has(key):
			var v: Variant = dict[key]
			if v is Array:
				return (v as Array).duplicate()
	elif params is Array:
		var arr: Array = params as Array
		if index >= 0 and index < arr.size():
			var v: Variant = arr[index]
			if v is Array:
				return (v as Array).duplicate()
	return default_value
