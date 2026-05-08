extends GutTest
## Unit tests for McpRuntimePacketParser — the UDP packet parser that
## sits between McpUdpServer (receive loop) and McpJsonRpcDispatcher
## (business dispatch).
##
## Responsibilities covered here:
##   1. Size gate: reject datagrams larger than `max_packet_bytes`
##      (default 65507) with a -32005 PACKET_TOO_LARGE error envelope
##      whose `data.size` is the actual datagram size and whose
##      `data.limit` is the configured maximum.
##   2. Auth gate: verify the `auth_token` field embedded in the JSON
##      payload matches the configured expected token; mismatch
##      returns a -32000 UNAUTHORIZED envelope.
##   3. Metrics: `mcp.runtime_bridge.udp_packets.received` is
##      incremented for every datagram that enters the parser;
##      `mcp.runtime_bridge.udp_packets.rejected` is incremented for
##      every datagram the parser refuses (size or auth).
##
## The parser returns a plain Dictionary so McpUdpServer can feed
## either the parsed JSON-RPC request (on ok) or the error envelope
## (on rejection) to McpJsonRpcDispatcher without owning any transport
## state itself.


const PARSER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/runtime_bridge/packet_parser.gd")
const MCP_ERRORS: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/mcp_error_codes.gd")

const UDP_LIMIT_BYTES: int = 65507

const EXPECTED_TOKEN: String = "0123456789abcdef0123456789abcdef"
const WRONG_TOKEN: String = "ffffffffffffffffffffffffffffffff"

const METRIC_RECEIVED: String = "mcp.runtime_bridge.udp_packets.received"
const METRIC_REJECTED: String = "mcp.runtime_bridge.udp_packets.rejected"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

func _new_parser() -> Object:
	return PARSER_SCRIPT.new()


func _encode(payload: Dictionary) -> PackedByteArray:
	return JSON.stringify(payload).to_utf8_buffer()


func _build_ping_request(token: String = "") -> Dictionary:
	var request: Dictionary = {
		"jsonrpc": "2.0",
		"method": "ping",
		"params": {},
		"id": 1,
	}
	if not token.is_empty():
		request["auth_token"] = token
	return request


func _make_oversized_buffer(size_bytes: int) -> PackedByteArray:
	# Produces a buffer of exactly `size_bytes` arbitrary bytes. Content
	# does not matter because the size gate fires before any UTF-8 /
	# JSON decoding.
	var buf: PackedByteArray = PackedByteArray()
	buf.resize(size_bytes)
	return buf


# ===========================================================================
# 1) Size gate
# ===========================================================================

func test_packet_under_limit_is_accepted_when_auth_is_disabled() -> void:
	var parser: Object = _new_parser()
	var raw: PackedByteArray = _encode(_build_ping_request())

	var result: Dictionary = parser.parse(raw)

	assert_true(result.get("ok", false), "A well-formed packet under the size limit must be accepted")
	assert_false(result.has("error"), "An accepted packet must not carry an error envelope")
	var request: Dictionary = result.get("request", {})
	assert_eq(String(request.get("method", "")), "ping", "Parser must surface the parsed request to the dispatcher")


func test_packet_at_exactly_limit_is_accepted() -> void:
	# A packet whose size equals the UDP limit must be accepted: the
	# limit is a maximum, not a strict upper bound.
	var parser: Object = _new_parser()
	# Craft a JSON document whose serialized UTF-8 size hits the limit.
	# We pad a known-valid JSON-RPC envelope with a filler string inside
	# `params.pad` until the total length reaches UDP_LIMIT_BYTES.
	var base: Dictionary = _build_ping_request()
	var encoded: PackedByteArray = _encode(base)
	var padding_needed: int = UDP_LIMIT_BYTES - encoded.size()
	# Reserve room for `"pad":"..."` (nine bytes of JSON framing plus the
	# comma that separates it from `params`'s empty `{}` — rebuilt below
	# to keep the math precise).
	var padded: Dictionary = base.duplicate(true)
	padded["params"] = {"pad": "x".repeat(max(0, padding_needed - 14))}
	# If padding produced a too-small payload, pad further; if too large,
	# trim. A small iterative adjustment keeps the test robust against
	# any small framing delta between Godot's JSON stringify variants.
	var raw: PackedByteArray = _encode(padded)
	var guard: int = 0
	while raw.size() != UDP_LIMIT_BYTES and guard < 32:
		var pad_value: String = padded["params"]["pad"] as String
		if raw.size() < UDP_LIMIT_BYTES:
			pad_value += "x".repeat(UDP_LIMIT_BYTES - raw.size())
		else:
			pad_value = pad_value.substr(0, pad_value.length() - (raw.size() - UDP_LIMIT_BYTES))
		padded["params"]["pad"] = pad_value
		raw = _encode(padded)
		guard += 1
	assert_eq(raw.size(), UDP_LIMIT_BYTES, "Test precondition: must construct a packet of exactly UDP_LIMIT_BYTES")

	var result: Dictionary = parser.parse(raw)

	assert_true(result.get("ok", false), "A packet of exactly %d bytes must be accepted (limit is inclusive)" % UDP_LIMIT_BYTES)
	assert_false(result.has("error"), "An accepted packet must not carry an error envelope")


