extends RefCounted
## McpPhysicsRuntimeTools — JSON-RPC handler adapter for the three
## runtime-channel Physics MCP tools on top of a duck-typed
## PhysicsRuntimeBackend.
##
##   physics.raycast(from, to, collision_mask?, exclude?)      → {hit, position, normal, collider_path}
##   physics.shape_cast(shape, from, motion, collision_mask?)  → {hits: [...]}
##   physics.query_point(position, collision_mask?)            → {collider_paths: [...]}
##
## These tools require a running game launched with `--mcp-bridge` because
## they query `PhysicsDirectSpaceState3D` / `PhysicsDirectSpaceState2D`
## against the active world. `collision_mask` defaults to `0xFFFFFFFF`
## (all 32 physics layers) — the caller can pass a narrower mask to filter
## the query against the layer config written by
## `physics.configure_layer`.


class_name McpPhysicsRuntimeTools


# All 32 physics layers enabled — matches Godot's default mask for
# PhysicsDirectSpaceState queries.
const ALL_LAYERS_MASK: int = 0xFFFFFFFF


var _backend: Object = null


func _init(backend: Object = null) -> void:
	_backend = backend


func set_backend(backend: Object) -> void:
	_backend = backend


# ---------------------------------------------------------------------------
# MCP tool handlers.
# ---------------------------------------------------------------------------

func raycast(params: Variant) -> Variant:
	var from: Variant = _get_variant_param(params, "from", 0, [0, 0, 0])
	var to: Variant = _get_variant_param(params, "to", 1, [0, 0, 0])
	var collision_mask: int = _get_int_param(params, "collision_mask", 2, ALL_LAYERS_MASK)
	var exclude: Variant = _get_variant_param(params, "exclude", 3, [])
	return _backend.raycast(from, to, collision_mask, exclude)


func shape_cast(params: Variant) -> Variant:
	var shape: Variant = _get_variant_param(params, "shape", 0, {})
	var from: Variant = _get_variant_param(params, "from", 1, [0, 0, 0])
	var motion: Variant = _get_variant_param(params, "motion", 2, [0, 0, 0])
	var collision_mask: int = _get_int_param(params, "collision_mask", 3, ALL_LAYERS_MASK)
	return _backend.shape_cast(shape, from, motion, collision_mask)


func query_point(params: Variant) -> Variant:
	var position: Variant = _get_variant_param(params, "position", 0, [0, 0, 0])
	var collision_mask: int = _get_int_param(params, "collision_mask", 1, ALL_LAYERS_MASK)
	return _backend.query_point(position, collision_mask)


## Bulk-register all three runtime Physics MCP methods on the supplied
## dispatcher. Returns `self` so the caller can chain.
func register_on(dispatcher: Object) -> Object:
	dispatcher.register_handler("physics.raycast", Callable(self, "raycast"))
	dispatcher.register_handler("physics.shape_cast", Callable(self, "shape_cast"))
	dispatcher.register_handler("physics.query_point", Callable(self, "query_point"))
	return self


# ---------------------------------------------------------------------------
# Internals.
# ---------------------------------------------------------------------------

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
