extends GutTest
## Unit tests for the MCP JSON-RPC error-code catalog. Domain-level error
## codes (UNAUTHORIZED, FILE_NOT_FOUND, CORE_BOUNDARY_VIOLATION, ...) are
## emitted by editor plugin, runtime bridge, and CLI handlers and must survive
## JSON serialisation across the WebSocket / UDP boundary.


const MCP_ERRORS: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/mcp_error_codes.gd")


# ---------------------------------------------------------------------------
# 1) Error-code integer constants
# ---------------------------------------------------------------------------

func test_unauthorized_constant_equals_minus_32000() -> void:
	assert_eq(MCP_ERRORS.UNAUTHORIZED, -32000, "UNAUTHORIZED must equal -32000")


func test_file_not_found_constant_equals_minus_32001() -> void:
	assert_eq(MCP_ERRORS.FILE_NOT_FOUND, -32001, "FILE_NOT_FOUND must equal -32001")


func test_core_boundary_violation_constant_equals_minus_32002() -> void:
	assert_eq(MCP_ERRORS.CORE_BOUNDARY_VIOLATION, -32002, "CORE_BOUNDARY_VIOLATION must equal -32002")


func test_gdscript_syntax_error_constant_equals_minus_32003() -> void:
	assert_eq(MCP_ERRORS.GDSCRIPT_SYNTAX_ERROR, -32003, "GDSCRIPT_SYNTAX_ERROR must equal -32003")


func test_packet_too_large_constant_equals_minus_32005() -> void:
	assert_eq(MCP_ERRORS.PACKET_TOO_LARGE, -32005, "PACKET_TOO_LARGE must equal -32005")


func test_manifest_tag_not_found_constant_equals_minus_32011() -> void:
	assert_eq(MCP_ERRORS.MANIFEST_TAG_NOT_FOUND, -32011, "MANIFEST_TAG_NOT_FOUND must equal -32011")


func test_context_file_stale_constant_equals_minus_32012() -> void:
	assert_eq(MCP_ERRORS.CONTEXT_FILE_STALE, -32012, "CONTEXT_FILE_STALE must equal -32012")


func test_conventional_commits_format_violation_constant_equals_minus_32013() -> void:
	assert_eq(MCP_ERRORS.CONVENTIONAL_COMMITS_FORMAT_VIOLATION, -32013,
		"CONVENTIONAL_COMMITS_FORMAT_VIOLATION must equal -32013")


func test_pr_template_incomplete_constant_equals_minus_32014() -> void:
	assert_eq(MCP_ERRORS.PR_TEMPLATE_INCOMPLETE, -32014, "PR_TEMPLATE_INCOMPLETE must equal -32014")


# ---------------------------------------------------------------------------
# 2) Message constants (stable machine-readable names, stringified)
# ---------------------------------------------------------------------------

func test_message_constants_match_code_names() -> void:
	assert_eq(MCP_ERRORS.UNAUTHORIZED_MESSAGE, "UNAUTHORIZED")
	assert_eq(MCP_ERRORS.FILE_NOT_FOUND_MESSAGE, "FILE_NOT_FOUND")
	assert_eq(MCP_ERRORS.CORE_BOUNDARY_VIOLATION_MESSAGE, "CORE_BOUNDARY_VIOLATION")
	assert_eq(MCP_ERRORS.GDSCRIPT_SYNTAX_ERROR_MESSAGE, "GDSCRIPT_SYNTAX_ERROR")
	assert_eq(MCP_ERRORS.PACKET_TOO_LARGE_MESSAGE, "PACKET_TOO_LARGE")
	assert_eq(MCP_ERRORS.MANIFEST_TAG_NOT_FOUND_MESSAGE, "MANIFEST_TAG_NOT_FOUND")
	assert_eq(MCP_ERRORS.CONTEXT_FILE_STALE_MESSAGE, "CONTEXT_FILE_STALE")
	assert_eq(MCP_ERRORS.CONVENTIONAL_COMMITS_FORMAT_VIOLATION_MESSAGE, "CONVENTIONAL_COMMITS_FORMAT_VIOLATION")
	assert_eq(MCP_ERRORS.PR_TEMPLATE_INCOMPLETE_MESSAGE, "PR_TEMPLATE_INCOMPLETE")


# ---------------------------------------------------------------------------
# 3) make_error() produces a well-formed envelope for every listed code
# ---------------------------------------------------------------------------