func test_packet_over_limit_is_rejected_with_packet_too_large() -> void:
	var parser: Object = _new_parser()
	var oversized_size: int = UDP_LIMIT_BYTES + 1
	var raw: PackedByteArray = _make_oversized_buffer(oversized_size)

	var result: Dictionary = parser.parse(raw)

	assert_false(result.get("ok", true), "Packet over the size limit must be rejected")
	assert_true(result.has("error"), "Rejected packet must carry a JSON-RPC error envelope")
	var error: Dictionary = result.get("error", {})
	assert_eq(int(error.get("code", 0)), MCP_ERRORS.PACKET_TOO_LARGE, "Error code must be -32005 PACKET_TOO_LARGE")
	assert_eq(String(error.get("message", "")), MCP_ERRORS.PACKET_TOO_LARGE_MESSAGE, "Error message must be the canonical PACKET_TOO_LARGE constant")
	var data: Dictionary = error.get("data", {})
	assert_eq(int(data.get("size", 0)), oversized_size, "Error data.size must report the actual datagram size")
	assert_eq(int(data.get("limit", 0)), UDP_LIMIT_BYTES, "Error data.limit must report the configured maximum")
	assert_true(data.has("suggestion"), "Error data must include a suggestion field per the shared error catalog")


func test_rejection_on_size_does_not_require_valid_utf8() -> void:
	# The size gate fires before any UTF-8 / JSON decoding, so an
	# oversized buffer of arbitrary bytes (not a valid UTF-8 string, no
	# JSON framing) still gets a clean PACKET_TOO_LARGE envelope.
	var parser: Object = _new_parser()
	var raw: PackedByteArray = PackedByteArray()
	for _i in range(UDP_LIMIT_BYTES + 10):
		raw.append(0xFF)  # 0xFF is invalid as a standalone UTF-8 byte.

	var result: Dictionary = parser.parse(raw)

	assert_false(result.get("ok", true), "Oversized non-UTF-8 buffer must still be rejected")
	var error: Dictionary = result.get("error", {})
	assert_eq(int(error.get("code", 0)), MCP_ERRORS.PACKET_TOO_LARGE, "Size gate must run before UTF-8 decoding")


func test_size_limit_is_configurable_via_set_max_packet_bytes() -> void:
	var parser: Object = _new_parser()
	parser.set_max_packet_bytes(128)
	var raw: PackedByteArray = _make_oversized_buffer(200)

	var result: Dictionary = parser.parse(raw)

	assert_false(result.get("ok", true), "Custom max_packet_bytes must gate smaller packets too")
	var error: Dictionary = result.get("error", {})
	assert_eq(int(error.get("code", 0)), MCP_ERRORS.PACKET_TOO_LARGE, "Error code must remain PACKET_TOO_LARGE for a custom limit")
	assert_eq(int(error.get("data", {}).get("limit", 0)), 128, "data.limit must reflect the configured custom limit")
	assert_eq(int(error.get("data", {}).get("size", 0)), 200, "data.size must reflect the actual packet size against the custom limit")


# ===========================================================================
# 2) Auth gate
# ===========================================================================

func test_missing_auth_token_is_rejected_with_unauthorized() -> void:
	var parser: Object = _new_parser()
	parser.set_auth_token(EXPECTED_TOKEN)
	var raw: PackedByteArray = _encode(_build_ping_request())  # no auth_token field

	var result: Dictionary = parser.parse(raw)

	assert_false(result.get("ok", true), "Missing auth_token must be rejected when auth is enabled")
	var error: Dictionary = result.get("error", {})
	assert_eq(int(error.get("code", 0)), MCP_ERRORS.UNAUTHORIZED, "Error code must be -32000 UNAUTHORIZED for a missing auth_token")
	assert_eq(String(error.get("message", "")), MCP_ERRORS.UNAUTHORIZED_MESSAGE, "Error message must be the canonical UNAUTHORIZED constant")


func test_wrong_auth_token_is_rejected_with_unauthorized() -> void:
	var parser: Object = _new_parser()
	parser.set_auth_token(EXPECTED_TOKEN)
	var raw: PackedByteArray = _encode(_build_ping_request(WRONG_TOKEN))

	var result: Dictionary = parser.parse(raw)

	assert_false(result.get("ok", true), "Mismatched auth_token must be rejected when auth is enabled")
	var error: Dictionary = result.get("error", {})
	assert_eq(int(error.get("code", 0)), MCP_ERRORS.UNAUTHORIZED, "Error code must be UNAUTHORIZED for a mismatched token")


