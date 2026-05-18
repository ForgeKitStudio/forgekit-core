extends RefCounted
## UDP server entrypoint for the ForgeKit MCP runtime bridge.
##
## Scans the runtime port range (default 6020-6029) using PacketPeerUDP
## probes to find the first free port, then binds on it. The selected
## port is recorded under the "runtime" key in user://mcp_active_port.json,
## merging with any sibling entries written by the editor plugin,
## visualizer, or health endpoint.
##
## Configuration is duck-typed: any Resource exposing `port_base`,
## `port_range_size`, and `bind_address` is accepted. The optional
## fields `auth_token` (shared secret for the auth gate) and
## `max_packet_bytes` (datagram size ceiling) are forwarded to the
## owned McpRuntimePacketParser so incoming packets are validated
## before they reach the JSON-RPC dispatcher. Passing `null`
## falls back to the defaults embedded below (loopback bind,
## IPv4 UDP size limit, auth disabled).
##
## Receive loop. After `start()` succeeds, callers (typically McpBridge
## from `_process()`) drive the receive loop by invoking `poll()` once
## per frame. `poll()` drains every buffered datagram, parses each
## through the `McpRuntimePacketParser`, dispatches accepted requests
## through the supplied `McpJsonRpcDispatcher`, and replies to the
## sender via the bound socket. Pass the dispatcher via
## `set_dispatcher()` before the first `poll()`.

class_name McpUdpServer


const PACKET_PARSER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/runtime_bridge/packet_parser.gd")


const DEFAULT_PORT_BASE: int = 6020
const DEFAULT_PORT_RANGE_SIZE: int = 10
const DEFAULT_BIND_ADDRESS: String = "127.0.0.1"
const ACTIVE_PORT_FILE: String = "user://mcp_active_port.json"
const ACTIVE_PORT_KEY: String = "runtime"

# Hard cap on datagrams drained per `poll()` call. Without it a flood
# of packets could starve the rest of `_process()`. The number is large
# enough that legitimate bursts (handshake + several tool calls in the
# same frame) are absorbed in one poll, yet small enough that the
# remaining traffic is naturally back-pressured to the next frame.
const _MAX_DATAGRAMS_PER_POLL: int = 32


var _udp_peer: PacketPeerUDP = null
var _active_port: int = -1
var _warnings: Array = []
var _packet_parser: Object = null
var _dispatcher: Object = null

# Renamer callable — `func(from_path: String, to_path: String) -> int` where
# the returned int follows `@GlobalScope.Error` conventions (OK on success).
# Defaults to `DirAccess.rename_absolute` but can be overridden in tests so
# rename failures can be simulated without touching the real filesystem.
var _renamer: Callable = Callable(DirAccess, "rename_absolute")


## Override the renamer used by the atomic active-port writer. Tests use
## this to inject a recording / failing renamer without touching the real
## filesystem.
func set_renamer(renamer: Callable) -> void:
	_renamer = renamer


## Configure the JSON-RPC dispatcher invoked for every accepted
## datagram. The dispatcher must expose `dispatch(request: Variant) ->
## Dictionary` returning a JSON-RPC envelope (or empty dict for
## notifications). Passing null disables the receive loop — `poll()`
## becomes a no-op and incoming traffic is silently dropped after the
## packet parser stage. Tests inject a fake dispatcher; `McpBridge`
## injects a real `McpJsonRpcDispatcher` after registering tool
## handlers.
func set_dispatcher(dispatcher: Object) -> void:
	_dispatcher = dispatcher


## True once the dispatcher is wired so the receive loop can hand
## packets to it. `poll()` early-exits when this returns false.
func has_dispatcher() -> bool:
	return _dispatcher != null


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
			"message": "Runtime bridge is bound to a non-loopback address; MCP traffic is exposed to the network.",
		})

	# Build the packet parser up-front so the size / auth gates are
	# ready the moment the port is bound. The parser is config-driven:
	# an empty auth_token keeps the gate disabled (dev / fresh template
	# mode), and a missing max_packet_bytes falls back to the IPv4 UDP
	# ceiling baked into the parser.
	_packet_parser = _build_packet_parser(config)

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
			"message": "All ports in the runtime range are occupied.",
		},
	}


## Stop the server and release the bound port.
func stop() -> void:
	if _udp_peer != null:
		_udp_peer.close()
		_udp_peer = null
	if _active_port != -1:
		_clear_active_port()
		_active_port = -1
	_packet_parser = null


func is_listening() -> bool:
	return _udp_peer != null and _udp_peer.is_bound()


func get_active_port() -> int:
	return _active_port


func get_warnings() -> Array:
	return _warnings.duplicate()


## The packet parser instantiated by the last `start()` call. Returns
## null until `start()` has been invoked. Exposed so the MCP bridge
## and tests can drive the size / auth / metric gates independently
## of the receive loop wired up in later phases.
func get_packet_parser() -> Object:
	return _packet_parser


