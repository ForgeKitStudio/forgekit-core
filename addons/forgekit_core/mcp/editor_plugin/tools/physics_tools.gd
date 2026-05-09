extends RefCounted
## McpPhysicsTools — JSON-RPC handler adapter for the three editor-channel
## Physics MCP tools on top of a duck-typed PhysicsBackend.
##
##   physics.set_gravity(vector)              — atomic project.godot write
##   physics.get_collision_layer_names()      → {layers}
##   physics.configure_layer(index, name, mask?)  — atomic project.godot write
##
## `set_gravity` and `configure_layer` are routed through
## `McpProjectSettingsAtomicWriter` inside the backend so edits to
## `project.godot` follow the read → parse → modify → write-temp → fsync →
## rename sequence. The three runtime-channel physics tools
## (`physics.raycast`, `physics.shape_cast`, `physics.query_point`) live
## on the runtime dispatcher under `runtime_bridge/tools/physics_runtime_tools.gd`.


class_name McpPhysicsTools


var _backend: Object = null


func _init(backend: Object = null) -> void:
	_backend = backend


func set_backend(backend: Object) -> void:
	_backend = backend


# ---------------------------------------------------------------------------
# MCP tool handlers.
# ---------------------------------------------------------------------------

func set_gravity(params: Variant) -> Variant:
	var vector: Variant = _get_variant_param(params, "vector", 0, [0, -9.8, 0])
	return _backend.set_gravity(vector)


func get_collision_layer_names(_params: Variant) -> Variant:
	return _backend.get_collision_layer_names()


func configure_layer(params: Variant) -> Variant:
	var index: int = _get_int_param(params, "index", 0, 1)
	var name: String = _get_string_param(params, "name", 1, "")
	var mask: int = _get_int_param(params, "mask", 2, 0)
	return _backend.configure_layer(index, name, mask)


## Bulk-register all three editor-channel Physics MCP methods on the
## supplied dispatcher. Returns `self` so the caller can chain.
func register_on(dispatcher: Object) -> Object:
	dispatcher.register_handler("physics.set_gravity", Callable(self, "set_gravity"))
	dispatcher.register_handler("physics.get_collision_layer_names", Callable(self, "get_collision_layer_names"))
	dispatcher.register_handler("physics.configure_layer", Callable(self, "configure_layer"))
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


static func _get_int_param(params: Variant, key: String, index: int, default_value: int) -> int:
	if params is Dictionary:
		var dict: Dictionary = params as Dictionary
		if dict.has(key):
			var v: Variant = dict[key]
			if typeof(v) == TYPE_INT:
				return int(v)
			if typeof(v) == TYPE_FLOAT:
				return int(v)
	elif params is Array:
		var arr: Array = params as Array
		if index >= 0 and index < arr.size():
			var v: Variant = arr[index]
			if typeof(v) == TYPE_INT:
				return int(v)
			if typeof(v) == TYPE_FLOAT:
				return int(v)
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
