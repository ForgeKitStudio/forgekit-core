extends GutTest
## Unit tests for McpRuntimeDiagnosticTools: JSON-RPC handler adapter that
## exposes the runtime-channel diagnostic MCP tools on top of a duck-typed
## RuntimeDiagnosticBackend.
##
## Covered handlers:
##   runtime.is_connected       → {connected, bridge_version}
##   runtime.handshake(client_id, auth_token)
##                              → {session_id, api_version, server, core_detected, server.latest_version}
##   runtime.heartbeat          → {pong, ts}
##   runtime.shutdown(graceful?) → {shutting_down}


const DIAGNOSTIC_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/runtime_bridge/tools/diagnostic_tools.gd")
const DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")


class FakeRuntimeDiagnosticBackend:
	extends RefCounted

	var calls: Array = []
	var overrides: Dictionary = {}

	func bridge_is_connected() -> Variant:
		calls.append({"op": "is_connected"})
		if overrides.has("is_connected"):
			return overrides["is_connected"]
		return {"connected": true, "bridge_version": "0.0.1"}

	func handshake(client_id: String, auth_token: String) -> Variant:
		calls.append({"op": "handshake", "client_id": client_id, "auth_token": auth_token})
		if overrides.has("handshake"):
			return overrides["handshake"]
		return {
			"session_id": "sess-abc",
			"api_version": "v0.0.1",
			"server": {"name": "forgekit-core", "version": "0.0.1"},
			"core_detected": true,
			"server.latest_version": "0.0.1",
		}

	func heartbeat() -> Variant:
		calls.append({"op": "heartbeat"})
		if overrides.has("heartbeat"):
			return overrides["heartbeat"]
		return {"pong": true, "ts": "2025-01-01T00:00:00"}

	func shutdown(graceful: bool) -> Variant:
		calls.append({"op": "shutdown", "graceful": graceful})
		if overrides.has("shutdown"):
			return overrides["shutdown"]
		return {"shutting_down": true}

	func find_calls(op: String) -> Array:
		var out: Array = []
		for c in calls:
			if (c as Dictionary).get("op", "") == op:
				out.append(c)
		return out


func _new_env() -> Dictionary:
	var backend: FakeRuntimeDiagnosticBackend = FakeRuntimeDiagnosticBackend.new()
	var tools: Object = DIAGNOSTIC_TOOLS_SCRIPT.new(backend)
	return {"backend": backend, "tools": tools}


# ---------------------------------------------------------------------------
# 1) runtime.is_connected — calls backend and returns status
# ---------------------------------------------------------------------------

func test_is_connected_calls_backend_and_returns_status() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeDiagnosticBackend = env["backend"]

	var result: Variant = tools.bridge_is_connected({})

	assert_eq(backend.find_calls("is_connected").size(), 1, "Backend.bridge_is_connected called once")
	assert_true(result is Dictionary, "Result must be a Dictionary")
	var dict: Dictionary = result as Dictionary
	assert_true(dict.get("connected", false), "Result must contain 'connected: true'")
	assert_true(dict.has("bridge_version"), "Result must contain 'bridge_version'")


# ---------------------------------------------------------------------------
# 2) runtime.handshake — forwards client_id, auth_token to backend
# ---------------------------------------------------------------------------

func test_handshake_forwards_client_id_and_auth_token() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeDiagnosticBackend = env["backend"]

	var _result: Variant = tools.handshake({
		"client_id": "kiro-agent",
		"auth_token": "secret-123",
	})

	var call: Dictionary = backend.find_calls("handshake")[0]
	assert_eq(call.get("client_id", ""), "kiro-agent", "client_id forwarded")
	assert_eq(call.get("auth_token", ""), "secret-123", "auth_token forwarded")


func test_handshake_accepts_positional_params() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeDiagnosticBackend = env["backend"]

	var _result: Variant = tools.handshake(["client-2", "token-xyz"])

	var call: Dictionary = backend.find_calls("handshake")[0]
	assert_eq(call.get("client_id", ""), "client-2", "positional client_id forwarded")
	assert_eq(call.get("auth_token", ""), "token-xyz", "positional auth_token forwarded")