## Drain every buffered datagram, parse and dispatch each, and reply
## to the sender on the same socket. Designed to be called once per
## frame from `_process()` on the autoload that owns this server.
##
## A single `poll()` call processes up to `_MAX_DATAGRAMS_PER_POLL`
## packets so a flood cannot starve the rest of the frame. Remaining
## packets are picked up on the next call.
##
## Notifications (JSON-RPC requests without an `id` field) produce no
## reply — `dispatch()` returns an empty dictionary which is silently
## skipped here. Errors at any stage of the pipeline (size gate, JSON
## parse, auth, dispatcher exception) are wrapped into a JSON-RPC
## error response and sent back to the sender so the client never
## hangs waiting for a reply.
func poll() -> int:
	if _udp_peer == null or not _udp_peer.is_bound():
		return 0
	if _packet_parser == null or _dispatcher == null:
		return 0

	var processed: int = 0
	while processed < _MAX_DATAGRAMS_PER_POLL and _udp_peer.get_available_packet_count() > 0:
		var raw: PackedByteArray = _udp_peer.get_packet()
		var sender_address: String = _udp_peer.get_packet_ip()
		var sender_port: int = _udp_peer.get_packet_port()
		processed += 1

		var parse_result: Dictionary = _packet_parser.parse(raw)
		if not parse_result.get("ok", false):
			# The parser already shaped the JSON-RPC error envelope.
			# Echo `id: null` because we never decoded the original
			# request far enough to recover the caller's id.
			_send_error(sender_address, sender_port, parse_result.get("error", {}), null)
			continue

		var request: Dictionary = parse_result.get("request", {}) as Dictionary
		var auth_token: String = String(parse_result.get("auth_token", ""))

		var response: Dictionary = _dispatcher.dispatch(request, auth_token)
		if response.is_empty():
			# Notification — no reply required.
			continue

		_send_packet(sender_address, sender_port, JSON.stringify(response))
	return processed


# Send a JSON-RPC error envelope with id=null. Used when the packet
# parser rejects a datagram before we ever see the request body.
func _send_error(address: String, port: int, error: Dictionary, id: Variant) -> void:
	var envelope: Dictionary = {
		"jsonrpc": "2.0",
		"error": error,
		"id": id,
	}
	_send_packet(address, port, JSON.stringify(envelope))


# Set the destination on the bound socket and put a single datagram.
# Errors are surfaced as `push_warning` so a misbehaving client cannot
# silently break observability.
func _send_packet(address: String, port: int, payload: String) -> void:
	if _udp_peer == null:
		return
	var dest_err: int = _udp_peer.set_dest_address(address, port)
	if dest_err != OK:
		push_warning("McpUdpServer: set_dest_address(%s:%d) failed with %d" % [address, port, dest_err])
		return
	var put_err: int = _udp_peer.put_packet(payload.to_utf8_buffer())
	if put_err != OK:
		push_warning("McpUdpServer: put_packet to %s:%d failed with %d" % [address, port, put_err])


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------

func _try_bind(port: int, bind_address: String) -> bool:
	var peer: PacketPeerUDP = PacketPeerUDP.new()
	var err: int = peer.bind(port, bind_address)
	if err != OK:
		peer.close()
		return false
	_udp_peer = peer
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


## Build a McpRuntimePacketParser seeded from the runtime config. The
## parser is created unconditionally so the receive loop always has a
## size / auth gate to route packets through; when the config omits
## `auth_token` the gate is disabled, and when it omits
## `max_packet_bytes` the parser's IPv4 UDP default (65507) is used.
func _build_packet_parser(config: Object) -> Object:
	var parser: Object = PACKET_PARSER_SCRIPT.new()
	var auth_token: String = String(_config_get(config, &"auth_token", ""))
	if not auth_token.is_empty():
		parser.set_auth_token(auth_token)
	var max_bytes: int = int(_config_get(config, &"max_packet_bytes", 0))
	if max_bytes > 0:
		parser.set_max_packet_bytes(max_bytes)
	return parser


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
	# Atomic write: serialize to a sibling temp file, flush it, then rename
	# it over the target. A crash or power loss between the write and the
	# rename leaves the original file byte-for-byte intact — the temp
	# sidecar can be discarded on the next boot. This mirrors the
	# read→parse→modify→write-temp→fsync→rename sequence used by
	# McpProjectSettingsAtomicWriter for `project.godot`.
	var tmp_path: String = ACTIVE_PORT_FILE + ".tmp"
	var file: FileAccess = FileAccess.open(tmp_path, FileAccess.WRITE)
	if file == null:
		return
	file.store_string(JSON.stringify(data))
	file.close()

	# Flush — GDScript has no fsync(2); reopening and closing the temp
	# forces FileAccess to release any buffered writes held above the OS
	# page cache boundary.
	var probe: FileAccess = FileAccess.open(tmp_path, FileAccess.READ)
	if probe == null:
		_remove_if_exists(tmp_path)
		return
	probe.close()

	var rename_err: int = int(_renamer.call(tmp_path, ACTIVE_PORT_FILE))
	if rename_err != OK:
		_remove_if_exists(tmp_path)
		return


static func _remove_if_exists(path: String) -> void:
	if FileAccess.file_exists(path):
		DirAccess.remove_absolute(path)


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
