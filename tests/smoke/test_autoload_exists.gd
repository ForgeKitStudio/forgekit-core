extends GutTest
## Smoke test that locks in the two autoloads required by ForgeKit Core:
## `GameEvents` (event bus) and `McpBridge` (MCP runtime bridge). The
## registration lives in `project.godot` under the `[autoload]` section; a
## missing entry would silently disable the entire engine-side integration.


const GAME_EVENTS_SCRIPT: String = "res://addons/forgekit_core/event_bus/game_events.gd"
const MCP_BRIDGE_SCRIPT: String = "res://addons/forgekit_core/mcp/runtime_bridge/mcp_bridge.gd"


## Returns the raw `autoload/<name>` setting value. Godot stores autoload
## entries as strings prefixed with `*` for scripts that should be loaded
## as singletons, so we normalize by stripping the leading `*` before
## comparing.
func _autoload_path(name: String) -> String:
	var key: String = "autoload/%s" % name
	var value: Variant = ProjectSettings.get_setting(key)
	if value == null:
		return ""
	var raw: String = str(value)
	if raw.begins_with("*"):
		return raw.substr(1)
	return raw


func test_game_events_autoload_is_registered() -> void:
	var path: String = _autoload_path("GameEvents")
	assert_true(
		path.length() > 0,
		"ProjectSettings must expose an autoload/GameEvents entry"
	)
	assert_eq(
		path,
		GAME_EVENTS_SCRIPT,
		"GameEvents autoload must point at addons/forgekit_core/event_bus/game_events.gd"
	)


func test_mcp_bridge_autoload_is_registered() -> void:
	var path: String = _autoload_path("McpBridge")
	assert_true(
		path.length() > 0,
		"ProjectSettings must expose an autoload/McpBridge entry"
	)
	assert_eq(
		path,
		MCP_BRIDGE_SCRIPT,
		"McpBridge autoload must point at addons/forgekit_core/mcp/runtime_bridge/mcp_bridge.gd"
	)


func test_game_events_singleton_is_reachable_at_runtime() -> void:
	var root: Node = Engine.get_main_loop().root
	assert_true(
		root.has_node("GameEvents"),
		"GameEvents autoload must be live at /root/GameEvents when the engine boots"
	)


func test_mcp_bridge_singleton_is_reachable_at_runtime() -> void:
	var root: Node = Engine.get_main_loop().root
	assert_true(
		root.has_node("McpBridge"),
		"McpBridge autoload must be live at /root/McpBridge when the engine boots"
	)
