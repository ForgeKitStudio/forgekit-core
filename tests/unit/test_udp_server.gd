extends GutTest
## Unit tests for McpUdpServer: port scanning across the runtime range
## (6020–6029), active-port file merge under the `runtime` key, the
## EXTERNAL_BIND_ENABLED warning for non-loopback binds, and the
## NO_AVAILABLE_PORT error shape when the whole range is occupied.


const UDP_SERVER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/runtime_bridge/udp_server.gd")

const DEFAULT_PORT_BASE: int = 6020
const DEFAULT_PORT_RANGE_SIZE: int = 10
const LOOPBACK: String = "127.0.0.1"
const ACTIVE_PORT_FILE: String = "user://mcp_active_port.json"


# ---------------------------------------------------------------------------
# FakeConfig — a minimal script-backed Resource duck-typed as
# runtime_config. Lets each test drive the scanner with a specific
# bind_address / port range without touching runtime_config.tres.
# ---------------------------------------------------------------------------

class FakeConfig:
	extends Resource

	@export var port_base: int = DEFAULT_PORT_BASE
	@export var port_range_size: int = DEFAULT_PORT_RANGE_SIZE
	@export var bind_address: String = LOOPBACK
	@export var auth_token: String = ""
	@export var max_packet_bytes: int = 65507


var _blockers: Array = []
var _server: Object = null
# Holds any RenameRecorder created by tests so it outlives the test function
# and is still alive during after_each's stop() → _clear_active_port() call.
var _rename_recorder: Object = null


func before_each() -> void:
	_blockers = []
	_server = null
	_rename_recorder = null
	_remove_active_port_file()


func after_each() -> void:
	if _server != null and _server.has_method("stop"):
		_server.stop()
	_server = null
	_rename_recorder = null
	for blocker in _blockers:
		(blocker as PacketPeerUDP).close()
	_blockers.clear()
	_remove_active_port_file()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

func _occupy_ports(ports: Array) -> void:
	for p in ports:
		var peer: PacketPeerUDP = PacketPeerUDP.new()
		var err: int = peer.bind(int(p), LOOPBACK)
		assert_eq(err, OK, "Failed to pre-occupy UDP port %d in test setup" % int(p))
		_blockers.append(peer)


func _remove_active_port_file() -> void:
	if FileAccess.file_exists(ACTIVE_PORT_FILE):
		DirAccess.remove_absolute(ACTIVE_PORT_FILE)


func _read_active_port_file() -> Dictionary:
	if not FileAccess.file_exists(ACTIVE_PORT_FILE):
		return {}
	var file: FileAccess = FileAccess.open(ACTIVE_PORT_FILE, FileAccess.READ)
	var text: String = file.get_as_text()
	file.close()
	var parsed: Variant = JSON.parse_string(text)
	return parsed as Dictionary if parsed is Dictionary else {}


func _write_active_port_file(data: Dictionary) -> void:
	var file: FileAccess = FileAccess.open(ACTIVE_PORT_FILE, FileAccess.WRITE)
	file.store_string(JSON.stringify(data))
	file.close()


func _new_server() -> Object:
	return UDP_SERVER_SCRIPT.new()


# ---------------------------------------------------------------------------
# 1) Null config + all defaults: scanner picks the first port in the range
#    and reports ok=true with that port.
# ---------------------------------------------------------------------------

func test_start_with_null_config_uses_defaults_and_binds_port_base() -> void:
	_server = _new_server()

	var result: Dictionary = _server.start(null)

	assert_true(result.get("ok", false), "start() with null config must succeed on the default port")
	assert_eq(int(result.get("port", -1)), DEFAULT_PORT_BASE, "start() must bind to the default runtime port base when nothing is occupied")
	assert_true(_server.is_listening(), "Server must report is_listening()==true after a successful start")


# ---------------------------------------------------------------------------
# 2) When lower ports in the range are occupied, the scanner picks the first
#    free port above them.
# ---------------------------------------------------------------------------

func test_start_selects_first_free_port_when_lower_ports_are_occupied() -> void:
	_occupy_ports([6020, 6021, 6022])
	_server = _new_server()

	var result: Dictionary = _server.start(FakeConfig.new())

	assert_true(result.get("ok", false), "start() must succeed when at least one port in the range is free")
	assert_eq(int(result.get("port", -1)), 6023, "Scanner must skip occupied ports and pick the first free one")
	assert_eq(_server.get_active_port(), 6023, "get_active_port() must echo the port chosen by the scanner")


# ---------------------------------------------------------------------------
# 3) The selected port is written to user://mcp_active_port.json under the
#    `runtime` key.
# ---------------------------------------------------------------------------

