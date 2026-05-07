@tool
extends EditorPlugin
## MCP editor plugin entrypoint. Registers the McpEditorPlugin autoload
## while active so the runtime bridge singleton is available to MCP tooling
## and starts / stops the editor-channel WebSocket server via a delegated
## `McpEditorPluginLifecycle` helper.


const _LIFECYCLE_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/plugin_lifecycle.gd")

const _AUTOLOAD_NAME := "McpEditorPlugin"
const _AUTOLOAD_PATH := "res://addons/forgekit_core/mcp/runtime_bridge/mcp_bridge.gd"


var _lifecycle: Object = null


func _enter_tree() -> void:
	add_autoload_singleton(_AUTOLOAD_NAME, _AUTOLOAD_PATH)
	_lifecycle = _LIFECYCLE_SCRIPT.new()
	_lifecycle.enter_tree()


func _exit_tree() -> void:
	if _lifecycle != null:
		_lifecycle.exit_tree()
		_lifecycle = null
	remove_autoload_singleton(_AUTOLOAD_NAME)
