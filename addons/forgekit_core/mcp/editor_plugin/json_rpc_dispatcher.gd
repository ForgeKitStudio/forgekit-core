extends RefCounted
## JSON-RPC 2.0 dispatcher for the ForgeKit MCP editor plugin.
##
## Validates the schema of every incoming request before dispatching to a
## registered tool handler. Each payload from the client is treated as
## untrusted input: the dispatcher parses strings through `JSON.new().parse()`,
## asserts the request shape against JSON-RPC 2.0, and only then looks up the
## method in its handler map.
##
## Validation outcomes map to the four JSON-RPC "pre-defined" error codes this
## task needs:
##   -32700  Parse error          malformed JSON in a raw-string request
##   -32600  Invalid Request      jsonrpc!="2.0", missing/empty method,
##                                non-String method, non-scalar id
##   -32601  Method not found     method not present in the handler map
##   -32602  Invalid params       params present but not Dictionary/Array
##
## Additional business-level error codes (auth, boundary, file-not-found,
## ...) live in `mcp_error_codes.gd` and are referenced through the
## `McpErrorCodes` preload below so the dispatcher's error surface is a
## single import away for tool handlers and sibling modules.


class_name McpJsonRpcDispatcher


const McpErrorCodes: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/mcp_error_codes.gd")


# ---------------------------------------------------------------------------
# Error codes (JSON-RPC 2.0 pre-defined range). Kept local to this file;
# `McpErrorCodes` above exposes the application-defined server-error range
# (-32000 to -32099) used by downstream tool handlers.
# ---------------------------------------------------------------------------

const PARSE_ERROR: int = -32700
const INVALID_REQUEST: int = -32600
const METHOD_NOT_FOUND: int = -32601
const INVALID_PARAMS: int = -32602

const PARSE_ERROR_MESSAGE: String = "Parse error"
const INVALID_REQUEST_MESSAGE: String = "Invalid Request"
const METHOD_NOT_FOUND_MESSAGE: String = "Method not found"
const INVALID_PARAMS_MESSAGE: String = "Invalid params"

const JSONRPC_VERSION: String = "2.0"

# How many method names to inline into a method-not-found suggestion string
# before truncating with an ellipsis.
const _SUGGESTION_METHOD_LIMIT: int = 10


# Keyed by method name; values are Callables invoked as `handler.call(params)`.
var _handlers: Dictionary = {}

# Shared auth token expected on every incoming request. An empty string means
# "auth disabled" — the check is skipped entirely. Populated from the
# `auth_token` field of plugin_config.tres / runtime_config.tres by the
# transport layer.
var _expected_token: String = ""

# Optional hook invoked when the dispatcher rejects a request with
# UNAUTHORIZED. The transport layer uses this signal to close the offending
# socket. `null` means no-op.
var _on_unauthorized: Callable = Callable()

# Trace context {trace_id, span_id} attached to the most recent dispatch()
# call. Transports read it after `dispatch()` returns to forward log lines
# through `McpJsonlLogger.log(..., trace_id, span_id)`. Initialised to an
# empty Dictionary until the first dispatch completes.
var _last_trace_context: Dictionary = {}

# Optional metrics sink. Invoked as `sink.call(metric_name, delta)` for
# every canonical counter the dispatcher emits:
#   - `mcp.requests.total` on every dispatch (success, error, or
#     notification).
#   - `mcp.requests.errors` on every dispatch that returns a JSON-RPC
#     error envelope.
# Kept as a Callable rather than an object reference so tests and the
# production lifecycle can inject any sink that exposes a single
# `(name: String, delta: int) -> void` method.
var _metrics_sink: Callable = Callable()


## Configure the shared auth token this dispatcher compares against the
## per-request token passed to `dispatch()`. An empty string disables the
## check entirely (fresh template / dev mode).
func set_auth_token(token: String) -> void:
	_expected_token = token


## Register a callable that fires whenever the dispatcher emits an
## UNAUTHORIZED error. Transports use it to close the connection. Pass an
## empty Callable to clear.
func set_on_unauthorized(callable: Callable) -> void:
	_on_unauthorized = callable