func test_handshake_returns_required_envelope_fields() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]

	var result: Variant = tools.handshake({
		"client_id": "kiro-agent",
		"auth_token": "secret-123",
	})

	var dict: Dictionary = result as Dictionary
	assert_true(dict.has("session_id"), "handshake result must include 'session_id'")
	assert_true(dict.has("api_version"), "handshake result must include 'api_version'")
	assert_true(dict.has("server"), "handshake result must include 'server'")
	assert_true(dict.has("core_detected"), "handshake result must include 'core_detected'")
	assert_true(dict.has("server.latest_version"), "handshake result must include 'server.latest_version'")


func test_handshake_api_version_matches_git_tag_format() -> void:
	# api_version must follow the git tag format `vX.Y.Z` per Requirement 46.4
	# so the client can verify it against the forgekit-core repo tags.
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]

	var result: Variant = tools.handshake({
		"client_id": "kiro-agent",
		"auth_token": "secret-123",
	})

	var dict: Dictionary = result as Dictionary
	var api_version: String = String(dict.get("api_version", ""))
	var regex: RegEx = RegEx.new()
	regex.compile("^v\\d+\\.\\d+\\.\\d+$")
	assert_not_null(
		regex.search(api_version),
		"handshake api_version must match 'vX.Y.Z' git-tag format; got '%s'" % api_version,
	)


# ---------------------------------------------------------------------------
# 3) runtime.heartbeat — calls backend and returns pong
# ---------------------------------------------------------------------------

func test_heartbeat_calls_backend_and_returns_pong() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeDiagnosticBackend = env["backend"]

	var result: Variant = tools.heartbeat({})

	assert_eq(backend.find_calls("heartbeat").size(), 1, "Backend.heartbeat called once")
	var dict: Dictionary = result as Dictionary
	assert_true(dict.get("pong", false), "heartbeat result must contain 'pong: true'")
	assert_true(dict.has("ts"), "heartbeat result must contain 'ts'")


# ---------------------------------------------------------------------------
# 4) runtime.shutdown — forwards graceful flag to backend
# ---------------------------------------------------------------------------

func test_shutdown_forwards_graceful_flag() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeDiagnosticBackend = env["backend"]

	var _result: Variant = tools.shutdown({"graceful": true})

	var call: Dictionary = backend.find_calls("shutdown")[0]
	assert_true(bool(call.get("graceful", false)), "graceful=true forwarded")


func test_shutdown_defaults_graceful_to_true_when_absent() -> void:
	# Requirement: `graceful?` is optional; the adapter defaults to true so
	# clients calling `runtime.shutdown` without arguments get the safe
	# behaviour (shut down after current frame completes).
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeDiagnosticBackend = env["backend"]

	var _result: Variant = tools.shutdown({})

	var call: Dictionary = backend.find_calls("shutdown")[0]
	assert_true(bool(call.get("graceful", false)), "graceful defaults to true when absent")


# ---------------------------------------------------------------------------
# 5) register_on — wires all four runtime diagnostic methods on dispatcher
# ---------------------------------------------------------------------------

func test_register_on_wires_all_four_diagnostic_methods_on_dispatcher() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var dispatcher: Object = DISPATCHER_SCRIPT.new()

	tools.register_on(dispatcher)

	var cases: Array = [
		{"method": "runtime.is_connected", "params": {}},
		{"method": "runtime.handshake", "params": {"client_id": "c", "auth_token": "t"}},
		{"method": "runtime.heartbeat", "params": {}},
		{"method": "runtime.shutdown", "params": {"graceful": true}},
	]
	for case in cases:
		var response: Dictionary = dispatcher.dispatch({
			"jsonrpc": "2.0",
			"method": case.get("method"),
			"params": case.get("params"),
			"id": 1,
		})
		assert_true(response.has("result"), "%s must be reachable via dispatcher" % case.get("method"))
		assert_false(response.has("error"), "%s must not produce a dispatcher error" % case.get("method"))
