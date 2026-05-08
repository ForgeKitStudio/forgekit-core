extends RefCounted
## McpRuntimeInfoTools — JSON-RPC handler adapter for the runtime-channel
## info/introspection MCP tools.
##
## Exposes four handlers that translate JSON-RPC calls into calls on an
## injected RuntimeInfoBackend. The backend is duck-typed so the adapter
## can run headlessly against a fake in unit tests while the production
## backend queries live Engine / SceneTree / ProjectSettings state.
##
##   runtime.screenshot(target_path?)   → {path, size_bytes, width, height}
##   runtime.get_fps                    → {fps}
##   runtime.list_autoloads             → {autoloads: [{name, path}]}
##   runtime.get_autoload(name)         → {name, path, properties}
##
## `target_path` for `runtime.screenshot` defaults to the empty string; the
## backend is expected to interpret an empty path as "auto-generate a path
## under `user://screenshots/`" so clients can capture diagnostic frames
## without pre-allocating a filename.


class_name McpRuntimeInfoTools


# Injected RuntimeInfoBackend (duck-typed).
var _backend: Object = null


func _init(backend: Object = null) -> void:
	_backend = backend


func set_backend(backend: Object) -> void:
	_backend = backend


# ---------------------------------------------------------------------------
# MCP tool handlers.
# ---------------------------------------------------------------------------

func screenshot(params: Variant) -> Variant:
	var target_path: String = _get_string_param(params, "target_path", 0, "")
	return _backend.screenshot(target_path)


func get_fps(_params: Variant) -> Variant:
	return _backend.get_fps()


func list_autoloads(_params: Variant) -> Variant:
	return _backend.list_autoloads()


func get_autoload(params: Variant) -> Variant:
	var name: String = _get_string_param(params, "name", 0, "")
	return _backend.get_autoload(name)


## Bulk-register all four runtime info MCP methods on the supplied
## dispatcher. Returns `self` so the caller can chain.
func register_on(dispatcher: Object) -> Object:
	dispatcher.register_handler("runtime.screenshot", Callable(self, "screenshot"))
	dispatcher.register_handler("runtime.get_fps", Callable(self, "get_fps"))
	dispatcher.register_handler("runtime.list_autoloads", Callable(self, "list_autoloads"))
	dispatcher.register_handler("runtime.get_autoload", Callable(self, "get_autoload"))
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