func test_start_writes_selected_port_to_active_port_file_under_runtime_key() -> void:
	_occupy_ports([6020])
	_server = _new_server()

	var result: Dictionary = _server.start(FakeConfig.new())
	assert_true(result.get("ok", false), "start() must succeed in this scenario")

	var data: Dictionary = _read_active_port_file()
	assert_eq(int(data.get("runtime", -1)), 6021, "Active port file must record the chosen runtime port under the 'runtime' key")


# ---------------------------------------------------------------------------
# 4) start() merges the `runtime` entry with any pre-existing keys in the
#    active-port file so parallel components (editor, visualizer, health)
#    keep their entries.
# ---------------------------------------------------------------------------

func test_start_merges_runtime_key_into_existing_active_port_file() -> void:
	_write_active_port_file({
		"editor": 6010,
		"visualizer": 6030,
		"health": 6040,
	})
	_server = _new_server()

	var result: Dictionary = _server.start(FakeConfig.new())
	assert_true(result.get("ok", false), "start() must succeed in this scenario")

	var data: Dictionary = _read_active_port_file()
	assert_eq(int(data.get("runtime", -1)), DEFAULT_PORT_BASE, "Runtime port must be inserted into the active-port file")
	assert_eq(int(data.get("editor", -1)), 6010, "Pre-existing editor key must be preserved")
	assert_eq(int(data.get("visualizer", -1)), 6030, "Pre-existing visualizer key must be preserved")
	assert_eq(int(data.get("health", -1)), 6040, "Pre-existing health key must be preserved")


# ---------------------------------------------------------------------------
# 5) When the whole range is occupied, start() returns an error containing
#    the full list of ports that were probed.
# ---------------------------------------------------------------------------

func test_start_returns_no_available_port_error_when_range_is_exhausted() -> void:
	var full_range: Array = []
	for i in range(DEFAULT_PORT_RANGE_SIZE):
		full_range.append(DEFAULT_PORT_BASE + i)
	_occupy_ports(full_range)
	_server = _new_server()

	var result: Dictionary = _server.start(FakeConfig.new())

	assert_false(result.get("ok", true), "start() must fail when every port in the range is occupied")
	assert_false(_server.is_listening(), "Server must not be listening after a failed start")
	var error: Dictionary = result.get("error", {})
	assert_eq(error.get("code", ""), "NO_AVAILABLE_PORT", "Error code must be the literal 'NO_AVAILABLE_PORT'")
	var checked_ports: Array = error.get("checked_ports", [])
	assert_eq(checked_ports.size(), DEFAULT_PORT_RANGE_SIZE, "checked_ports must list every port that was probed")
	for i in range(DEFAULT_PORT_RANGE_SIZE):
		assert_eq(int(checked_ports[i]), DEFAULT_PORT_BASE + i, "checked_ports[%d] must match the probed port" % i)


# ---------------------------------------------------------------------------
# 6) Non-loopback bind_address triggers the EXTERNAL_BIND_ENABLED warning.
# ---------------------------------------------------------------------------

func test_start_emits_external_bind_enabled_warning_for_non_loopback_bind() -> void:
	var cfg: FakeConfig = FakeConfig.new()
	cfg.bind_address = "0.0.0.0"
	_server = _new_server()

	var _result: Dictionary = _server.start(cfg)

	var warnings: Array = _server.get_warnings()
	var found: bool = false
	for w in warnings:
		var wd: Dictionary = w
		if wd.get("code", "") == "EXTERNAL_BIND_ENABLED" and wd.get("bind_address", "") == "0.0.0.0":
			found = true
			break
	assert_true(found, "A warning with code EXTERNAL_BIND_ENABLED and the bind_address must be recorded for non-loopback binds")


# ---------------------------------------------------------------------------
# 7) Loopback bind_address must NOT emit EXTERNAL_BIND_ENABLED.
# ---------------------------------------------------------------------------

func test_start_does_not_emit_external_bind_warning_for_loopback() -> void:
	_server = _new_server()

	var result: Dictionary = _server.start(FakeConfig.new())

	# Start must succeed on the loopback default — otherwise the absence of
	# the warning would be meaningless (an aborted start cannot emit one).
	assert_true(result.get("ok", false), "start() must succeed on the default loopback config")

	var warnings: Array = _server.get_warnings()
	var has_external_bind_warning: bool = false
	for w in warnings:
		var wd: Dictionary = w
		if wd.get("code", "") == "EXTERNAL_BIND_ENABLED":
			has_external_bind_warning = true
			break
	assert_false(has_external_bind_warning, "Loopback bind must not raise EXTERNAL_BIND_ENABLED")
	assert_eq(warnings.size(), 0, "A successful loopback start must emit no warnings at all")


# ---------------------------------------------------------------------------
# 8) stop() releases the bound port so it can be re-bound immediately, and
#    removes the `runtime` key from the active-port file while preserving
#    sibling keys.
# ---------------------------------------------------------------------------

