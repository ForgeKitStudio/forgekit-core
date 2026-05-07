extends GutTest
## Unit tests for the McpJsonRpcDispatcher auth-token gate.
##
## The dispatcher is shared between the WebSocket editor channel and the UDP
## runtime bridge. Both transports pass a per-request token to
## `dispatch(raw, request_token)` and register an `on_unauthorized` callable
## so they can close the connection once the dispatcher rejects the request
## with -32000 UNAUTHORIZED. These tests exercise only the auth path; the
## broader schema validation lives in `test_json_rpc_dispatcher.gd`.


const DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")
const MCP_ERRORS: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/mcp_error_codes.gd")

const EXPECTED_TOKEN: String = "0123456789abcdef0123456789abcdef"
const WRONG_TOKEN: String = "ffffffffffffffffffffffffffffffff"


# ---------------------------------------------------------------------------
# HandlerSink — captures invocations so we can assert the handler was (or
# was not) reached.
# ---------------------------------------------------------------------------

class HandlerSink:
	extends RefCounted

	var call_count: int = 0
	var received_params: Variant = null

	func handle(params: Variant) -> Variant:
		call_count += 1
		received_params = params
		return {"ok": true}


# ---------------------------------------------------------------------------
# UnauthorizedSink — stand-in for the transport layer's "close connection"
# hook. Counts how many times the dispatcher invoked it.
# ---------------------------------------------------------------------------

class UnauthorizedSink:
	extends RefCounted

	var call_count: int = 0

	func on_unauthorized() -> void:
		call_count += 1


func _new_dispatcher() -> Object:
	return DISPATCHER_SCRIPT.new()


func _ping_request(id: Variant = 1) -> Dictionary:
	var request: Dictionary = {
		"jsonrpc": "2.0",
		"method": "ping",
		"params": {},
	}
	if id != null:
		request["id"] = id
	return request


# ---------------------------------------------------------------------------
# Test A) Auth disabled (empty expected token) — request without any token is
# dispatched normally and returns a result envelope.
# ---------------------------------------------------------------------------

func test_auth_disabled_accepts_request_without_token() -> void:
	var dispatcher: Object = _new_dispatcher()
	var handler_sink: HandlerSink = HandlerSink.new()
	dispatcher.register_handler("ping", Callable(handler_sink, "handle"))

	var response: Dictionary = dispatcher.dispatch(_ping_request())

	assert_eq(handler_sink.call_count, 1, "Handler must run when auth is disabled")
	assert_true(response.has("result"), "Successful call must return a result envelope")
	assert_false(response.has("error"), "Successful call must not return an error envelope")


# ---------------------------------------------------------------------------
# Test B) Matching token — request is dispatched normally.
# ---------------------------------------------------------------------------

func test_matching_request_token_is_dispatched() -> void:
	var dispatcher: Object = _new_dispatcher()
	dispatcher.set_auth_token(EXPECTED_TOKEN)
	var handler_sink: HandlerSink = HandlerSink.new()
	dispatcher.register_handler("ping", Callable(handler_sink, "handle"))

	var response: Dictionary = dispatcher.dispatch(_ping_request(), EXPECTED_TOKEN)

	assert_eq(handler_sink.call_count, 1, "Handler must run when the request token matches the expected token")
	assert_true(response.has("result"), "Successful call must return a result envelope")
	assert_false(response.has("error"), "Successful call must not return an error envelope")


# ---------------------------------------------------------------------------
# Test C) Empty request token while auth is enabled — UNAUTHORIZED and the
# handler is not invoked.
# ---------------------------------------------------------------------------

func test_missing_request_token_returns_unauthorized_and_skips_handler() -> void:
	var dispatcher: Object = _new_dispatcher()
	dispatcher.set_auth_token(EXPECTED_TOKEN)
	var handler_sink: HandlerSink = HandlerSink.new()
	dispatcher.register_handler("ping", Callable(handler_sink, "handle"))

	var response: Dictionary = dispatcher.dispatch(_ping_request())

	assert_eq(handler_sink.call_count, 0, "Handler must not run when the request token is missing")
	var error: Dictionary = response.get("error", {})
	assert_eq(int(error.get("code", 0)), MCP_ERRORS.UNAUTHORIZED, "Missing token must yield -32000 UNAUTHORIZED")


