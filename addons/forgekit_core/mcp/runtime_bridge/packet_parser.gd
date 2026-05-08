extends RefCounted
## McpRuntimePacketParser — first line of defence on the MCP runtime
## bridge's UDP listener. Every datagram received by McpUdpServer is
## handed to `parse(raw)` before any JSON-RPC dispatch happens.
##
## The parser enforces three pre-dispatch invariants, in this order:
##
##   1. Size gate (Requirement 8.6). Datagrams larger than
##      `max_packet_bytes` (default 65507 — the IPv4 UDP payload limit)
##      are rejected with a -32005 PACKET_TOO_LARGE error envelope
##      carrying `data.size` (the actual datagram length) and
##      `data.limit` (the configured maximum). The size check runs
##      before UTF-8 or JSON decoding so a malicious oversized buffer
##      cannot exhaust the parser.
##
##   2. JSON parse. The datagram is decoded as UTF-8 and parsed as a
##      JSON object. Unparseable payloads map to -32700 Parse error
##      and are counted as rejected.
##
##   3. Auth gate (Requirement 18.4, 18.5). When `expected_auth_token`
##      is non-empty, the parser verifies that the incoming request
##      carries a top-level `auth_token` field equal to the configured
##      value. Mismatches map to -32000 UNAUTHORIZED; the `auth_token`
##      field is stripped from the parsed request (returned under the
##      top-level `auth_token` key of the result) so downstream
##      JSON-RPC schema validation does not reject it.
##
## Observability (Requirement 30.5). The parser exposes two counters
## matching the canonical metric names:
##
##   - `mcp.runtime_bridge.udp_packets.received` — incremented for
##     every datagram that enters `parse()`, including those the
##     parser goes on to reject.
##   - `mcp.runtime_bridge.udp_packets.rejected` — incremented for
##     every datagram the parser refuses (size, parse, or auth).
##
## Both counters are readable through `get_metrics()` and zeroable
## through `reset_metrics()`. The runtime bridge aggregates these
## into the health endpoint's `/metrics` surface.
##
## The returned dictionary shape is deliberately transport-free:
##
##   ok:
##     { "ok": true,
##       "request": Dictionary,       # parsed JSON-RPC envelope
##       "auth_token": String }        # echo of the caller's token
##   rejected:
##     { "ok": false,
##       "error": Dictionary }         # well-formed JSON-RPC error


class_name McpRuntimePacketParser


const McpErrorCodes: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/mcp_error_codes.gd")

# IPv4 UDP theoretical payload maximum. 65535 (datagram) − 8 (UDP
# header) − 20 (IPv4 header) = 65507. Kept here as a named constant so
# downstream callers and tests can reference the same source of truth.
const DEFAULT_MAX_PACKET_BYTES: int = 65507

# JSON-RPC 2.0 pre-defined parse-error code. Mirrored from the editor
# dispatcher; not duplicated through McpErrorCodes because the JSON
# envelope for malformed packets never reaches the business-error
# catalogue.
const PARSE_ERROR_CODE: int = -32700
const PARSE_ERROR_MESSAGE: String = "Parse error"

# Canonical metric keys surfaced to the health endpoint.
const METRIC_RECEIVED: String = "mcp.runtime_bridge.udp_packets.received"
const METRIC_REJECTED: String = "mcp.runtime_bridge.udp_packets.rejected"

# Field name the UDP protocol uses to carry the shared secret inside
# the JSON payload. Matches design §8.2: WebSocket clients use the
# `Authorization: Bearer` header, UDP clients embed the token in the
# payload because datagrams have no header layer.
const AUTH_FIELD: String = "auth_token"


# Maximum acceptable datagram size in bytes. Defaults to the IPv4 UDP
# limit; tests and integration setups may tighten it via
# `set_max_packet_bytes()`.
var _max_packet_bytes: int = DEFAULT_MAX_PACKET_BYTES

# Expected shared secret. Empty string means auth is disabled (fresh
# template / dev mode) and the parser accepts packets regardless of
# their auth_token field. Populated from `runtime_config.tres` by the
# runtime bridge at startup.
var _expected_auth_token: String = ""

