@tool
extends EditorPlugin
## MCP editor plugin entrypoint. Registers the McpEditorPlugin autoload
## while active so the runtime bridge singleton is available to MCP tooling
## and starts / stops the editor-channel WebSocket server via a delegated
## `McpEditorPluginLifecycle` helper.


const _LIFECYCLE_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/plugin_lifecycle.gd")
const _DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")
const _VISUALIZER_HTTP_SERVER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/visualizer/http_server.gd")
const _VISUALIZER_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/tools/visualizer_tools.gd")
const _ASSET_GENERATOR_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/tools/asset_generator_tools.gd")
const _HEALING_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/healing/healing_tools.gd")

const _AUTOLOAD_NAME := "McpEditorPlugin"
const _AUTOLOAD_PATH := "res://addons/forgekit_core/mcp/runtime_bridge/mcp_bridge.gd"


var _lifecycle: Object = null


func _enter_tree() -> void:
	add_autoload_singleton(_AUTOLOAD_NAME, _AUTOLOAD_PATH)
	_lifecycle = _LIFECYCLE_SCRIPT.new()
	_lifecycle.dispatcher_factory = func() -> Object:
		return _DISPATCHER_SCRIPT.new()
	_lifecycle.visualizer_http_server_factory = func() -> Object:
		return _VISUALIZER_HTTP_SERVER_SCRIPT.new()
	_lifecycle.visualizer_tools_factory = func(http_server: Object) -> Object:
		return _VISUALIZER_TOOLS_SCRIPT.new(http_server)
	_lifecycle.asset_generator_tools_factory = func() -> Object:
		return _ASSET_GENERATOR_TOOLS_SCRIPT.new()
	_lifecycle.healing_tools_factory = func() -> Object:
		return _HEALING_TOOLS_SCRIPT.new()
	_lifecycle.enter_tree()


func _exit_tree() -> void:
	if _lifecycle != null:
		_lifecycle.exit_tree()
		_lifecycle = null
	remove_autoload_singleton(_AUTOLOAD_NAME)