## Read the trace context (`{trace_id, span_id}`) attached to the most
## recent `dispatch()` call. Returns an empty Dictionary before the first
## dispatch completes.
func get_last_trace_context() -> Dictionary:
	return _last_trace_context.duplicate(true)


## Register a metrics sink Callable. `sink` is invoked as
## `sink.call(metric_name: String, delta: int)` on every dispatch, once
## with `mcp.requests.total` + `1`, and again with `mcp.requests.errors`
## + `1` when the dispatcher returns a JSON-RPC error envelope. Pass an
## empty Callable to unregister the sink.
func set_metrics_sink(callable: Callable) -> void:
	_metrics_sink = callable


## Register `callable` as the handler for `method`. Collisions emit a
## push_warning and overwrite the previous entry.
func register_handler(method: String, callable: Callable) -> void:
	if _handlers.has(method):
		push_warning("McpJsonRpcDispatcher: handler for method '%s' is being overwritten." % method)
	_handlers[method] = callable


## Remove the handler previously registered under `method`. No-op if absent.
func unregister_handler(method: String) -> void:
	_handlers.erase(method)


## Dispatch a single JSON-RPC request.
##
## `raw` may be either a parsed Dictionary or a JSON-encoded String.
## `request_token` is the transport-supplied shared secret extracted from
## the WebSocket `Authorization: Bearer ...` header or the UDP packet
## header. When the dispatcher has been configured with a non-empty expected
## token via `set_auth_token()` and `request_token` does not match, the
## dispatcher returns a -32000 UNAUTHORIZED envelope and invokes the
## `on_unauthorized` callback if one was registered, without ever reaching
## the handler.
##
## On any other validation failure the return value is a well-formed
## JSON-RPC error envelope; on a successful notification (no `id` field) the
## return value is an empty Dictionary; on a successful call the return
## value is a result envelope `{jsonrpc, result, id}`.
func dispatch(raw: Variant, request_token: String = "") -> Dictionary:
	var response: Dictionary = _dispatch_inner(raw, request_token)
	_emit_request_metrics(response)
	return response