func test_stop_releases_port_and_clears_runtime_key_in_active_port_file() -> void:
	_write_active_port_file({"editor": 6010})
	_server = _new_server()
	var start_result: Dictionary = _server.start(FakeConfig.new())
	assert_true(start_result.get("ok", false), "start() must succeed in this scenario")
	var chosen_port: int = int(start_result.get("port", 0))

	_server.stop()

	assert_false(_server.is_listening(), "is_listening() must return false after stop()")

	# Port is released: a fresh PacketPeerUDP can bind on the same port.
	var probe: PacketPeerUDP = PacketPeerUDP.new()
	var err: int = probe.bind(chosen_port, LOOPBACK)
	assert_eq(err, OK, "stop() must release the bound port so it is bindable again")
	probe.close()

	var data: Dictionary = _read_active_port_file()
	assert_false(data.has("runtime"), "stop() must remove the 'runtime' key from the active-port file")
	assert_eq(int(data.get("editor", -1)), 6010, "stop() must preserve sibling keys in the active-port file")


# ---------------------------------------------------------------------------
# 9) Non-contiguous occupied ports: when the occupied set has gaps, the
#    scanner must pick the first free port, not skip past gaps or reuse an
#    occupied one. Occupying 6020, 6023, 6026 leaves 6021 as the first free.
# ---------------------------------------------------------------------------

func test_start_picks_first_gap_when_occupied_ports_are_non_contiguous() -> void:
	_occupy_ports([6020, 6023, 6026])
	_server = _new_server()

	var result: Dictionary = _server.start(FakeConfig.new())

	assert_true(result.get("ok", false), "start() must succeed when a gap exists below occupied ports")
	assert_eq(int(result.get("port", -1)), 6021, "Scanner must pick the first free port in a non-contiguous layout")
	assert_eq(_server.get_active_port(), 6021, "get_active_port() must echo the gap port that was selected")


# ---------------------------------------------------------------------------
# 10) Only the last port in the range is free: occupy 6020–6028 and verify
#     the scanner still finds 6029 (guards against an off-by-one that would
#     cut the last index from the scan).
# ---------------------------------------------------------------------------

func test_start_picks_last_port_when_only_top_of_range_is_free() -> void:
	var lower_nine: Array = []
	for i in range(DEFAULT_PORT_RANGE_SIZE - 1):
		lower_nine.append(DEFAULT_PORT_BASE + i)
	_occupy_ports(lower_nine)
	_server = _new_server()

	var result: Dictionary = _server.start(FakeConfig.new())

	assert_true(result.get("ok", false), "start() must succeed when only the last port in the range is free")
	assert_eq(int(result.get("port", -1)), DEFAULT_PORT_BASE + DEFAULT_PORT_RANGE_SIZE - 1, "Scanner must reach the last port in the configured range")


# ---------------------------------------------------------------------------
# 11) Custom port_base and port_range_size from the config are honoured.
#     The scanner probes a completely different range than the default one
#     (7100–7102), proving the range is driven by config, not hard-coded.
# ---------------------------------------------------------------------------

func test_start_honours_custom_port_base_and_range_size_from_config() -> void:
	var cfg: FakeConfig = FakeConfig.new()
	cfg.port_base = 7100
	cfg.port_range_size = 3
	_server = _new_server()

	var result: Dictionary = _server.start(cfg)

	assert_true(result.get("ok", false), "start() must succeed on a free custom range")
	assert_eq(int(result.get("port", -1)), 7100, "Scanner must bind to the configured custom port_base when it is free")
	assert_eq(_server.get_active_port(), 7100, "get_active_port() must report the custom-range port")


# ---------------------------------------------------------------------------
# 12) Atomic write: start() must write the active-port file through a
#     temp-file + rename pattern, not an in-place truncate-and-write. A
#     power loss or crash between the write and the rename must leave the
#     original file byte-for-byte intact.
#
#     We assert this by injecting a renamer that records the (from, to)
#     pair and then fails. The target file must then still contain the
#     pre-existing content untouched.
# ---------------------------------------------------------------------------

class RenameRecorder:
	extends RefCounted

	var calls: Array = []
	var force_error: int = OK

	func rename(from_path: String, to_path: String) -> int:
		calls.append({"from": from_path, "to": to_path})
		if force_error != OK:
			return force_error
		return DirAccess.rename_absolute(from_path, to_path)


