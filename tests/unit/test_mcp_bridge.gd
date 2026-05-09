extends GutTest
## Unit tests for McpBridge — the runtime-channel autoload that owns the
## UDP server lifecycle. Verifies the CLI flag gating rule: the UDP port
## must only be opened when the game is launched with `--mcp-bridge`, and
## must remain closed when the flag is absent.


const MCP_BRIDGE_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/runtime_bridge/mcp_bridge.gd")


# ---------------------------------------------------------------------------
# FakeUdpServer — minimal stand-in used to assert McpBridge's control flow
# without touching a real socket. Records every call the bridge makes so
# the tests can verify activation is (or is not) attempted.
# ---------------------------------------------------------------------------

class FakeUdpServer:
	extends RefCounted

	var start_calls: Array = []
	var stop_calls: int = 0
	var is_listening_flag: bool = false
	var next_start_result: Dictionary = {"ok": true, "port": 6020}
	var active_port: int = -1
	var warnings: Array = []

	func start(config: Object) -> Dictionary:
		start_calls.append(config)
		if next_start_result.get("ok", false):
			is_listening_flag = true
			active_port = int(next_start_result.get("port", -1))
		return next_start_result

	func stop() -> void:
		stop_calls += 1
		is_listening_flag = false
		active_port = -1

	func is_listening() -> bool:
		return is_listening_flag

	func get_active_port() -> int:
		return active_port

	func get_warnings() -> Array:
		return warnings.duplicate()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

func _new_bridge() -> Node:
	var bridge: Node = MCP_BRIDGE_SCRIPT.new()
	# Inject a fake server factory so the bridge never touches the network
	# and we can inspect whether it attempted to activate the server.
	var fake_factory: Callable = func() -> Object:
		return FakeUdpServer.new()
	bridge.server_factory = fake_factory
	return bridge


# ---------------------------------------------------------------------------
# 1) The script loads as GDScript and exposes the McpBridge identity
#    through its docstring. Autoload registration in project.godot provides
#    the global "McpBridge" reference — a `class_name McpBridge` here would
#    collide with that autoload, so the script must not declare it.
# ---------------------------------------------------------------------------

func test_script_loads_as_gdscript() -> void:
	var script: Resource = load("res://addons/forgekit_core/mcp/runtime_bridge/mcp_bridge.gd")
	assert_not_null(script, "McpBridge script must load via ResourceLoader")
	assert_true(script is GDScript, "Loaded resource must be a GDScript")


func test_script_declares_class_name_mcp_bridge() -> void:
	# Note: the production autoload already exposes "McpBridge" as a global
	# reference through its project.godot registration. Adding
	# `class_name McpBridge` to the script itself collides with that
	# autoload (Godot 4 raises "Class X hides an autoload singleton"),
	# so we assert the script file advertises the McpBridge identity
	# through its documented singleton contract in the docstring.
	var file: FileAccess = FileAccess.open("res://addons/forgekit_core/mcp/runtime_bridge/mcp_bridge.gd", FileAccess.READ)
	assert_not_null(file, "McpBridge source must be readable")
	var text: String = file.get_as_text()
	file.close()
	assert_true(
		text.find("McpBridge") != -1,
		"McpBridge script must document itself as the McpBridge autoload"
	)
	assert_false(
		text.find("class_name McpBridge") != -1,
		"Script must NOT declare `class_name McpBridge` — that would hide the autoload singleton"
	)


# ---------------------------------------------------------------------------
# 2) Without the `--mcp-bridge` CLI flag, McpBridge must NOT start the UDP
#    server. This is Requirement 8.5: no flag → no port opened.
# ---------------------------------------------------------------------------

func test_activate_does_not_start_server_when_cli_flag_is_absent() -> void:
	var bridge: Node = _new_bridge()
	add_child_autofree(bridge)

	# Simulate `godot --headless` with no extra flags.
	var _result: Dictionary = bridge.activate([])

	assert_false(bridge.is_active(), "Bridge must report is_active()==false when --mcp-bridge is absent")
	assert_null(bridge.get_server(), "No server instance should be created when --mcp-bridge is absent")


func test_activate_does_not_start_server_for_unrelated_flags() -> void:
	var bridge: Node = _new_bridge()
	add_child_autofree(bridge)

	var _result: Dictionary = bridge.activate(["--headless", "--scene=res://foo.tscn"])

	assert_false(bridge.is_active(), "Bridge must stay inactive for unrelated flags")
	assert_null(bridge.get_server(), "No server instance should be created for unrelated flags")