## Internal dispatch core. Kept separate so the public `dispatch()` can
## emit observability metrics once per call regardless of which return
## path the core took.
func _dispatch_inner(raw: Variant, request_token: String) -> Dictionary:
	var request: Dictionary = {}

	if raw is String:
		# Use JSON.new().parse() rather than JSON.parse_string() so a malformed
		# payload returns an error code silently instead of logging an engine
		# error to stderr. The dispatcher translates the failure into a
		# well-formed JSON-RPC -32700 response below.
		var parser: JSON = JSON.new()
		var parse_err: int = parser.parse(raw)
		if parse_err != OK or not (parser.data is Dictionary):
			_last_trace_context = _new_trace_context()
			return _error_envelope(PARSE_ERROR, PARSE_ERROR_MESSAGE, null,
				"Request body is not valid JSON; expected a JSON-RPC 2.0 object.")
		request = parser.data
	elif raw is Dictionary:
		request = raw
	else:
		_last_trace_context = _new_trace_context()
		return _error_envelope(INVALID_REQUEST, INVALID_REQUEST_MESSAGE, null,
			"Request must be a Dictionary or a JSON-encoded String.")

	# ---- trace context ---------------------------------------------------
	# Transports inject `_forgekit_trace` ({trace_id, span_id}) when they
	# are carrying a trace from an upstream caller. When absent, mint a
	# fresh pair so every request is correlatable even if the edge did
	# not inject one.
	_last_trace_context = _extract_or_mint_trace_context(request)

	# ---- id validation comes first so later errors can echo it -----------
	var has_id: bool = request.has("id")
	var raw_id: Variant = request.get("id") if has_id else null
	var id_is_valid: bool = (not has_id) or _is_valid_id(raw_id)
	var echo_id: Variant = raw_id if (has_id and id_is_valid) else null

	if has_id and not id_is_valid:
		return _error_envelope(INVALID_REQUEST, INVALID_REQUEST_MESSAGE, null,
			"Request 'id' must be a String, integer, or null.")

	# ---- auth gate -------------------------------------------------------
	# Auth is checked before schema validation (jsonrpc / method / params) so
	# that an unauthorized caller never learns whether their method name
	# exists or their params shape is correct.
	if not _expected_token.is_empty() and request_token != _expected_token:
		if _on_unauthorized.is_valid():
			_on_unauthorized.call()
		return _unauthorized_envelope(echo_id)

	# ---- jsonrpc field ---------------------------------------------------
	if not request.has("jsonrpc"):
		return _error_envelope(INVALID_REQUEST, INVALID_REQUEST_MESSAGE, echo_id,
			"Request must contain a 'jsonrpc' field set to \"2.0\".")
	var jsonrpc_value: Variant = request.get("jsonrpc")
	if not (jsonrpc_value is String) or String(jsonrpc_value) != JSONRPC_VERSION:
		return _error_envelope(INVALID_REQUEST, INVALID_REQUEST_MESSAGE, echo_id,
			"Request 'jsonrpc' field must equal the string \"2.0\".")

	# ---- method field ----------------------------------------------------
	if not request.has("method"):
		return _error_envelope(INVALID_REQUEST, INVALID_REQUEST_MESSAGE, echo_id,
			"Request must contain a non-empty 'method' String.")
	var method_value: Variant = request.get("method")
	if not (method_value is String):
		return _error_envelope(INVALID_REQUEST, INVALID_REQUEST_MESSAGE, echo_id,
			"Request 'method' must be a String.")
	var method_name: String = String(method_value)
	if method_name.is_empty():
		return _error_envelope(INVALID_REQUEST, INVALID_REQUEST_MESSAGE, echo_id,
			"Request 'method' must be a non-empty String.")

	# ---- params field (optional) ----------------------------------------
	var params: Variant = {}
	if request.has("params"):
		var raw_params: Variant = request.get("params")
		if not (raw_params is Dictionary) and not (raw_params is Array):
			return _error_envelope(INVALID_PARAMS, INVALID_PARAMS_MESSAGE, echo_id,
				"Request 'params' must be a Dictionary (by-name) or an Array (by-position).")
		params = raw_params

	# ---- handler lookup --------------------------------------------------
	if not _handlers.has(method_name):
		return _error_envelope(METHOD_NOT_FOUND, METHOD_NOT_FOUND_MESSAGE, echo_id,
			"Unknown method '%s'. Available methods: %s." % [method_name, _format_available_methods()])

	var handler: Callable = _handlers[method_name]
	var result: Variant = handler.call(params)

	# ---- business-error hoisting ----------------------------------------
	# Handlers signal a business-level failure by returning a Dictionary
	# shaped `{"error": {"code": int, "message": String, "data": ...}}`.
	# The dispatcher lifts that envelope into a top-level JSON-RPC error
	# response so callers see a standards-compliant error shape rather
	# than a `result` that happens to contain an `error` field. Shape is
	# validated defensively: only Dictionaries whose `error` field is also
	# a Dictionary with a numeric `code` are treated as errors — anything
	# else is a normal `result`.
	if _looks_like_error_envelope(result):
		if not has_id:
			return {}
		return {
			"jsonrpc": JSONRPC_VERSION,
			"error": (result as Dictionary).get("error", {}),
			"id": echo_id,
		}

	# ---- response shape --------------------------------------------------
	# JSON-RPC 2.0: requests without an `id` are notifications and receive
	# no result envelope. Errors must still be reported with id=null so
	# callers can log them.
	if not has_id:
		return {}

	return {
		"jsonrpc": JSONRPC_VERSION,
		"result": result,
		"id": echo_id,
	}


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------

func _is_valid_id(value: Variant) -> bool:
	if value == null:
		return true
	if value is String:
		return true
	# JSON-RPC 2.0 allows integer ids. Godot's JSON parser returns ints as
	# TYPE_INT, but JSON-RPC also permits fractionless floats; accept both
	# numeric types here and let downstream code coerce if needed.
	var t: int = typeof(value)
	return t == TYPE_INT or t == TYPE_FLOAT


# Handlers signal a business-level failure by returning a Dictionary shaped
# `{"error": {"code": int, "message": String, ...}}`. This helper recognises
# that shape so the dispatcher can hoist it into a JSON-RPC error response.
func _looks_like_error_envelope(value: Variant) -> bool:
	if not (value is Dictionary):
		return false
	var dict: Dictionary = value as Dictionary
	if not dict.has("error"):
		return false
	var err: Variant = dict.get("error")
	if not (err is Dictionary):
		return false
	var err_dict: Dictionary = err as Dictionary
	if not err_dict.has("code"):
		return false
	var t: int = typeof(err_dict.get("code"))
	return t == TYPE_INT or t == TYPE_FLOAT