# Monotonic counters feeding the metric surface. Reset via
# `reset_metrics()`.
var _received_count: int = 0
var _rejected_count: int = 0


## Configure the maximum datagram size in bytes. Must be strictly
## positive; calls with zero or negative values are ignored so the
## parser never silently accepts packets of any size.
func set_max_packet_bytes(limit: int) -> void:
	if limit <= 0:
		push_warning("McpRuntimePacketParser: ignoring non-positive max_packet_bytes=%d" % limit)
		return
	_max_packet_bytes = limit


## Configure the expected shared secret. Pass an empty string to
## disable the auth gate entirely (dev / fresh template mode).
func set_auth_token(token: String) -> void:
	_expected_auth_token = token


## Read the metric counters. Returns a fresh dictionary keyed by the
## canonical metric names so callers cannot mutate the parser's
## internal state.
func get_metrics() -> Dictionary:
	return {
		METRIC_RECEIVED: _received_count,
		METRIC_REJECTED: _rejected_count,
	}


## Zero the metric counters. Primarily used by tests and by the
## runtime bridge when rolling over a reporting window.
func reset_metrics() -> void:
	_received_count = 0
	_rejected_count = 0


## Parse and validate a single UDP datagram.
##
## Every call increments the `received` counter — including calls
## that end in rejection — so the metric reflects inbound traffic
## volume, not just successful dispatches.
func parse(raw: PackedByteArray) -> Dictionary:
	_received_count += 1

	# ---- 1. Size gate ---------------------------------------------------
	var size_bytes: int = raw.size()
	if size_bytes > _max_packet_bytes:
		_rejected_count += 1
		return _rejected(_packet_too_large_error(size_bytes))

	# ---- 2. JSON parse --------------------------------------------------
	# get_string_from_utf8() is tolerant of invalid UTF-8 (returns the
	# empty string) but the JSON parser below will then report a parse
	# error on the empty input, funnelling both cases into the same
	# -32700 branch.
	var text: String = raw.get_string_from_utf8()
	var parser: JSON = JSON.new()
	var parse_err: int = parser.parse(text)
	if parse_err != OK or not (parser.data is Dictionary):
		_rejected_count += 1
		return _rejected(_parse_error())

	var request: Dictionary = parser.data as Dictionary

	# ---- 3. Auth gate ---------------------------------------------------
	var provided_token: String = ""
	if request.has(AUTH_FIELD) and request.get(AUTH_FIELD) is String:
		provided_token = String(request.get(AUTH_FIELD))

	if not _expected_auth_token.is_empty() and provided_token != _expected_auth_token:
		_rejected_count += 1
		return _rejected(McpErrorCodes.make_error(McpErrorCodes.UNAUTHORIZED))

	# Strip the auth_token from the request envelope so downstream
	# JSON-RPC schema validation does not see a field outside the
	# spec. The token is returned separately so the dispatcher can
	# forward it (for transports that require per-request auth).
	if request.has(AUTH_FIELD):
		request.erase(AUTH_FIELD)

	return {
		"ok": true,
		"request": request,
		"auth_token": provided_token,
	}


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------

## Build the PACKET_TOO_LARGE envelope with the per-datagram `size`
## and the configured `limit`. Uses the shared error catalogue so the
## `message` and `data.suggestion` strings stay in sync with the rest
## of the MCP surface.
func _packet_too_large_error(size_bytes: int) -> Dictionary:
	return McpErrorCodes.make_error(McpErrorCodes.PACKET_TOO_LARGE, {
		"size": size_bytes,
		"limit": _max_packet_bytes,
	})


## Build the -32700 Parse error envelope. The JSON-RPC pre-defined
## parse error does not live in McpErrorCodes (those codes start at
## -32000), so we construct it inline and keep the shape identical
## to the catalogue so callers can treat every error uniformly.
static func _parse_error() -> Dictionary:
	return {
		"code": PARSE_ERROR_CODE,
		"message": PARSE_ERROR_MESSAGE,
		"data": {
			"suggestion": "Ensure the UDP payload is a UTF-8 JSON-RPC 2.0 object.",
		},
	}


static func _rejected(error: Dictionary) -> Dictionary:
	return {
		"ok": false,
		"error": error,
	}
