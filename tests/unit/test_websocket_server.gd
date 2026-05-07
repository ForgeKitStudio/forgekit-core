extends GutTest
## Unit tests for McpWebSocketServer: port scanning across the editor range
## (6010–6019), active-port file merge under the `editor` key, the
## EXTERNAL_BIND_ENABLED warning for non-loopback binds, and the
## NO_AVAILABLE_PORT error shape when the whole range is occupied.


const WEBSOCKET_SERVER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/websocket_server.gd")

const DEFAULT_PORT_BASE: int = 6010
const DEFAULT_PORT_RANGE_SIZE: int = 10
const LOOPBACK: String = "127.0.0.1"
const ACTIVE_PORT_FILE: String = "user://mcp_active_port.json"


# ---------------------------------------------------------------------------
# FakeConfig — a minimal script-backed Resource duck-typed as plugin_config.
# Lets each test drive the scanner with a specific bind_address / port range
# without touching the real plugin_config.tres.
# ---------------------------------------------------------------------------

class FakeConfig:
	extends Resource

	@export var port_base: int = DEFAULT_PORT_BASE
	@export var port_range_size: int = DEFAULT_PORT_RANGE_SIZE
	@export var bind_address: String = LOOPBACK


var _blockers: Array = []
var _server: Object = null


func before_each() -> void:
	_blockers = []
	_server = null
	_remove_active_port_file()


func after_each() -> void:
	if _server != null and _server.has_method("stop"):
		_server.stop()
	_server = null
	for blocker in _blockers:
		(blocker as TCPServer).stop()
	_blockers.clear()
	_remove_active_port_file()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

func _occupy_ports(ports: Array) -> void:
	for p in ports:
		var srv: TCPServer = TCPServer.new()
		var err: int = srv.listen(int(p), LOOPBACK)
		assert_eq(err, OK, "Failed to pre-occupy port %d in test setup" % int(p))
		_blockers.append(srv)


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
	return WEBSOCKET_SERVER_SCRIPT.new()


# ---------------------------------------------------------------------------
# 1) Null config + all defaults: scanner picks the first port in the range
#    and reports ok=true with that port.
# ---------------------------------------------------------------------------

func test_start_with_null_config_uses_defaults_and_binds_port_base() -> void:
	_server = _new_server()

	var result: Dictionary = _server.start(null)

	assert_true(result.get("ok", false), "start() with null config must succeed on the default port")
	assert_eq(result.get("port", -1), DEFAULT_PORT_BASE, "start() must bind to the default port base when nothing is occupied")
	assert_true(_server.is_listening(), "Server must report is_listening()==true after a successful start")


# ---------------------------------------------------------------------------
# 2) When lower ports in the range are occupied, the scanner picks the first
#    free port above them.
# ---------------------------------------------------------------------------

func test_start_selects_first_free_port_when_lower_ports_are_occupied() -> void:
	_occupy_ports([6010, 6011, 6012])
	_server = _new_server()

	var result: Dictionary = _server.start(FakeConfig.new())

	assert_true(result.get("ok", false), "start() must succeed when at least one port in the range is free")
	assert_eq(result.get("port", -1), 6013, "Scanner must skip occupied ports and pick the first free one")
	assert_eq(_server.get_active_port(), 6013, "get_active_port() must echo the port chosen by the scanner")


# ---------------------------------------------------------------------------
# 3) The selected port is written to user://mcp_active_port.json under the
#    `editor` key.
# ---------------------------------------------------------------------------

func test_start_writes_selected_port_to_active_port_file_under_editor_key() -> void:
	_occupy_ports([6010])
	_server = _new_server()

	var result: Dictionary = _server.start(FakeConfig.new())
	assert_true(result.get("ok", false), "start() must succeed in this scenario")

	var data: Dictionary = _read_active_port_file()
	assert_eq(data.get("editor", -1), 6011, "Active port file must record the chosen editor port under the 'editor' key")


# ---------------------------------------------------------------------------
# 4) start() merges the `editor` entry with any pre-existing keys in the
#    active-port file so parallel components (runtime, visualizer, health)
#    keep their entries.
# ---------------------------------------------------------------------------