func _error_envelope(code: int, message: String, id: Variant, suggestion: String) -> Dictionary:
	return {
		"jsonrpc": JSONRPC_VERSION,
		"error": {
			"code": code,
			"message": message,
			"data": {"suggestion": suggestion},
		},
		"id": id,
	}


## Build the -32000 UNAUTHORIZED envelope using the shared error catalog so
## the `message` string and default `data.suggestion` stay in sync with the
## rest of the MCP surface.
func _unauthorized_envelope(id: Variant) -> Dictionary:
	return {
		"jsonrpc": JSONRPC_VERSION,
		"error": McpErrorCodes.make_error(McpErrorCodes.UNAUTHORIZED),
		"id": id,
	}


func _format_available_methods() -> String:
	var names: Array = _handlers.keys()
	names.sort()
	if names.is_empty():
		return "(none registered)"
	if names.size() <= _SUGGESTION_METHOD_LIMIT:
		return ", ".join(names)
	var truncated: Array = names.slice(0, _SUGGESTION_METHOD_LIMIT)
	return "%s, ..." % ", ".join(truncated)


# ---------------------------------------------------------------------------
# Trace context helpers.
# ---------------------------------------------------------------------------

## Extract `{trace_id, span_id}` from the `_forgekit_trace` envelope when
## both fields parse as hex strings of the expected width; otherwise mint a
## fresh pair. Returns a new Dictionary on every call.
func _extract_or_mint_trace_context(request: Dictionary) -> Dictionary:
	if request.has("_forgekit_trace"):
		var envelope: Variant = request.get("_forgekit_trace")
		if envelope is Dictionary:
			var dict: Dictionary = envelope as Dictionary
			var trace_id: String = String(dict.get("trace_id", ""))
			var span_id: String = String(dict.get("span_id", ""))
			if _is_valid_trace_id(trace_id) and _is_valid_span_id(span_id):
				return {"trace_id": trace_id, "span_id": span_id}
	return _new_trace_context()


## Mint an 8-char lowercase hex trace_id plus a 4-char lowercase hex
## span_id. Uses `randi()` which is seeded from the system clock at startup
## so values are non-deterministic but reproducible under a manual
## `seed()` call from tests if needed.
func _new_trace_context() -> Dictionary:
	return {
		"trace_id": _random_hex_lowercase(8),
		"span_id": _random_hex_lowercase(4),
	}


static func _random_hex_lowercase(width: int) -> String:
	var out: String = ""
	for i in range(width):
		out += _HEX_ALPHABET[randi() % 16]
	return out


const _HEX_ALPHABET: Array = ["0", "1", "2", "3", "4", "5", "6", "7",
	"8", "9", "a", "b", "c", "d", "e", "f"]


static func _is_valid_trace_id(value: String) -> bool:
	return _is_lowercase_hex(value, 8)


static func _is_valid_span_id(value: String) -> bool:
	return _is_lowercase_hex(value, 4)


static func _is_lowercase_hex(value: String, expected_width: int) -> bool:
	if value.length() != expected_width:
		return false
	for c in value:
		var is_digit: bool = c >= "0" and c <= "9"
		var is_lower_hex: bool = c >= "a" and c <= "f"
		if not is_digit and not is_lower_hex:
			return false
	return true


# ---------------------------------------------------------------------------
# Metrics wiring.
# ---------------------------------------------------------------------------

## Emit `mcp.requests.total` plus (when the response is an error envelope)
## `mcp.requests.errors`. Silently no-ops when no sink has been
## registered. A response with an `error` Dictionary is treated as an
## error; anything else (including empty-dictionary notification
## acknowledgements) is a success.
func _emit_request_metrics(response: Dictionary) -> void:
	if not _metrics_sink.is_valid():
		return
	_metrics_sink.call("mcp.requests.total", 1)
	if response.has("error"):
		_metrics_sink.call("mcp.requests.errors", 1)
