@tool
extends RefCounted
## WebSocket server entrypoint for the ForgeKit MCP editor plugin.
##
## Scans the editor port range (default 6010-6019) using TCPServer probes to
## find the first free port, binds a TCPServer on that port, and accepts
## incoming WebSocket connections on top of it. Each connected peer is
## driven through `WebSocketPeer.accept_stream()` so the production HTTP
## upgrade and frame parsing live inside the engine. The selected port is
## recorded under the "editor" key in `user://mcp_active_port.json`,
## merging with any sibling entries written by the runtime bridge,
## visualizer, or health endpoint.
##
## Once a `JsonRpcDispatcher` has been wired through `set_dispatcher()`,
## callers (typically the EditorPlugin owning the server) drive the
## receive loop by invoking `poll()` once per editor frame. `poll()`
## drains every buffered text frame from every connected peer, hands
## each payload to the dispatcher, and writes the JSON-RPC response
## back on the originating peer. Notifications (no `id`) produce no
## reply.
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

# Hard cap on text frames drained per peer per `poll()` call. Without it a
# misbehaving client could starve the rest of the editor frame. Remaining
# frames are picked up on subsequent polls.
const _MAX_FRAMES_PER_PEER_PER_POLL: int = 32


var _tcp_server: TCPServer = null
# Connected peers. Each entry is a WebSocketPeer in any handshake or
# OPEN/CLOSED state. The poll() loop prunes closed entries.
var _peers: Array = []
var _active_port: int = -1
var _warnings: Array = []
# JSON-RPC dispatcher invoked for every accepted text frame. Null until
# wired through `set_dispatcher()`. While null, incoming frames are
# silently dropped after parsing.
var _dispatcher: Object = null


## Wire the JSON-RPC dispatcher invoked for every incoming text frame.
## The dispatcher must expose `dispatch(raw: Variant) -> Dictionary`.
## Pass `null` to detach (used during teardown).
func set_dispatcher(dispatcher: Object) -> void:
	_dispatcher = dispatcher


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
	for entry in _peers:
		var ws: WebSocketPeer = entry as WebSocketPeer
		if ws != null:
			ws.close()
	_peers.clear()
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


## Drive the receive loop. Accepts every pending TCP connection,
## promotes each to a WebSocketPeer, polls every connected peer, and
## hands queued text frames to the dispatcher. Designed to be called
## once per editor frame.
func poll() -> void:
	if _tcp_server == null or not _tcp_server.is_listening():
		return

	# 1. Accept new TCP connections and promote each to a WebSocket peer.
	while _tcp_server.is_connection_available():
		var stream: StreamPeerTCP = _tcp_server.take_connection()
		if stream == null:
			continue
		var ws: WebSocketPeer = WebSocketPeer.new()
		var err: int = ws.accept_stream(stream)
		if err != OK:
			push_warning(
				"McpWebSocketServer: WebSocketPeer.accept_stream failed with %d" % err
			)
			continue
		_peers.append(ws)

	# 2. Service every existing peer. Drop closed/closing peers.
	var still_alive: Array = []
	for entry in _peers:
		var ws: WebSocketPeer = entry as WebSocketPeer
		if ws == null:
			continue
		ws.poll()
		var state: int = ws.get_ready_state()
		if state == WebSocketPeer.STATE_CLOSED:
			continue
		if state == WebSocketPeer.STATE_OPEN:
			var processed: int = 0
			while processed < _MAX_FRAMES_PER_PEER_PER_POLL and ws.get_available_packet_count() > 0:
				var pkt: PackedByteArray = ws.get_packet()
				processed += 1
				_handle_frame(ws, pkt)
		still_alive.append(ws)
	_peers = still_alive


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------

# Decode a UTF-8 frame, dispatch it through the JSON-RPC dispatcher, and
# write the response back on the originating peer. Notifications produce
# an empty Dictionary which is silently skipped here.
func _handle_frame(ws: WebSocketPeer, pkt: PackedByteArray) -> void:
	if _dispatcher == null:
		return
	var text: String = pkt.get_string_from_utf8()
	var response: Variant = _dispatcher.dispatch(text)
	if not (response is Dictionary):
		return
	var response_dict: Dictionary = response as Dictionary
	if response_dict.is_empty():
		return  # Notification — no reply expected.
	var payload: String = JSON.stringify(response_dict)
	var send_err: int = ws.send_text(payload)
	if send_err != OK:
		push_warning("McpWebSocketServer: send_text failed with %d" % send_err)


func _try_bind(port: int, bind_address: String) -> bool:
	var tcp: TCPServer = TCPServer.new()
	var err: int = tcp.listen(port, bind_address)
	if err != OK:
		tcp.stop()
		return false
	_tcp_server = tcp
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
