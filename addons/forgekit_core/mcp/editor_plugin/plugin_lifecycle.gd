@tool
extends RefCounted
## McpEditorPluginLifecycle — extracts the ForgeKit MCP editor plugin's
## `_enter_tree` / `_exit_tree` behaviour into a plain `RefCounted` so the
## production `EditorPlugin` script stays thin and the behaviour is
## testable headlessly.
##
## On `enter_tree()` the lifecycle:
##   1. Starts the WebSocket server (editor-channel transport).
##   2. Starts the visualizer HTTP server (port 6030-6039) if a factory
##      is wired.
##   3. Creates the JSON-RPC dispatcher if a factory is wired.
##   4. Registers the three Phase 5 tool adapters (visualizer, asset
##      generator, self-healing) on the dispatcher.
##
## On `exit_tree()` each collaborator's `stop()` is called in reverse
## order and the references are dropped so re-entering creates fresh
## instances.
##
## Every collaborator is constructed through an injected Callable factory
## so tests can feed in fakes without opening real sockets or touching
## the filesystem.


class_name McpEditorPluginLifecycle


const DEFAULT_WEBSOCKET_SERVER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/websocket_server.gd")
const DEFAULT_VISUALIZER_HTTP_SERVER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/visualizer/http_server.gd")
const DEFAULT_DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")
const DEFAULT_VISUALIZER_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/tools/visualizer_tools.gd")
const DEFAULT_ASSET_GENERATOR_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/tools/asset_generator_tools.gd")
const DEFAULT_HEALING_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/healing/healing_tools.gd")


# Factory returning an Object exposing `start(config) -> Dictionary` and
# `stop()`. Defaulted to build a real McpWebSocketServer; tests override
# this with a Callable returning a FakeWebSocketServer.
var server_factory: Callable = func() -> Object:
	return DEFAULT_WEBSOCKET_SERVER_SCRIPT.new()

# Factory for the JSON-RPC dispatcher. Optional — when null, no dispatcher
# is created and the three Phase 5 adapters skip registration. Real plugin
# wiring injects a dispatcher paired with the WebSocket server.
var dispatcher_factory: Callable = Callable()

# Factory for the visualizer HTTP server. Optional — when null, the
# visualizer view is not served. Real plugin wiring injects the
# McpVisualizerHttpServer from the visualizer/ directory.
var visualizer_http_server_factory: Callable = Callable()

# Factories for the three Phase 5 tool adapters. Each takes no arguments
# except `visualizer_tools_factory` which receives the HTTP server so
# `visualizer.start` / `stop` can drive it. Left empty in the default
# template so older tests that only wired `server_factory` still pass.
var visualizer_tools_factory: Callable = Callable()
var asset_generator_tools_factory: Callable = Callable()
var healing_tools_factory: Callable = Callable()

# Optional configuration Resource forwarded to `server.start(config)`.
# Null means the server falls back to its embedded defaults (127.0.0.1,
# ports 6010-6019).
var config: Object = null

# Internal references to the live instances. All null until `enter_tree()`.
var _server: Object = null
var _http_server: Object = null
var _dispatcher: Object = null
var _visualizer_tools: Object = null
var _asset_generator_tools: Object = null
var _healing_tools: Object = null


## Start the WebSocket server and, if the corresponding factories are
## wired, the visualizer HTTP server and the three Phase 5 tool adapters.
func enter_tree() -> void:
	if _server != null:
		return
	_server = server_factory.call()
	if _server != null:
		_server.start(config)

	if visualizer_http_server_factory.is_valid():
		_http_server = visualizer_http_server_factory.call()
		if _http_server != null:
			_http_server.start()

	if dispatcher_factory.is_valid():
		_dispatcher = dispatcher_factory.call()

	if _dispatcher != null:
		if visualizer_tools_factory.is_valid():
			_visualizer_tools = visualizer_tools_factory.call(_http_server)
			if _visualizer_tools != null:
				_visualizer_tools.register_on(_dispatcher)
		if asset_generator_tools_factory.is_valid():
			_asset_generator_tools = asset_generator_tools_factory.call()
			if _asset_generator_tools != null:
				_asset_generator_tools.register_on(_dispatcher)
		if healing_tools_factory.is_valid():
			_healing_tools = healing_tools_factory.call()
			if _healing_tools != null:
				_healing_tools.register_on(_dispatcher)


## Stop every collaborator started by `enter_tree()`. No-op when the
## lifecycle is not currently inside `enter_tree`.
func exit_tree() -> void:
	_visualizer_tools = null
	_asset_generator_tools = null
	_healing_tools = null
	_dispatcher = null

	if _http_server != null:
		_http_server.stop()
		_http_server = null

	if _server == null:
		return
	_server.stop()
	_server = null


## Expose the live server instance for diagnostics. Returns `null` when
## the lifecycle is not inside `enter_tree`.
func get_server() -> Object:
	return _server


## Expose the live visualizer HTTP server for diagnostics.
func get_visualizer_http_server() -> Object:
	return _http_server


## Expose the live dispatcher for diagnostics. Callers must not mutate it.
func get_dispatcher() -> Object:
	return _dispatcher
