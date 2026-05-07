extends GutTest
## Unit tests for the MCP editor plugin lifecycle helper.
##
## The plugin (`plugin.gd`) extends `EditorPlugin`, which can only be
## instantiated inside the live editor. The lifecycle logic — starting the
## WebSocket server on `_enter_tree` and stopping it on `_exit_tree` — is
## therefore delegated to a helper class that is a plain `RefCounted`:
## `McpEditorPluginLifecycle`. The editor plugin's `_enter_tree` /
## `_exit_tree` forward straight to the helper's `enter_tree()` /
## `exit_tree()` so the production plugin stays thin and the behaviour is
## testable headlessly.
##
## The WebSocket server is obtained through an injected factory Callable so
## the tests can drive the lifecycle against an in-memory fake that only
## records calls — no real TCP binding happens here.


const LIFECYCLE_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/plugin_lifecycle.gd")


class FakeWebSocketServer:
	extends RefCounted

	var start_calls: int = 0
	var stop_calls: int = 0
	var last_config: Object = null
	var next_result: Dictionary = {"ok": true, "port": 6010}

	func start(config: Object) -> Dictionary:
		start_calls += 1
		last_config = config
		return next_result

	func stop() -> void:
		stop_calls += 1


func _make_lifecycle(server: FakeWebSocketServer) -> Object:
	var lifecycle: Object = LIFECYCLE_SCRIPT.new()
	lifecycle.server_factory = func() -> Object:
		return server
	return lifecycle


# ---------------------------------------------------------------------------
# enter_tree: starts the WebSocket server
# ---------------------------------------------------------------------------

func test_enter_tree_starts_websocket_server() -> void:
	var server: FakeWebSocketServer = FakeWebSocketServer.new()
	var lifecycle: Object = _make_lifecycle(server)

	lifecycle.enter_tree()

	assert_eq(server.start_calls, 1, "enter_tree must call WebSocket server.start exactly once")


func test_enter_tree_does_not_stop_the_server() -> void:
	var server: FakeWebSocketServer = FakeWebSocketServer.new()
	var lifecycle: Object = _make_lifecycle(server)

	lifecycle.enter_tree()

	assert_eq(server.stop_calls, 0, "enter_tree must not call server.stop")


# ---------------------------------------------------------------------------
# exit_tree: stops the WebSocket server started by enter_tree
# ---------------------------------------------------------------------------

func test_exit_tree_stops_websocket_server_started_by_enter_tree() -> void:
	var server: FakeWebSocketServer = FakeWebSocketServer.new()
	var lifecycle: Object = _make_lifecycle(server)

	lifecycle.enter_tree()
	lifecycle.exit_tree()

	assert_eq(server.stop_calls, 1, "exit_tree must call WebSocket server.stop exactly once")


func test_exit_tree_without_enter_is_a_no_op_for_server_stop() -> void:
	var server: FakeWebSocketServer = FakeWebSocketServer.new()
	var lifecycle: Object = _make_lifecycle(server)

	lifecycle.exit_tree()

	assert_eq(
		server.stop_calls,
		0,
		"exit_tree must not call server.stop when enter_tree has not run"
	)


# ---------------------------------------------------------------------------
# Plugin source integration: plugin.gd must delegate to the lifecycle helper.
# ---------------------------------------------------------------------------

const PLUGIN_PATH: String = "res://addons/forgekit_core/mcp/editor_plugin/plugin.gd"


func _load_plugin_source() -> String:
	var file: FileAccess = FileAccess.open(PLUGIN_PATH, FileAccess.READ)
	assert_not_null(file, "Plugin script must exist at %s" % PLUGIN_PATH)
	var text: String = file.get_as_text()
	file.close()
	return text


func test_plugin_source_references_lifecycle_helper() -> void:
	var source: String = _load_plugin_source()
	assert_true(
		source.find("plugin_lifecycle.gd") != -1,
		"plugin.gd must reference plugin_lifecycle.gd to delegate lifecycle work"
	)


func test_plugin_source_calls_enter_tree_and_exit_tree_on_lifecycle() -> void:
	var source: String = _load_plugin_source()
	assert_true(
		source.find(".enter_tree(") != -1,
		"plugin.gd must call lifecycle.enter_tree() from _enter_tree"
	)
	assert_true(
		source.find(".exit_tree(") != -1,
		"plugin.gd must call lifecycle.exit_tree() from _exit_tree"
	)