func test_start_merges_editor_key_into_existing_active_port_file() -> void:
	_write_active_port_file({
		"runtime": 6025,
		"visualizer": 6030,
		"health": 6040,
	})
	_server = _new_server()

	var result: Dictionary = _server.start(FakeConfig.new())
	assert_true(result.get("ok", false), "start() must succeed in this scenario")

	var data: Dictionary = _read_active_port_file()
	assert_eq(data.get("editor", -1), 6010, "Editor port must be inserted into the active-port file")
	assert_eq(data.get("runtime", -1), 6025, "Pre-existing runtime key must be preserved")
	assert_eq(data.get("visualizer", -1), 6030, "Pre-existing visualizer key must be preserved")
	assert_eq(data.get("health", -1), 6040, "Pre-existing health key must be preserved")


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

	var _result: Dictionary = _server.start(FakeConfig.new())

	var warnings: Array = _server.get_warnings()
	for w in warnings:
		var wd: Dictionary = w
		assert_ne(wd.get("code", ""), "EXTERNAL_BIND_ENABLED", "Loopback bind must not raise EXTERNAL_BIND_ENABLED")


# ---------------------------------------------------------------------------
# 8) stop() releases the bound port so it can be re-listened immediately, and
#    removes the `editor` key from the active-port file while preserving
#    sibling keys.
# ---------------------------------------------------------------------------

func test_stop_releases_port_and_clears_editor_key_in_active_port_file() -> void:
	_write_active_port_file({"runtime": 6025})
	_server = _new_server()
	var start_result: Dictionary = _server.start(FakeConfig.new())
	assert_true(start_result.get("ok", false), "start() must succeed in this scenario")
	var chosen_port: int = int(start_result.get("port", 0))

	_server.stop()

	assert_false(_server.is_listening(), "is_listening() must return false after stop()")

	# Port is released: a fresh TCPServer can listen on the same port.
	var probe: TCPServer = TCPServer.new()
	var err: int = probe.listen(chosen_port, LOOPBACK)
	assert_eq(err, OK, "stop() must release the bound port so it is listenable again")
	probe.stop()

	var data: Dictionary = _read_active_port_file()
	assert_false(data.has("editor"), "stop() must remove the 'editor' key from the active-port file")
	assert_eq(data.get("runtime", -1), 6025, "stop() must preserve sibling keys in the active-port file")


# ---------------------------------------------------------------------------
# 9) Non-contiguous occupied ports: when the occupied set has gaps, the
#    scanner must pick the first free port, not skip past gaps or reuse an
#    occupied one. Occupying 6010, 6013, 6016 leaves 6011 as the first free.
# ---------------------------------------------------------------------------

func test_start_picks_first_gap_when_occupied_ports_are_non_contiguous() -> void:
	_occupy_ports([6010, 6013, 6016])
	_server = _new_server()

	var result: Dictionary = _server.start(FakeConfig.new())

	assert_true(result.get("ok", false), "start() must succeed when a gap exists below occupied ports")
	assert_eq(result.get("port", -1), 6011, "Scanner must pick the first free port in a non-contiguous layout")
	assert_eq(_server.get_active_port(), 6011, "get_active_port() must echo the gap port that was selected")


# ---------------------------------------------------------------------------
# 10) Only the last port in the range is free: occupy 6010–6018 and verify
#     the scanner still finds 6019 (guards against an off-by-one that would
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
	assert_eq(result.get("port", -1), DEFAULT_PORT_BASE + DEFAULT_PORT_RANGE_SIZE - 1, "Scanner must reach the last port in the configured range")


# ---------------------------------------------------------------------------
# 11) Custom port_base and port_range_size from the config are honoured.
#     The scanner probes a completely different range than the default one
#     (7000–7002), proving the range is driven by config, not hard-coded.
# ---------------------------------------------------------------------------

func test_start_honours_custom_port_base_and_range_size_from_config() -> void:
	var cfg: FakeConfig = FakeConfig.new()
	cfg.port_base = 7000
	cfg.port_range_size = 3
	_server = _new_server()

	var result: Dictionary = _server.start(cfg)

	assert_true(result.get("ok", false), "start() must succeed on a free custom range")
	assert_eq(result.get("port", -1), 7000, "Scanner must bind to the configured custom port_base when it is free")
	assert_eq(_server.get_active_port(), 7000, "get_active_port() must report the custom-range port")