# ---------------------------------------------------------------------------
# Test D) Wrong request token — UNAUTHORIZED and the handler is not invoked.
# ---------------------------------------------------------------------------

func test_wrong_request_token_returns_unauthorized_and_skips_handler() -> void:
	var dispatcher: Object = _new_dispatcher()
	dispatcher.set_auth_token(EXPECTED_TOKEN)
	var handler_sink: HandlerSink = HandlerSink.new()
	dispatcher.register_handler("ping", Callable(handler_sink, "handle"))

	var response: Dictionary = dispatcher.dispatch(_ping_request(), WRONG_TOKEN)

	assert_eq(handler_sink.call_count, 0, "Handler must not run when the request token is wrong")
	var error: Dictionary = response.get("error", {})
	assert_eq(int(error.get("code", 0)), MCP_ERRORS.UNAUTHORIZED, "Wrong token must yield -32000 UNAUTHORIZED")


# ---------------------------------------------------------------------------
# Test E) on_unauthorized callable fires exactly once on a mismatch so the
# transport layer can close the socket.
# ---------------------------------------------------------------------------

func test_on_unauthorized_callable_fires_once_on_mismatch() -> void:
	var dispatcher: Object = _new_dispatcher()
	dispatcher.set_auth_token(EXPECTED_TOKEN)
	var disconnect_sink: UnauthorizedSink = UnauthorizedSink.new()
	dispatcher.set_on_unauthorized(Callable(disconnect_sink, "on_unauthorized"))

	var _response: Dictionary = dispatcher.dispatch(_ping_request(), WRONG_TOKEN)

	assert_eq(disconnect_sink.call_count, 1, "on_unauthorized must fire exactly once on a token mismatch")


# ---------------------------------------------------------------------------
# Test F) UNAUTHORIZED envelope echoes a valid id when supplied and falls
# back to null when no id was present on the request.
# ---------------------------------------------------------------------------

func test_unauthorized_envelope_echoes_id_or_null() -> void:
	var dispatcher: Object = _new_dispatcher()
	dispatcher.set_auth_token(EXPECTED_TOKEN)

	var with_id: Dictionary = dispatcher.dispatch(_ping_request(42), WRONG_TOKEN)
	assert_true(with_id.has("id"), "UNAUTHORIZED envelope must include an id field")
	assert_eq(with_id.get("id"), 42, "UNAUTHORIZED envelope must echo the request id when one was supplied")

	var without_id: Dictionary = dispatcher.dispatch(_ping_request(null), WRONG_TOKEN)
	assert_true(without_id.has("id"), "UNAUTHORIZED envelope must include an id field even when the request had none")
	assert_eq(without_id.get("id"), null, "UNAUTHORIZED envelope must set id to null when the request had none")


# ---------------------------------------------------------------------------
# Test G) UNAUTHORIZED envelope uses the shared error catalog: code -32000,
# message "UNAUTHORIZED", and a non-empty data.suggestion String.
# ---------------------------------------------------------------------------

func test_unauthorized_envelope_uses_shared_error_catalog() -> void:
	var dispatcher: Object = _new_dispatcher()
	dispatcher.set_auth_token(EXPECTED_TOKEN)

	var response: Dictionary = dispatcher.dispatch(_ping_request(), WRONG_TOKEN)

	assert_eq(response.get("jsonrpc", ""), "2.0", "Error envelope must declare jsonrpc 2.0")
	var error: Dictionary = response.get("error", {})
	assert_eq(int(error.get("code", 0)), -32000, "UNAUTHORIZED code must equal -32000")
	assert_eq(String(error.get("message", "")), "UNAUTHORIZED", "UNAUTHORIZED message must be the stable catalog constant")

	assert_true(error.has("data"), "UNAUTHORIZED envelope must include a data dict")
	var data: Dictionary = error.get("data", {})
	var suggestion: String = String(data.get("suggestion", ""))
	assert_false(suggestion.is_empty(), "UNAUTHORIZED data.suggestion must be a non-empty String")
