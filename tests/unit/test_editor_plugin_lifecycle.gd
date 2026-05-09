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

# ---------------------------------------------------------------------------
# Phase 5 additions: visualizer HTTP server + tool adapters for visualizer /
# asset generator / healing must register on the dispatcher during
# enter_tree and be torn down during exit_tree.
# ---------------------------------------------------------------------------


class FakeDispatcher:
	extends RefCounted

	var registered: Array[String] = []

	func register_handler(method: String, _callable: Callable) -> void:
		registered.append(method)

	func unregister_handler(method: String) -> void:
		registered.erase(method)


class FakeVisualizerHttpServer:
	extends RefCounted

	var start_calls: int = 0
	var stop_calls: int = 0
	var set_provider_calls: int = 0
	var set_module_provider_calls: int = 0
	var set_event_bus_provider_calls: int = 0

	func start() -> Dictionary:
		start_calls += 1
		return {"ok": true, "port": 6030, "bind_address": "127.0.0.1"}

	func stop() -> void:
		stop_calls += 1

	func is_listening() -> bool:
		return start_calls > stop_calls

	func get_port() -> int:
		return 6030 if is_listening() else -1

	func set_scene_provider(_provider: Callable) -> void:
		set_provider_calls += 1

	func set_module_provider(_provider: Callable) -> void:
		set_module_provider_calls += 1

	func set_event_bus_provider(_provider: Callable) -> void:
		set_event_bus_provider_calls += 1


class FakeToolAdapter:
	extends RefCounted

	var register_calls: int = 0
	var last_dispatcher: Object = null
	var methods: Array[String] = []

	func _init(methods_: Array[String] = []) -> void:
		methods = methods_

	func register_on(dispatcher: Object) -> Object:
		register_calls += 1
		last_dispatcher = dispatcher
		for m in methods:
			dispatcher.register_handler(m, Callable(self, "_noop"))
		return self

	func _noop(_params: Variant) -> Variant:
		return {}


func _make_full_lifecycle() -> Dictionary:
	var ws_server: FakeWebSocketServer = FakeWebSocketServer.new()
	var http_server: FakeVisualizerHttpServer = FakeVisualizerHttpServer.new()
	var dispatcher: FakeDispatcher = FakeDispatcher.new()
	var visualizer_adapter: FakeToolAdapter = FakeToolAdapter.new([
		"visualizer.start", "visualizer.stop",
		"visualizer.render_scene_tree", "visualizer.render_module_graph",
		"visualizer.render_event_bus",
	] as Array[String])
	var assetgen_adapter: FakeToolAdapter = FakeToolAdapter.new([
		"assetgen.sprite_from_svg", "assetgen.atlas_pack",
		"assetgen.noise_texture", "assetgen.icon_set",
	] as Array[String])
	var healing_adapter: FakeToolAdapter = FakeToolAdapter.new([
		"healing.suggest_action", "healing.inspect_failure",
		"healing.get_retry_count", "healing.reset_retry_count",
		"healing.apply_and_retest",
	] as Array[String])

	var lifecycle: Object = LIFECYCLE_SCRIPT.new()
	lifecycle.server_factory = func() -> Object:
		return ws_server
	lifecycle.dispatcher_factory = func() -> Object:
		return dispatcher
	lifecycle.visualizer_http_server_factory = func() -> Object:
		return http_server
	lifecycle.visualizer_tools_factory = func(hs: Object) -> Object:
		var _unused: Object = hs
		return visualizer_adapter
	lifecycle.asset_generator_tools_factory = func() -> Object:
		return assetgen_adapter
	lifecycle.healing_tools_factory = func() -> Object:
		return healing_adapter

	return {
		"lifecycle": lifecycle,
		"ws_server": ws_server,
		"http_server": http_server,
		"dispatcher": dispatcher,
		"visualizer_adapter": visualizer_adapter,
		"assetgen_adapter": assetgen_adapter,
		"healing_adapter": healing_adapter,
	}


