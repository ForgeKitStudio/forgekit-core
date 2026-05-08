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
## Note: the type name "McpBridge" is provided by the autoload registration
## in project.godot — a `class_name` declaration here would collide with the
## autoload singleton and is therefore omitted.

const ACTIVATION_CLI_FLAG: String = "--mcp-bridge"

const DEFAULT_UDP_SERVER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/runtime_bridge/udp_server.gd")


# Factory returning an Object exposing `start(config) -> Dictionary` and
# `stop()`. Defaults to a real McpUdpServer; tests override this with a
# Callable returning a fake so the bridge never touches the network.
var server_factory: Callable = func() -> Object:
	return DEFAULT_UDP_SERVER_SCRIPT.new()

# Optional configuration Resource forwarded to `server.start(config)`.
# Null means the server falls back to its embedded defaults (127.0.0.1,
# ports 6020-6029).
var config: Object = null

# Live server instance or null when the bridge is not active.
var _server: Object = null


func _ready() -> void:
	var _result: Dictionary = activate(OS.get_cmdline_args())


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
	return result


## Stop the server started by activate(). No-op when the bridge is not
## currently active.
func deactivate() -> void:
	if _server == null:
		return
	_server.stop()
	_server = null


## True when a live UDP server is held by the bridge.
func is_active() -> bool:
	return _server != null


## Expose the live server instance for diagnostics. Returns null when the
## bridge is not active.
func get_server() -> Object:
	return _server


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------

static func _cli_flag_present(cli_args: Array) -> bool:
	for arg in cli_args:
		if String(arg) == ACTIVATION_CLI_FLAG:
			return true
	return false
