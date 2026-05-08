extends RefCounted
## McpRuntimeDiagnosticTools — JSON-RPC handler adapter for the
## runtime-channel diagnostic MCP tools.
##
## Exposes four handlers that translate JSON-RPC calls into calls on an
## injected RuntimeDiagnosticBackend. The backend is duck-typed so the
## adapter can run headlessly against a fake in unit tests while the
## production backend queries the live McpBridge and the running game.
##
##   runtime.is_connected          → {connected, bridge_version}
##   runtime.handshake(client_id, auth_token)
##                                 → {session_id, api_version, server,
##                                    core_detected, server.latest_version}
##   runtime.heartbeat             → {pong, ts}
##   runtime.shutdown(graceful?)   → {shutting_down}
##
## The `handshake` response is specified by Requirements 33.2, 38.2, and
## 46.4: `api_version` MUST be formatted as the git tag `vX.Y.Z` that
## corresponds to the installed ForgeKit Core version, so clients can
## resolve it back to a commit in `ForgeKitStudio/forgekit-core`.
##
## The adapter never opens a port or touches the live SceneTree; all
## side-effects live in the backend. The runtime bridge wires the
## production backend in `McpBridge.activate()` when the game was
## launched with the `--mcp-bridge` CLI flag.


class_name McpRuntimeDiagnosticTools


# Injected RuntimeDiagnosticBackend (duck-typed).
var _backend: Object = null


func _init(backend: Object = null) -> void:
	_backend = backend


func set_backend(backend: Object) -> void:
	_backend = backend


# ---------------------------------------------------------------------------
# MCP tool handlers.
#
# `bridge_is_connected` rather than `is_connected` to avoid shadowing
# `Object.is_connected(signal, callable)` which would otherwise trigger
# the "method overrides a native method" parse warning under
# -Werror. The JSON-RPC method name exposed to clients is still
# `runtime.is_connected`.
# ---------------------------------------------------------------------------

func bridge_is_connected(_params: Variant) -> Variant:
	return _backend.bridge_is_connected()


func handshake(params: Variant) -> Variant:
	var client_id: String = _get_string_param(params, "client_id", 0, "")
	var auth_token: String = _get_string_param(params, "auth_token", 1, "")
	return _backend.handshake(client_id, auth_token)


func heartbeat(_params: Variant) -> Variant:
	return _backend.heartbeat()


func shutdown(params: Variant) -> Variant:
	# `graceful?` defaults to true so callers without arguments get the
	# safe behaviour (shut down after the current frame completes).
	var graceful: bool = _get_bool_param(params, "graceful", 0, true)
	return _backend.shutdown(graceful)


## Bulk-register all four runtime diagnostic MCP methods on the supplied
## dispatcher. Returns `self` so the caller can chain.
func register_on(dispatcher: Object) -> Object:
	dispatcher.register_handler("runtime.is_connected", Callable(self, "bridge_is_connected"))
	dispatcher.register_handler("runtime.handshake", Callable(self, "handshake"))
	dispatcher.register_handler("runtime.heartbeat", Callable(self, "heartbeat"))
	dispatcher.register_handler("runtime.shutdown", Callable(self, "shutdown"))
	return self


# ---------------------------------------------------------------------------
# Internals. Accept both by-name (Dictionary) and by-position (Array)
# JSON-RPC params conventions.
# ---------------------------------------------------------------------------

static func _get_string_param(params: Variant, key: String, index: int, default_value: String) -> String:
	if params is Dictionary:
		var dict: Dictionary = params as Dictionary
		if dict.has(key):
			var v: Variant = dict[key]
			if v is String:
				return String(v)
	elif params is Array:
		var arr: Array = params as Array
		if index >= 0 and index < arr.size():
			var v: Variant = arr[index]
			if v is String:
				return String(v)
	return default_value


static func _get_bool_param(params: Variant, key: String, index: int, default_value: bool) -> bool:
	if params is Dictionary:
		var dict: Dictionary = params as Dictionary
		if dict.has(key):
			var v: Variant = dict[key]
			if typeof(v) == TYPE_BOOL:
				return bool(v)
	elif params is Array:
		var arr: Array = params as Array
		if index >= 0 and index < arr.size():
			var v: Variant = arr[index]
			if typeof(v) == TYPE_BOOL:
				return bool(v)
	return default_value