func test_matching_auth_token_is_accepted_and_stripped_from_request() -> void:
	var parser: Object = _new_parser()
	parser.set_auth_token(EXPECTED_TOKEN)
	var raw: PackedByteArray = _encode(_build_ping_request(EXPECTED_TOKEN))

	var result: Dictionary = parser.parse(raw)

	assert_true(result.get("ok", false), "Matching auth_token must pass the gate")
	var request: Dictionary = result.get("request", {})
	assert_eq(String(request.get("method", "")), "ping", "Parsed request must still carry the method name")
	# The parser returns the token separately so the dispatcher can
	# forward it; it also removes the field from the request envelope
	# so downstream JSON-RPC schema validation does not see it.
	assert_false(request.has("auth_token"), "auth_token must be stripped from the parsed request")
	assert_eq(String(result.get("auth_token", "")), EXPECTED_TOKEN, "Parser must surface the token under a top-level auth_token key")


func test_auth_disabled_accepts_request_without_token() -> void:
	# Default parser has an empty expected token. In that mode, missing
	# tokens in the packet must not be treated as UNAUTHORIZED — this
	# mirrors the dispatcher's dev-mode behaviour.
	var parser: Object = _new_parser()
	var raw: PackedByteArray = _encode(_build_ping_request())

	var result: Dictionary = parser.parse(raw)

	assert_true(result.get("ok", false), "When auth is disabled, a packet without an auth_token must be accepted")


func test_invalid_json_payload_is_rejected_with_parse_error() -> void:
	var parser: Object = _new_parser()
	var raw: PackedByteArray = "{not valid json".to_utf8_buffer()

	var result: Dictionary = parser.parse(raw)

	assert_false(result.get("ok", true), "Malformed JSON must be rejected")
	var error: Dictionary = result.get("error", {})
	# Use the JSON-RPC 2.0 pre-defined parse-error code.
	assert_eq(int(error.get("code", 0)), -32700, "Malformed JSON must map to -32700 parse error")


# ===========================================================================
# 3) Metrics
# ===========================================================================

func test_metrics_start_at_zero() -> void:
	var parser: Object = _new_parser()
	var metrics: Dictionary = parser.get_metrics()
	assert_eq(int(metrics.get(METRIC_RECEIVED, -1)), 0, "Received counter must start at 0")
	assert_eq(int(metrics.get(METRIC_REJECTED, -1)), 0, "Rejected counter must start at 0")


func test_received_counter_increments_on_every_packet() -> void:
	var parser: Object = _new_parser()
	var raw: PackedByteArray = _encode(_build_ping_request())

	var _r1: Dictionary = parser.parse(raw)
	var _r2: Dictionary = parser.parse(raw)
	var _r3: Dictionary = parser.parse(raw)

	var metrics: Dictionary = parser.get_metrics()
	assert_eq(int(metrics.get(METRIC_RECEIVED, -1)), 3, "Received counter must increment once per datagram")
	assert_eq(int(metrics.get(METRIC_REJECTED, -1)), 0, "Rejected counter must stay at 0 for accepted packets")


func test_rejected_counter_increments_on_size_rejection() -> void:
	var parser: Object = _new_parser()
	var oversized: PackedByteArray = _make_oversized_buffer(UDP_LIMIT_BYTES + 1)

	var _r: Dictionary = parser.parse(oversized)

	var metrics: Dictionary = parser.get_metrics()
	assert_eq(int(metrics.get(METRIC_RECEIVED, -1)), 1, "Received counter must include datagrams that end up rejected")
	assert_eq(int(metrics.get(METRIC_REJECTED, -1)), 1, "Rejected counter must increment for oversized packets")


func test_rejected_counter_increments_on_auth_rejection() -> void:
	var parser: Object = _new_parser()
	parser.set_auth_token(EXPECTED_TOKEN)
	var raw: PackedByteArray = _encode(_build_ping_request(WRONG_TOKEN))

	var _r: Dictionary = parser.parse(raw)

	var metrics: Dictionary = parser.get_metrics()
	assert_eq(int(metrics.get(METRIC_RECEIVED, -1)), 1, "Received counter must count UNAUTHORIZED packets")
	assert_eq(int(metrics.get(METRIC_REJECTED, -1)), 1, "Rejected counter must increment for UNAUTHORIZED packets")


func test_rejected_counter_increments_on_parse_error() -> void:
	var parser: Object = _new_parser()
	var raw: PackedByteArray = "not json".to_utf8_buffer()

	var _r: Dictionary = parser.parse(raw)

	var metrics: Dictionary = parser.get_metrics()
	assert_eq(int(metrics.get(METRIC_REJECTED, -1)), 1, "Rejected counter must increment for unparseable packets")


func test_reset_metrics_zeroes_both_counters() -> void:
	var parser: Object = _new_parser()
	var raw: PackedByteArray = _encode(_build_ping_request())
	var _r1: Dictionary = parser.parse(raw)
	var oversized: PackedByteArray = _make_oversized_buffer(UDP_LIMIT_BYTES + 1)
	var _r2: Dictionary = parser.parse(oversized)

	parser.reset_metrics()

	var metrics: Dictionary = parser.get_metrics()
	assert_eq(int(metrics.get(METRIC_RECEIVED, -1)), 0, "reset_metrics() must zero the received counter")
	assert_eq(int(metrics.get(METRIC_REJECTED, -1)), 0, "reset_metrics() must zero the rejected counter")
