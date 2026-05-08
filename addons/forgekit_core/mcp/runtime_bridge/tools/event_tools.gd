extends RefCounted
## McpRuntimeEventTools — JSON-RPC handler adapter for the runtime-channel
## event / log MCP tools.
##
## Exposes two handlers that translate JSON-RPC calls into calls on an
## injected RuntimeEventBackend. The backend is duck-typed so the adapter
## can run headlessly against a fake in unit tests while the production
## backend drives `GameEvents.emit_signal()` against the live Event_Bus and
## reads from the structured log ring buffer.
##
##   runtime.emit_event(signal_name, payload)   → {emitted, signal_name}
##                                               | {"error": {...}}
##   runtime.get_logs(max_lines?, level?)       → {lines: [{ts, level, message}]}
##
## Backends signal business-level failures (unknown signal name, payload-
## type mismatch per Requirement 2.4, empty log buffer with an unknown
## level filter) by returning `{"error": {...}}`. The adapter returns the
## envelope verbatim so the JSON-RPC dispatcher can hoist it into a
## top-level error response.


class_name McpRuntimeEventTools


# Injected RuntimeEventBackend (duck-typed).
var _backend: Object = null


func _init(backend: Object = null) -> void:
	_backend = backend


func set_backend(backend: Object) -> void:
	_backend = backend


# ---------------------------------------------------------------------------
# MCP tool handlers.
# ---------------------------------------------------------------------------

func emit_event(params: Variant) -> Variant:
	var signal_name: String = _get_string_param(params, "signal_name", 0, "")
	# `payload` defaults to an empty Dictionary so backends can assume a
	# Dictionary value without null-checking — simplifying the type-check
	# against the declared signal signature in GameEvents.
	var payload: Variant = _get_variant_param(params, "payload", 1, null)
	if not (payload is Dictionary):
		payload = {}
	return _backend.emit_event(signal_name, payload)


func get_logs(params: Variant) -> Variant:
	# `max_lines = -1` means "no limit"; `level = ""` means "no filter".
	# The backend is the source of truth for how these defaults translate
	# into its ring-buffer query.
	var max_lines: int = _get_int_param(params, "max_lines", 0, -1)
	var level: String = _get_string_param(params, "level", 1, "")
	return _backend.get_logs(max_lines, level)


## Bulk-register both runtime event MCP methods on the supplied
## dispatcher. Returns `self` so the caller can chain.
func register_on(dispatcher: Object) -> Object:
	dispatcher.register_handler("runtime.emit_event", Callable(self, "emit_event"))
	dispatcher.register_handler("runtime.get_logs", Callable(self, "get_logs"))
	return self


# ---------------------------------------------------------------------------
# Internals. Accept both by-name (Dictionary) and by-position (Array)
# JSON-RPC params conventions.
# ---------------------------------------------------------------------------

static func _get_string_param(params: Variant, key: String, index: int, default_value: String) -> String:
	if params is Dictionary:
		var dict: Dictionary = params as Dictionary
		if dict.has(key):
			var v: Variant = dict[key]
			if v is String:
				return String(v)
	elif params is Array:
		var arr: Array = params as Array
		if index >= 0 and index < arr.size():
			var v: Variant = arr[index]
			if v is String:
				return String(v)
	return default_value


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


static func _get_variant_param(params: Variant, key: String, index: int, default_value: Variant) -> Variant:
	if params is Dictionary:
		var dict: Dictionary = params as Dictionary
		if dict.has(key):
			return dict[key]
	elif params is Array:
		var arr: Array = params as Array
		if index >= 0 and index < arr.size():
			return arr[index]
	return default_value