func test_enter_tree_starts_visualizer_http_server_when_factory_present() -> void:
	var env: Dictionary = _make_full_lifecycle()
	env["lifecycle"].enter_tree()
	var http_server: FakeVisualizerHttpServer = env["http_server"]
	assert_eq(http_server.start_calls, 1, "enter_tree must start the visualizer HTTP server exactly once")


func test_exit_tree_stops_visualizer_http_server() -> void:
	var env: Dictionary = _make_full_lifecycle()
	env["lifecycle"].enter_tree()
	env["lifecycle"].exit_tree()
	var http_server: FakeVisualizerHttpServer = env["http_server"]
	assert_eq(http_server.stop_calls, 1, "exit_tree must stop the visualizer HTTP server exactly once")


func test_enter_tree_registers_visualizer_tools_on_dispatcher() -> void:
	var env: Dictionary = _make_full_lifecycle()
	env["lifecycle"].enter_tree()
	var adapter: FakeToolAdapter = env["visualizer_adapter"]
	assert_eq(adapter.register_calls, 1, "visualizer tools must register exactly once")
	var dispatcher: FakeDispatcher = env["dispatcher"]
	assert_true(dispatcher.registered.has("visualizer.start"), "visualizer.start must be registered")
	assert_true(dispatcher.registered.has("visualizer.stop"), "visualizer.stop must be registered")
	assert_true(dispatcher.registered.has("visualizer.render_scene_tree"), "visualizer.render_scene_tree must be registered")
	assert_true(dispatcher.registered.has("visualizer.render_module_graph"), "visualizer.render_module_graph must be registered")
	assert_true(dispatcher.registered.has("visualizer.render_event_bus"), "visualizer.render_event_bus must be registered")


func test_enter_tree_registers_asset_generator_tools_on_dispatcher() -> void:
	var env: Dictionary = _make_full_lifecycle()
	env["lifecycle"].enter_tree()
	var adapter: FakeToolAdapter = env["assetgen_adapter"]
	assert_eq(adapter.register_calls, 1, "assetgen tools must register exactly once")
	var dispatcher: FakeDispatcher = env["dispatcher"]
	assert_true(dispatcher.registered.has("assetgen.sprite_from_svg"), "assetgen.sprite_from_svg must be registered")
	assert_true(dispatcher.registered.has("assetgen.atlas_pack"), "assetgen.atlas_pack must be registered")
	assert_true(dispatcher.registered.has("assetgen.noise_texture"), "assetgen.noise_texture must be registered")
	assert_true(dispatcher.registered.has("assetgen.icon_set"), "assetgen.icon_set must be registered")


func test_enter_tree_registers_healing_tools_on_dispatcher() -> void:
	var env: Dictionary = _make_full_lifecycle()
	env["lifecycle"].enter_tree()
	var adapter: FakeToolAdapter = env["healing_adapter"]
	assert_eq(adapter.register_calls, 1, "healing tools must register exactly once")
	var dispatcher: FakeDispatcher = env["dispatcher"]
	assert_true(dispatcher.registered.has("healing.suggest_action"), "healing.suggest_action must be registered")
	assert_true(dispatcher.registered.has("healing.inspect_failure"), "healing.inspect_failure must be registered")
	assert_true(dispatcher.registered.has("healing.get_retry_count"), "healing.get_retry_count must be registered")
	assert_true(dispatcher.registered.has("healing.reset_retry_count"), "healing.reset_retry_count must be registered")
	assert_true(dispatcher.registered.has("healing.apply_and_retest"), "healing.apply_and_retest must be registered")


func test_enter_tree_without_phase5_factories_is_still_a_valid_lifecycle() -> void:
	# Backwards compatibility: a lifecycle that only sets server_factory
	# must continue to work without the new Phase 5 factories.
	var server: FakeWebSocketServer = FakeWebSocketServer.new()
	var lifecycle: Object = _make_lifecycle(server)
	lifecycle.enter_tree()
	lifecycle.exit_tree()
	assert_eq(server.start_calls, 1, "lifecycle without phase 5 factories must still start the websocket server")
	assert_eq(server.stop_calls, 1, "lifecycle without phase 5 factories must still stop the websocket server")