func _all_codes() -> Array:
	return [
		MCP_ERRORS.UNAUTHORIZED,
		MCP_ERRORS.FILE_NOT_FOUND,
		MCP_ERRORS.CORE_BOUNDARY_VIOLATION,
		MCP_ERRORS.GDSCRIPT_SYNTAX_ERROR,
		MCP_ERRORS.PACKET_TOO_LARGE,
		MCP_ERRORS.MANIFEST_TAG_NOT_FOUND,
		MCP_ERRORS.CONTEXT_FILE_STALE,
		MCP_ERRORS.CONVENTIONAL_COMMITS_FORMAT_VIOLATION,
		MCP_ERRORS.PR_TEMPLATE_INCOMPLETE,
	]


func test_make_error_returns_envelope_with_code_message_and_non_empty_suggestion() -> void:
	for code in _all_codes():
		var envelope: Dictionary = MCP_ERRORS.make_error(code)
		assert_eq(envelope.get("code", 0), code,
			"make_error(%d) must return an envelope whose 'code' matches the argument" % code)

		var message: String = String(envelope.get("message", ""))
		assert_false(message.is_empty(),
			"make_error(%d) must return a non-empty 'message' field" % code)

		assert_true(envelope.has("data"),
			"make_error(%d) must always include a 'data' dict" % code)
		var data: Dictionary = envelope.get("data", {})
		var suggestion: String = String(data.get("suggestion", ""))
		assert_false(suggestion.is_empty(),
			"make_error(%d) must include a non-empty data.suggestion" % code)


# ---------------------------------------------------------------------------
# 4) Caller-supplied data is merged with the default suggestion.
# ---------------------------------------------------------------------------

func test_make_error_merges_caller_data_and_preserves_default_suggestion() -> void:
	var envelope: Dictionary = MCP_ERRORS.make_error(
		MCP_ERRORS.FILE_NOT_FOUND,
		{"path": "res://missing.tscn"}
	)
	var data: Dictionary = envelope.get("data", {})
	assert_eq(String(data.get("path", "")), "res://missing.tscn",
		"Caller data must be preserved in envelope.data")
	assert_false(String(data.get("suggestion", "")).is_empty(),
		"Default suggestion must be filled in when the caller does not provide one")


# ---------------------------------------------------------------------------
# 5) Caller can override the default suggestion.
# ---------------------------------------------------------------------------

func test_make_error_lets_caller_override_default_suggestion() -> void:
	var envelope: Dictionary = MCP_ERRORS.make_error(
		MCP_ERRORS.UNAUTHORIZED,
		{"suggestion": "Rotate the auth_token in plugin_config.tres."}
	)
	var data: Dictionary = envelope.get("data", {})
	assert_eq(String(data.get("suggestion", "")),
		"Rotate the auth_token in plugin_config.tres.",
		"Caller-supplied suggestion must override the default")


# ---------------------------------------------------------------------------
# 6) make_error() must not mutate the caller's data dictionary.
# ---------------------------------------------------------------------------

func test_make_error_does_not_mutate_caller_data() -> void:
	var caller_data: Dictionary = {"path": "res://foo.gd"}
	var _envelope: Dictionary = MCP_ERRORS.make_error(
		MCP_ERRORS.GDSCRIPT_SYNTAX_ERROR,
		caller_data
	)
	assert_false(caller_data.has("suggestion"),
		"make_error must not inject 'suggestion' into the caller's dictionary")
	assert_eq(caller_data.size(), 1,
		"make_error must leave the caller's dictionary unchanged")


# ---------------------------------------------------------------------------
# 7) Envelope round-trips losslessly through JSON.stringify / JSON.parse.
# ---------------------------------------------------------------------------

func test_make_error_envelope_round_trips_through_json() -> void:
	var envelope: Dictionary = MCP_ERRORS.make_error(
		MCP_ERRORS.CORE_BOUNDARY_VIOLATION,
		{"path": "addons/forgekit_core/boundary/core_boundary.gd"}
	)
	var encoded: String = JSON.stringify(envelope)
	var parser: JSON = JSON.new()
	var parse_err: int = parser.parse(encoded)
	assert_eq(parse_err, OK, "Envelope must encode to parseable JSON")

	var decoded: Dictionary = parser.data
	assert_eq(int(decoded.get("code", 0)), int(envelope.get("code", 0)),
		"JSON round-trip must preserve 'code'")
	assert_eq(String(decoded.get("message", "")), String(envelope.get("message", "")),
		"JSON round-trip must preserve 'message'")

	var decoded_data: Dictionary = decoded.get("data", {})
	var original_data: Dictionary = envelope.get("data", {})
	assert_eq(String(decoded_data.get("path", "")), String(original_data.get("path", "")),
		"JSON round-trip must preserve data.path")
	assert_eq(String(decoded_data.get("suggestion", "")), String(original_data.get("suggestion", "")),
		"JSON round-trip must preserve data.suggestion")