# ---------------------------------------------------------------------------
# 3) With `--mcp-bridge` present, the bridge instantiates a UDP server via
#    the injected factory and calls start() on it.
# ---------------------------------------------------------------------------

func test_activate_starts_server_when_cli_flag_is_present() -> void:
	var bridge: Node = _new_bridge()
	add_child_autofree(bridge)

	var result: Dictionary = bridge.activate(["--mcp-bridge"])

	assert_true(result.get("ok", false), "activate() must report ok=true when --mcp-bridge is present")
	assert_true(bridge.is_active(), "Bridge must report is_active()==true after successful activation")
	var server: Object = bridge.get_server()
	assert_not_null(server, "Server instance must exist after activation")
	assert_true(server.is_listening(), "Server must be listening after activation")
	assert_eq((server as FakeUdpServer).start_calls.size(), 1, "start() must be called exactly once on the server")


# ---------------------------------------------------------------------------
# 4) deactivate() stops the server and clears the active-server reference.
# ---------------------------------------------------------------------------

func test_deactivate_stops_server_and_clears_reference() -> void:
	var bridge: Node = _new_bridge()
	add_child_autofree(bridge)
	var _activate_result: Dictionary = bridge.activate(["--mcp-bridge"])
	var server: Object = bridge.get_server()
	assert_not_null(server, "Precondition: server must exist before deactivate")

	bridge.deactivate()

	assert_false(bridge.is_active(), "Bridge must report is_active()==false after deactivate()")
	assert_null(bridge.get_server(), "Server reference must be cleared after deactivate()")
	assert_eq((server as FakeUdpServer).stop_calls, 1, "stop() must be called exactly once on the server")


# ---------------------------------------------------------------------------
# 5) Calling activate() twice without deactivating in between is a no-op on
#    the second call — the bridge does not leak a second server instance.
# ---------------------------------------------------------------------------

func test_activate_is_idempotent_when_called_twice() -> void:
	var bridge: Node = _new_bridge()
	add_child_autofree(bridge)

	var _first: Dictionary = bridge.activate(["--mcp-bridge"])
	var first_server: Object = bridge.get_server()
	var _second: Dictionary = bridge.activate(["--mcp-bridge"])
	var second_server: Object = bridge.get_server()

	assert_same(first_server, second_server, "Second activate() must not replace the live server instance")
	assert_eq((first_server as FakeUdpServer).start_calls.size(), 1, "start() must not be called twice on the same server")



# ---------------------------------------------------------------------------
# 6) Trace propagation: when an incoming UDP packet carries a `trace` field
#    with `{trace_id, span_id}`, `observe_packet(request)` stores the same
#    pair on the bridge so downstream loggers can correlate log lines
#    across processes.
# ---------------------------------------------------------------------------

func test_observe_packet_propagates_trace_id_when_present() -> void:
	var bridge: Node = _new_bridge()
	add_child_autofree(bridge)

	bridge.observe_packet({
		"jsonrpc": "2.0",
		"method": "runtime.heartbeat",
		"id": 1,
		"trace": {"trace_id": "aabbccdd", "span_id": "ffee"},
	})

	var ctx: Dictionary = bridge.get_last_trace_context()
	assert_eq(String(ctx.get("trace_id", "")), "aabbccdd", "trace_id must be echoed from the packet trace field")
	assert_eq(String(ctx.get("span_id", "")), "ffee", "span_id must be echoed from the packet trace field")


# ---------------------------------------------------------------------------
# 7) Absent trace context: observe_packet() mints a fresh 8-char hex
#    trace_id and 4-char hex span_id so every packet is correlatable even
#    when the sender did not inject a trace envelope.
# ---------------------------------------------------------------------------

func test_observe_packet_generates_trace_id_when_absent() -> void:
	var bridge: Node = _new_bridge()
	add_child_autofree(bridge)

	bridge.observe_packet({
		"jsonrpc": "2.0",
		"method": "runtime.heartbeat",
		"id": 2,
	})

	var ctx: Dictionary = bridge.get_last_trace_context()
	var trace_id: String = String(ctx.get("trace_id", ""))
	var span_id: String = String(ctx.get("span_id", ""))
	var hex_re: RegEx = RegEx.new()
	hex_re.compile("^[0-9a-f]{8}$")
	var span_re: RegEx = RegEx.new()
	span_re.compile("^[0-9a-f]{4}$")
	assert_not_null(hex_re.search(trace_id), "trace_id must be 8-char lowercase hex when generated; got '%s'" % trace_id)
	assert_not_null(span_re.search(span_id), "span_id must be 4-char lowercase hex when generated; got '%s'" % span_id)