func test_start_writes_active_port_file_via_temp_file_and_rename() -> void:
	_write_active_port_file({"editor": 6010})
	_rename_recorder = RenameRecorder.new()
	var recorder: RenameRecorder = _rename_recorder as RenameRecorder
	_server = _new_server()
	_server.set_renamer(Callable(recorder, "rename"))

	var result: Dictionary = _server.start(FakeConfig.new())
	assert_true(result.get("ok", false), "start() must succeed in this scenario")

	assert_eq(recorder.calls.size(), 1, "Exactly one rename must be performed when writing the active-port file")
	var call: Dictionary = recorder.calls[0]
	assert_eq(String(call.get("to", "")), "user://mcp_active_port.json", "Rename target must be the active-port file")
	var from_path: String = String(call.get("from", ""))
	assert_true(from_path.ends_with(".tmp"), "Rename source must be a sibling .tmp file, got %s" % from_path)
	assert_true(from_path.begins_with("user://mcp_active_port.json"), "Temp path must live beside the target so the rename is atomic on the same filesystem")


func test_start_preserves_existing_active_port_file_when_rename_fails() -> void:
	var original: Dictionary = {"editor": 6010, "visualizer": 6030}
	_write_active_port_file(original)
	_rename_recorder = RenameRecorder.new()
	var recorder: RenameRecorder = _rename_recorder as RenameRecorder
	recorder.force_error = FAILED
	_server = _new_server()
	_server.set_renamer(Callable(recorder, "rename"))

	var _result: Dictionary = _server.start(FakeConfig.new())

	# After a rename failure the original file must be byte-for-byte intact:
	# the "editor" and "visualizer" keys must still be present and no
	# "runtime" key must have leaked through.
	var data: Dictionary = _read_active_port_file()
	assert_false(data.has("runtime"), "Runtime key must not appear when the rename fails")
	assert_eq(int(data.get("editor", -1)), 6010, "Existing editor key must be preserved when the rename fails")
	assert_eq(int(data.get("visualizer", -1)), 6030, "Existing visualizer key must be preserved when the rename fails")

	# The temp sidecar must also be cleaned up so it does not leak into the
	# user's filesystem after a failed atomic write.
	assert_false(FileAccess.file_exists("user://mcp_active_port.json.tmp"), "Temp sidecar must be removed after a failed rename")


# ---------------------------------------------------------------------------
# 13) Packet parser integration — the server exposes a
#     McpRuntimePacketParser preconfigured from the runtime config so
#     incoming UDP datagrams can be funneled through the parser before
#     dispatch (size gate, auth gate, metrics).
# ---------------------------------------------------------------------------

func test_start_exposes_packet_parser_configured_from_runtime_config() -> void:
	var cfg: FakeConfig = FakeConfig.new()
	cfg.auth_token = "0123456789abcdef0123456789abcdef"
	cfg.max_packet_bytes = 1024
	_server = _new_server()

	var result: Dictionary = _server.start(cfg)
	assert_true(result.get("ok", false), "start() must succeed in this scenario")

	var parser: Object = _server.get_packet_parser()
	assert_not_null(parser, "UDP server must expose a packet parser after start()")

	# The parser must reflect the config that was passed in: a datagram
	# above the configured limit is rejected, and an empty datagram
	# without an auth_token hits the UNAUTHORIZED branch (confirming
	# the auth_token was propagated to the parser).
	var oversized: PackedByteArray = PackedByteArray()
	oversized.resize(2048)
	var rejection: Dictionary = parser.parse(oversized)
	assert_false(rejection.get("ok", true), "Parser must apply the custom size limit from runtime config")
	assert_eq(int(rejection.get("error", {}).get("data", {}).get("limit", 0)), 1024,
		"Parser's size limit must match runtime config.max_packet_bytes")

	var unauth_payload: PackedByteArray = JSON.stringify({
		"jsonrpc": "2.0",
		"method": "ping",
		"id": 1,
	}).to_utf8_buffer()
	var unauth_result: Dictionary = parser.parse(unauth_payload)
	assert_false(unauth_result.get("ok", true), "Parser must reject packets missing the auth_token when auth is enabled")
	assert_eq(int(unauth_result.get("error", {}).get("code", 0)), -32000,
		"Parser must surface UNAUTHORIZED when the runtime config supplies an auth_token")


func test_start_exposes_parser_with_defaults_when_config_omits_fields() -> void:
	# When the runtime config does not carry auth_token / max_packet_bytes
	# (null config or an older resource), the parser must still be
	# instantiated with the IPv4 UDP default (65507) and auth disabled.
	_server = _new_server()

	var result: Dictionary = _server.start(null)
	assert_true(result.get("ok", false), "start() with null config must succeed")

	var parser: Object = _server.get_packet_parser()
	assert_not_null(parser, "UDP server must expose a packet parser even when config is null")

	# Auth disabled by default: a packet without an auth_token must pass.
	var payload: PackedByteArray = JSON.stringify({
		"jsonrpc": "2.0",
		"method": "ping",
		"id": 1,
	}).to_utf8_buffer()
	var parse_result: Dictionary = parser.parse(payload)
	assert_true(parse_result.get("ok", false), "Parser with default config must accept packets without an auth_token")
