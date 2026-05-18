extends Node
## McpBridge — runtime-channel autoload that owns the UDP server lifecycle.
##
## Registered as the `McpBridge` autoload in project.godot. The bridge stays
## dormant unless the game was launched with the `--mcp-bridge` CLI flag:
## without the flag, no UDP port is opened and no server is instantiated,
## so a shipping build never exposes a runtime listener by accident.
##
## When the flag is present, `activate()` asks the injected `server_factory`
## for a UDP server (defaults to McpUdpServer) and calls `start(config)` on
## it. The server handles port scanning across 6020-6029, active-port file
## bookkeeping under the "runtime" key, and the EXTERNAL_BIND_ENABLED
## warning for non-loopback binds.
##
## After the server binds, the bridge instantiates a
## `McpJsonRpcDispatcher`, registers the minimum runtime handlers
## (`runtime.handshake`, `runtime.heartbeat`) so probes from
## `RuntimeUdpClient` succeed even without the RPG module, then hands
## the dispatcher to the server. Modules (combat, inventory, ...) attach
## their tool surfaces by setting `tool_registrar` to a Callable that
## takes `(dispatcher, scene_root)` and registers handlers on the
## supplied dispatcher.
##
## During the running frame the bridge calls `server.poll()` from
## `_process()` so buffered datagrams are drained, parsed, dispatched
## and replied to without blocking the rest of the game loop.
##
## Note: the type name "McpBridge" is provided by the autoload registration
## in project.godot — a `class_name` declaration here would collide with the
## autoload singleton and is therefore omitted.

const ACTIVATION_CLI_FLAG: String = "--mcp-bridge"

const DEFAULT_UDP_SERVER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/runtime_bridge/udp_server.gd")
const DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")


# Factory returning an Object exposing `start(config) -> Dictionary` and
# `stop()`. Defaults to a real McpUdpServer; tests override this with a
# Callable returning a fake so the bridge never touches the network.
var server_factory: Callable = func() -> Object:
	return DEFAULT_UDP_SERVER_SCRIPT.new()

# Optional configuration Resource forwarded to `server.start(config)`.
# Null means the server falls back to its embedded defaults (127.0.0.1,
# ports 6020-6029).
var config: Object = null

# Optional Callable invoked once the dispatcher is ready, signature
# `func(dispatcher: Object, scene_root: Node) -> void`. Modules use it
# to attach their JSON-RPC handlers (combat, inventory, ...) without
# making the autoload aware of any specific module. Empty Callable
# means no extra registration — only the minimum handshake/heartbeat
# handlers wired in `_install_dispatcher()` are reachable.
var tool_registrar: Callable = Callable()

# Live server instance or null when the bridge is not active.
var _server: Object = null

# JSON-RPC dispatcher attached to the live server. Held here so
# external code (tests, integrations) can add handlers post-activation
# without reaching into the server.
var _dispatcher: Object = null

# Trace context {trace_id, span_id} attached to the most recent
# observe_packet() call. Transports read it after a dispatch so log
# lines can be correlated across processes. Initialised to an empty
# Dictionary until the first observation completes.
var _last_trace_context: Dictionary = {}


func _ready() -> void:
	var _result: Dictionary = activate(OS.get_cmdline_args())


## Drive the receive loop. The bridge polls the bound UDP socket once
## per frame so accepted datagrams are dispatched and replied to
## without ever blocking the engine. The poll is a no-op when the
## bridge is dormant or the server has not yet been wired with a
## dispatcher.
func _process(_delta: float) -> void:
	if _server == null:
		return
	if not _server.has_method("poll"):
		return
	_server.poll()


## Activate the runtime bridge if `--mcp-bridge` is present in `cli_args`.
## Returns a Dictionary describing the outcome:
##   { ok = true, port = <int> }                                 — started
##   { ok = false, reason = "cli_flag_absent" }                  — no flag
##   { ok = false, reason = "factory_returned_null" }            — bug in factory
##   { ok = false, error = <dict from server.start()> }          — bind failed
## Calling activate() while already active is a no-op that reports
## { ok = true, already_active = true }.
func activate(cli_args: Array) -> Dictionary:
	if _server != null:
		return {"ok": true, "already_active": true}
	if not _cli_flag_present(cli_args):
		return {"ok": false, "reason": "cli_flag_absent"}
	var server: Object = server_factory.call()
	if server == null:
		return {"ok": false, "reason": "factory_returned_null"}
	var result: Dictionary = server.start(config)
	if not result.get("ok", false):
		return result
	_server = server
	_install_dispatcher(server)
	return result


## Stop the server started by activate(). No-op when the bridge is not
## currently active.
func deactivate() -> void:
	if _server == null:
		return
	_server.stop()
	_server = null
	_dispatcher = null


## True when a live UDP server is held by the bridge.
func is_active() -> bool:
	return _server != null


## Expose the live server instance for diagnostics. Returns null when the
## bridge is not active.
func get_server() -> Object:
	return _server


