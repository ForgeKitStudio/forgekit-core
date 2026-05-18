@tool
extends EditorPlugin
## Top-level EditorPlugin for ForgeKit Core.
##
## Boots the MCP editor-channel WebSocket server when the editor
## activates the plugin, registers the JSON-RPC handlers required for
## scene operations (`scene.open`, `scene.save`, `node.set_property`,
## `editor.undo`), and tears the server down on deactivation.
##
## The server scans ports 6010-6019 on `127.0.0.1` and writes the
## chosen port into `user://mcp_active_port.json` under the `editor`
## key so the `@forgekitstudio/core-mcp` client can discover it
## without per-machine configuration.
##
## Configuration is read from `addons/forgekit_core/mcp/plugin_config.tres`
## when present (port, bind_address, auth_token, log_level). When the
## file is absent, the server falls back to its built-in defaults so
## the editor plugin works out-of-the-box for fresh template clones.

const _WEBSOCKET_SERVER_SCRIPT: GDScript = preload(
	"res://addons/forgekit_core/mcp/editor_plugin/websocket_server.gd"
)
const _DISPATCHER_SCRIPT: GDScript = preload(
	"res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd"
)
const _BACKEND_SCRIPT: GDScript = preload(
	"res://addons/forgekit_core/mcp/editor_plugin/editor_channel_backend.gd"
)

const _PLUGIN_CONFIG_PATH: String = "res://addons/forgekit_core/mcp/plugin_config.tres"

var _ws_server: Object = null
var _dispatcher: Object = null
var _backend: Object = null


func _enter_tree() -> void:
	_ws_server = _WEBSOCKET_SERVER_SCRIPT.new()
	var config: Object = _load_plugin_config()
	var result: Dictionary = _ws_server.start(config)
	if not bool(result.get("ok", false)):
		var error: Dictionary = result.get("error", {})
		push_warning(
			"[forgekit] MCP editor WebSocket server failed to start: %s"
			% String(error.get("message", "unknown error"))
		)
		_ws_server = null
		return

	for warning in _ws_server.get_warnings():
		push_warning(
			"[forgekit] MCP editor server warning: %s"
			% String((warning as Dictionary).get("message", ""))
		)

	_dispatcher = _DISPATCHER_SCRIPT.new()
	_backend = _BACKEND_SCRIPT.new()
	_backend.register_on(_dispatcher)
	_ws_server.set_dispatcher(_dispatcher)


func _exit_tree() -> void:
	if _ws_server != null:
		_ws_server.set_dispatcher(null)
		_ws_server.stop()
		_ws_server = null
	_dispatcher = null
	_backend = null


# Drive the WebSocket server's receive loop once per editor frame so
# accepted connections complete their handshake, queued frames are
# parsed, and JSON-RPC responses are flushed to clients.
func _process(_delta: float) -> void:
	if _ws_server == null:
		return
	_ws_server.poll()


# Load `plugin_config.tres` when available; otherwise return an empty
# Resource so the WebSocket server falls back to its embedded defaults.
# The server reads the config via duck typing (`_config_get`), so any
# missing fields are tolerated.
func _load_plugin_config() -> Object:
	if not ResourceLoader.exists(_PLUGIN_CONFIG_PATH):
		return Resource.new()
	var loaded: Resource = ResourceLoader.load(
		_PLUGIN_CONFIG_PATH, "", ResourceLoader.CACHE_MODE_REPLACE
	)
	if loaded == null:
		return Resource.new()
	return loaded
