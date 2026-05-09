extends RefCounted
## McpNavigationTools — JSON-RPC handler adapter for the four editor-channel
## Navigation MCP tools on top of a duck-typed NavigationBackend.
##
##   navigation.bake_mesh(nav_region_path, quality?)         → {success, mesh_path}
##   navigation.add_agent(scene_path, parent_path, params?)  (UndoRedo)
##   navigation.set_avoidance(agent_path, enabled, params?)  (UndoRedo)
##   navigation.configure_layers(layers)                     — atomic project.godot write
##
## `bake_mesh` can be long-running; the backend decides whether to block
## or dispatch the bake through a deferred callable. `configure_layers`
## routes through `McpProjectSettingsAtomicWriter` so layer names in
## `project.godot` are updated atomically.
##
## The two runtime-channel navigation tools (`navigation.find_path` and
## `navigation.debug_draw`) live on the runtime dispatcher under
## `runtime_bridge/tools/navigation_runtime_tools.gd`.


class_name McpNavigationTools


const DEFAULT_BAKE_QUALITY: String = "medium"


var _backend: Object = null


func _init(backend: Object = null) -> void:
	_backend = backend


func set_backend(backend: Object) -> void:
	_backend = backend


# ---------------------------------------------------------------------------
# MCP tool handlers.
# ---------------------------------------------------------------------------

func bake_mesh(params: Variant) -> Variant:
	var nav_region_path: String = _get_string_param(params, "nav_region_path", 0, "")
	var quality: String = _get_string_param(params, "quality", 1, DEFAULT_BAKE_QUALITY)
	return _backend.bake_mesh(nav_region_path, quality)


func add_agent(params: Variant) -> Variant:
	var scene_path: String = _get_string_param(params, "scene_path", 0, "")
	var parent_path: String = _get_string_param(params, "parent_path", 1, "")
	var p: Dictionary = _get_dict_param(params, "params", 2, {})
	return _backend.add_agent(scene_path, parent_path, p)


func set_avoidance(params: Variant) -> Variant:
	var agent_path: String = _get_string_param(params, "agent_path", 0, "")
	var enabled: bool = _get_bool_param(params, "enabled", 1, false)
	var p: Dictionary = _get_dict_param(params, "params", 2, {})
	return _backend.set_avoidance(agent_path, enabled, p)


func configure_layers(params: Variant) -> Variant:
	var layers: Variant = _get_variant_param(params, "layers", 0, [])
	return _backend.configure_layers(layers)


## Bulk-register all four editor-channel Navigation MCP methods on the
## supplied dispatcher. Returns `self` so the caller can chain.
func register_on(dispatcher: Object) -> Object:
	dispatcher.register_handler("navigation.bake_mesh", Callable(self, "bake_mesh"))
	dispatcher.register_handler("navigation.add_agent", Callable(self, "add_agent"))
	dispatcher.register_handler("navigation.set_avoidance", Callable(self, "set_avoidance"))
	dispatcher.register_handler("navigation.configure_layers", Callable(self, "configure_layers"))
	return self


# ---------------------------------------------------------------------------
# Internals.
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


static func _get_dict_param(params: Variant, key: String, index: int, default_value: Dictionary) -> Dictionary:
	if params is Dictionary:
		var dict: Dictionary = params as Dictionary
		if dict.has(key):
			var v: Variant = dict[key]
			if v is Dictionary:
				return v as Dictionary
	elif params is Array:
		var arr: Array = params as Array
		if index >= 0 and index < arr.size():
			var v: Variant = arr[index]
			if v is Dictionary:
				return v as Dictionary
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
