@tool
extends RefCounted
## McpEditorPluginLifecycle — extracts the ForgeKit MCP editor plugin's
## `_enter_tree` / `_exit_tree` behaviour into a plain `RefCounted` so the
## production `EditorPlugin` script stays thin and the behaviour is
## testable headlessly.
##
## On `enter_tree()` the lifecycle instantiates a WebSocket server through
## the injected `server_factory` Callable and calls `start(config)` on it.
## On `exit_tree()` it calls `stop()` on the same instance and releases
## the reference so re-entering creates a fresh server.
##
## The `server_factory` is injected so tests can feed in a fake. In the
## production plugin it defaults to a factory that builds a fresh
## `McpWebSocketServer` from the sibling script in this directory.


class_name McpEditorPluginLifecycle


const DEFAULT_WEBSOCKET_SERVER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/websocket_server.gd")


# Factory returning an Object exposing `start(config) -> Dictionary` and
# `stop()`. Defaulted to build a real McpWebSocketServer; tests override
# this with a Callable returning a FakeWebSocketServer.
var server_factory: Callable = func() -> Object:
	return DEFAULT_WEBSOCKET_SERVER_SCRIPT.new()

# Optional configuration Resource forwarded to `server.start(config)`.
# Null means the server falls back to its embedded defaults (127.0.0.1,
# ports 6010-6019).
var config: Object = null

# Internal reference to the live server instance. Null means the
# lifecycle is not currently inside `enter_tree`.
var _server: Object = null


## Start the WebSocket server. Must be called from the plugin's
## `_enter_tree`. Safe to call multiple times — a second call is a no-op
## until a matching `exit_tree()` releases the previous server.
func enter_tree() -> void:
	if _server != null:
		return
	_server = server_factory.call()
	if _server == null:
		return
	_server.start(config)


## Stop the WebSocket server started by `enter_tree()`. No-op when no
## server is currently held.
func exit_tree() -> void:
	if _server == null:
		return
	_server.stop()
	_server = null


## Expose the live server instance for diagnostics. Returns `null` when
## the lifecycle is not inside `enter_tree`.
func get_server() -> Object:
	return _server
