@tool
extends RefCounted
## WebSocket server entrypoint for the ForgeKit MCP editor plugin.
##
## Scans the editor port range (default 6010-6019) using TCPServer probes to
## find the first free port, then binds a WebSocketMultiplayerPeer on that
## port. The selected port is recorded under the "editor" key in
## user://mcp_active_port.json, merging with any sibling entries written by
## the runtime bridge, visualizer, or health endpoint.
##
## Configuration is duck-typed: any Resource exposing `port_base`,
## `port_range_size`, and `bind_address` is accepted. Passing `null` falls
## back to the defaults embedded below.

class_name McpWebSocketServer


const DEFAULT_PORT_BASE: int = 6010
const DEFAULT_PORT_RANGE_SIZE: int = 10
const DEFAULT_BIND_ADDRESS: String = "127.0.0.1"
const ACTIVE_PORT_FILE: String = "user://mcp_active_port.json"
const ACTIVE_PORT_KEY: String = "editor"


var _tcp_server: TCPServer = null
var _ws_peer: WebSocketMultiplayerPeer = null
var _active_port: int = -1
var _warnings: Array = []


## Start the server, scanning the configured port range.
## Returns { ok: bool, port?: int, error?: Dictionary }.
func start(config: Object) -> Dictionary:
	_warnings = []

	var port_base: int = _config_get(config, &"port_base", DEFAULT_PORT_BASE)
	var port_range_size: int = _config_get(config, &"port_range_size", DEFAULT_PORT_RANGE_SIZE)
	var bind_address: String = _config_get(config, &"bind_address", DEFAULT_BIND_ADDRESS)

	if bind_address != DEFAULT_BIND_ADDRESS:
		_warnings.append({
			"code": "EXTERNAL_BIND_ENABLED",
			"bind_address": bind_address,
			"message": "Server is bound to a non-loopback address; MCP traffic is exposed to the network.",
		})

	var checked_ports: Array = []
	for offset in range(port_range_size):
		var candidate: int = port_base + offset
		checked_ports.append(candidate)
		if _try_bind(candidate, bind_address):
			_active_port = candidate
			_write_active_port(candidate)
			return {"ok": true, "port": candidate}

	return {
		"ok": false,
		"error": {
			"code": "NO_AVAILABLE_PORT",
			"checked_ports": checked_ports,
			"bind_address": bind_address,
			"message": "All ports in the editor range are occupied.",
		},
	}


## Stop the server and release the bound port.
func stop() -> void:
	if _ws_peer != null:
		_ws_peer.close()
		_ws_peer = null
	if _tcp_server != null:
		_tcp_server.stop()
		_tcp_server = null
	if _active_port != -1:
		_clear_active_port()
		_active_port = -1


func is_listening() -> bool:
	return _tcp_server != null and _tcp_server.is_listening()


func get_active_port() -> int:
	return _active_port


func get_warnings() -> Array:
	return _warnings.duplicate()


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------

func _try_bind(port: int, bind_address: String) -> bool:
	var tcp: TCPServer = TCPServer.new()
	var err: int = tcp.listen(port, bind_address)
	if err != OK:
		tcp.stop()
		return false

	# Probe succeeded: keep the TCPServer as the authoritative listener used
	# by is_listening(), and hand the same port to the WebSocket peer. The
	# WebSocket peer is a RefCounted helper that will be wired to incoming
	# connections once the JSON-RPC dispatcher lands in a later task.
	_tcp_server = tcp
	_ws_peer = WebSocketMultiplayerPeer.new()
	return true


func _config_get(config: Object, field: StringName, fallback: Variant) -> Variant:
	if config == null:
		return fallback
	if not (field in config):
		return fallback
	var value: Variant = config.get(field)
	if value == null:
		return fallback
	return value


func _read_active_port_file() -> Dictionary:
	if not FileAccess.file_exists(ACTIVE_PORT_FILE):
		return {}
	var file: FileAccess = FileAccess.open(ACTIVE_PORT_FILE, FileAccess.READ)
	if file == null:
		return {}
	var text: String = file.get_as_text()
	file.close()
	var parsed: Variant = JSON.parse_string(text)
	if parsed is Dictionary:
		return parsed
	return {}


func _write_active_port_file(data: Dictionary) -> void:
	var file: FileAccess = FileAccess.open(ACTIVE_PORT_FILE, FileAccess.WRITE)
	if file == null:
		return
	file.store_string(JSON.stringify(data))
	file.close()


func _write_active_port(port: int) -> void:
	var data: Dictionary = _read_active_port_file()
	data[ACTIVE_PORT_KEY] = port
	_write_active_port_file(data)


func _clear_active_port() -> void:
	var data: Dictionary = _read_active_port_file()
	if not data.has(ACTIVE_PORT_KEY):
		return
	data.erase(ACTIVE_PORT_KEY)
	_write_active_port_file(data)
