extends RefCounted
## McpRuntimeEvalTools — JSON-RPC handler adapter for the runtime-channel
## `runtime.eval_safe` MCP tool.
##
## Per Requirements 8.10 and 26.5, `runtime.eval_safe` MUST route the
## `expr` parameter exclusively through Smart_Type_Parser (closed grammar,
## no `eval`, no arbitrary GDScript execution). This adapter forwards the
## String `expr` verbatim to an injected RuntimeEvalBackend; the backend
## is the single source of truth for parsing and is the ONLY code path
## that reaches Smart_Type_Parser. The adapter never parses, rewrites,
## concatenates, or otherwise inspects the `expr` string itself.
##
## When the backend's Smart_Type_Parser rejects a construct outside the
## closed grammar, it returns an `{"error": {"code": -32XXX, "message":
## "INVALID_LITERAL", "data": {position, fragment, suggestion?}}}` envelope
## that this adapter passes through unchanged. The JSON-RPC dispatcher
## hoists the envelope into a top-level error response shape.
##
##   runtime.eval_safe(expr) → {value} | {"error": {...}}


class_name McpRuntimeEvalTools


# Injected RuntimeEvalBackend (duck-typed).
var _backend: Object = null


func _init(backend: Object = null) -> void:
	_backend = backend


func set_backend(backend: Object) -> void:
	_backend = backend


# ---------------------------------------------------------------------------
# MCP tool handlers.
# ---------------------------------------------------------------------------

func eval_safe(params: Variant) -> Variant:
	# Forward `expr` VERBATIM. The backend owns Smart_Type_Parser — the
	# adapter never touches the string beyond extracting it from the
	# JSON-RPC params envelope.
	var expr: String = _get_string_param(params, "expr", 0, "")
	return _backend.eval_safe(expr)


## Register the runtime.eval_safe MCP method on the supplied dispatcher.
## Returns `self` so the caller can chain.
func register_on(dispatcher: Object) -> Object:
	dispatcher.register_handler("runtime.eval_safe", Callable(self, "eval_safe"))
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