## Expose the live JSON-RPC dispatcher so callers (tests, modules
## with deferred wiring) can register additional handlers after
## activation. Returns null when the bridge is not active.
func get_dispatcher() -> Object:
	return _dispatcher


## Read the trace context (`{trace_id, span_id}`) attached to the most
## recent `observe_packet()` call. Returns an empty Dictionary before
## the first observation completes.
func get_last_trace_context() -> Dictionary:
	return _last_trace_context.duplicate(true)


## Surface the trace context carried by an incoming UDP packet. The
## UDP server calls this once per accepted packet, passing the parsed
## JSON-RPC envelope. When the envelope carries a `trace` field with
## `{trace_id, span_id}` and both fields parse as hex strings of the
## expected width (8 / 4 lowercase hex chars), the bridge echoes them;
## otherwise a fresh pair is minted so every packet remains
## correlatable even when the sender did not inject a trace envelope.
func observe_packet(request: Variant) -> Dictionary:
	_last_trace_context = _extract_or_mint_trace_context(request)
	return _last_trace_context.duplicate(true)


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------

## Build a fresh dispatcher, register the minimum runtime handlers, run
## the optional `tool_registrar` Callable, and hand the dispatcher to
## the server so the receive loop can dispatch incoming packets.
func _install_dispatcher(server: Object) -> void:
	if not server.has_method("set_dispatcher"):
		# Test doubles or older fakes that do not implement the
		# receive-loop contract — leave the dispatcher detached.
		return
	var dispatcher: Object = DISPATCHER_SCRIPT.new()
	_register_minimum_runtime_handlers(dispatcher)
	if tool_registrar.is_valid():
		# Caller signature is `func(dispatcher: Object, scene_root: Node)`.
		# `get_tree().root` is null until the autoload has entered the
		# tree; in the activate-from-`_ready` path it is already
		# populated, so it is safe to pass through.
		var scene_root: Node = null
		var tree: SceneTree = get_tree()
		if tree != null:
			scene_root = tree.root
		tool_registrar.call(dispatcher, scene_root)
	_dispatcher = dispatcher
	server.set_dispatcher(dispatcher)


## Register the minimum JSON-RPC handlers every runtime bridge needs:
## `runtime.handshake` is the probe target used by `RuntimeUdpClient`
## to discover an open port and to authenticate, while
## `runtime.heartbeat` keeps the client's reconnect timer at bay. Both
## return small literal payloads — the production runtime backend
## adapter (`McpRuntimeDiagnosticTools`) can override them later by
## re-registering with `register_handler`.
func _register_minimum_runtime_handlers(dispatcher: Object) -> void:
	dispatcher.register_handler(
		"runtime.handshake",
		Callable(self, "_handshake_handler"),
	)
	dispatcher.register_handler(
		"runtime.heartbeat",
		Callable(self, "_heartbeat_handler"),
	)


func _handshake_handler(_params: Variant) -> Variant:
	# The client's handshake check accepts a missing `authenticated`
	# field as success; we still emit it so the contract is explicit.
	return {
		"authenticated": true,
		"server_version": "0.10.0",
		"latest_version": "0.10.0",
	}


func _heartbeat_handler(_params: Variant) -> Variant:
	return {"pong": true, "ts": int(Time.get_ticks_msec())}


static func _cli_flag_present(cli_args: Array) -> bool:
	for arg in cli_args:
		if String(arg) == ACTIVATION_CLI_FLAG:
			return true
	return false


## Extract `{trace_id, span_id}` from the `trace` field of an incoming
## UDP payload; mint a fresh pair when the field is missing or invalid.
static func _extract_or_mint_trace_context(request: Variant) -> Dictionary:
	if request is Dictionary:
		var dict: Dictionary = request as Dictionary
		if dict.has("trace"):
			var envelope: Variant = dict.get("trace")
			if envelope is Dictionary:
				var trace_dict: Dictionary = envelope as Dictionary
				var trace_id: String = String(trace_dict.get("trace_id", ""))
				var span_id: String = String(trace_dict.get("span_id", ""))
				if _is_lowercase_hex(trace_id, 8) and _is_lowercase_hex(span_id, 4):
					return {"trace_id": trace_id, "span_id": span_id}
	return {
		"trace_id": _random_hex_lowercase(8),
		"span_id": _random_hex_lowercase(4),
	}


const _HEX_ALPHABET: Array = ["0", "1", "2", "3", "4", "5", "6", "7",
	"8", "9", "a", "b", "c", "d", "e", "f"]


static func _random_hex_lowercase(width: int) -> String:
	var out: String = ""
	for i in range(width):
		out += _HEX_ALPHABET[randi() % 16]
	return out


static func _is_lowercase_hex(value: String, expected_width: int) -> bool:
	if value.length() != expected_width:
		return false
	for c in value:
		var is_digit: bool = c >= "0" and c <= "9"
		var is_lower_hex: bool = c >= "a" and c <= "f"
		if not is_digit and not is_lower_hex:
			return false
	return true
