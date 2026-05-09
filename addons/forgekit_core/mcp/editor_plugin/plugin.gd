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

# Phase 6A adapter scripts. Each adapter is instantiated with a null
# backend — the production editor backend lands in a follow-up wiring
# pass that plumbs live `EditorInterface` / `EditorUndoRedoManager` /
# `ProjectSettingsAtomicWriter` collaborators into each adapter.
const _ANIMATION_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/tools/animation_tools.gd")
const _TILEMAP_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/tools/tilemap_tools.gd")
const _THEME_UI_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/tools/theme_ui_tools.gd")
const _SHADER_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/tools/shader_tools.gd")
const _PHYSICS_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/tools/physics_tools.gd")
const _SCENE3D_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/tools/scene3d_tools.gd")
const _PARTICLE_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/tools/particle_tools.gd")
const _NAVIGATION_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/tools/navigation_tools.gd")
const _AUDIO_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/tools/audio_tools.gd")
const _ANIMATION_TREE_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/tools/animation_tree_tools.gd")
const _STATE_MACHINE_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/tools/state_machine_tools.gd")
const _BLEND_TREE_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/tools/blend_tree_tools.gd")

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
	_lifecycle.animation_tools_factory = func() -> Object:
		return _ANIMATION_TOOLS_SCRIPT.new()
	_lifecycle.tilemap_tools_factory = func() -> Object:
		return _TILEMAP_TOOLS_SCRIPT.new()
	_lifecycle.theme_ui_tools_factory = func() -> Object:
		return _THEME_UI_TOOLS_SCRIPT.new()
	_lifecycle.shader_tools_factory = func() -> Object:
		return _SHADER_TOOLS_SCRIPT.new()
	_lifecycle.physics_tools_factory = func() -> Object:
		return _PHYSICS_TOOLS_SCRIPT.new()
	_lifecycle.scene3d_tools_factory = func() -> Object:
		return _SCENE3D_TOOLS_SCRIPT.new()
	_lifecycle.particle_tools_factory = func() -> Object:
		return _PARTICLE_TOOLS_SCRIPT.new()
	_lifecycle.navigation_tools_factory = func() -> Object:
		return _NAVIGATION_TOOLS_SCRIPT.new()
	_lifecycle.audio_tools_factory = func() -> Object:
		return _AUDIO_TOOLS_SCRIPT.new()
	_lifecycle.animation_tree_tools_factory = func() -> Object:
		return _ANIMATION_TREE_TOOLS_SCRIPT.new()
	_lifecycle.state_machine_tools_factory = func() -> Object:
		return _STATE_MACHINE_TOOLS_SCRIPT.new()
	_lifecycle.blend_tree_tools_factory = func() -> Object:
		return _BLEND_TREE_TOOLS_SCRIPT.new()
	_lifecycle.enter_tree()


func _exit_tree() -> void:
	if _lifecycle != null:
		_lifecycle.exit_tree()
		_lifecycle = null
	remove_autoload_singleton(_AUTOLOAD_NAME)
