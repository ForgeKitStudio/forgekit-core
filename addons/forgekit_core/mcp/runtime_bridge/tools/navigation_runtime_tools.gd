extends RefCounted
## McpNavigationRuntimeTools — JSON-RPC handler adapter for the two
## runtime-channel Navigation MCP tools on top of a duck-typed
## NavigationRuntimeBackend.
##
##   navigation.find_path(from, to, optimize?)  → {path_points, cost}
##   navigation.debug_draw(enabled)             → {enabled}
##
## These tools require a running game launched with `--mcp-bridge` because
## they query `NavigationServer3D`/`NavigationServer2D` against the active
## world. `optimize` defaults to `true` so calls without the parameter
## match the production behavior of `NavigationServer.map_get_path`.


class_name McpNavigationRuntimeTools


var _backend: Object = null


func _init(backend: Object = null) -> void:
	_backend = backend


func set_backend(backend: Object) -> void:
	_backend = backend


# ---------------------------------------------------------------------------
# MCP tool handlers.
# ---------------------------------------------------------------------------

func find_path(params: Variant) -> Variant:
	var from: Variant = _get_variant_param(params, "from", 0, [0, 0, 0])
	var to: Variant = _get_variant_param(params, "to", 1, [0, 0, 0])
	var optimize: bool = _get_bool_param(params, "optimize", 2, true)
	return _backend.find_path(from, to, optimize)


func debug_draw(params: Variant) -> Variant:
	var enabled: bool = _get_bool_param(params, "enabled", 0, false)
	return _backend.debug_draw(enabled)


## Bulk-register both runtime-channel Navigation MCP methods on the
## supplied dispatcher. Returns `self` so the caller can chain.
func register_on(dispatcher: Object) -> Object:
	dispatcher.register_handler("navigation.find_path", Callable(self, "find_path"))
	dispatcher.register_handler("navigation.debug_draw", Callable(self, "debug_draw"))
	return self


# ---------------------------------------------------------------------------
# Internals.
# ---------------------------------------------------------------------------

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


static func _get_variant_param(params: Variant, key: String, index: int, default_value: Variant) -> Variant:
	if params is Dictionary:
		var dict: Dictionary = params as Dictionary
		if dict.has(key):
			return dict[key]
	elif params is Array:
		var arr: Array = params as Array
		if index >= 0 and index < arr.size():
			return arr[index]
	return default_value
