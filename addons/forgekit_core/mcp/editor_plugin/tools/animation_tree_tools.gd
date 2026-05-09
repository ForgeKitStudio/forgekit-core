extends RefCounted
## McpAnimationTreeTools — JSON-RPC handler adapter for the four
## editor-channel AnimationTree MCP tools on top of a duck-typed
## AnimationTreeBackend.
##
##   animation_tree.create(scene_path, parent_path, anim_player_path)   (UndoRedo)
##   animation_tree.set_parameter(tree_path, parameter_path, value)     (UndoRedo)
##   animation_tree.get_parameters(tree_path)                           → {parameters}
##   animation_tree.set_active(tree_path, active)                       (UndoRedo)
##
## `value` for `set_parameter` is forwarded verbatim so backends can
## route string values through Smart_Type_Parser when the parameter type
## expects Vector2/Vector3.


class_name McpAnimationTreeTools


var _backend: Object = null


func _init(backend: Object = null) -> void:
	_backend = backend


func set_backend(backend: Object) -> void:
	_backend = backend


# ---------------------------------------------------------------------------
# MCP tool handlers.
# ---------------------------------------------------------------------------

func create(params: Variant) -> Variant:
	var scene_path: String = _get_string_param(params, "scene_path", 0, "")
	var parent_path: String = _get_string_param(params, "parent_path", 1, "")
	var anim_player_path: String = _get_string_param(params, "anim_player_path", 2, "")
	return _backend.create_tree(scene_path, parent_path, anim_player_path)


func set_parameter(params: Variant) -> Variant:
	var tree_path: String = _get_string_param(params, "tree_path", 0, "")
	var parameter_path: String = _get_string_param(params, "parameter_path", 1, "")
	var value: Variant = _get_variant_param(params, "value", 2, null)
	return _backend.set_parameter(tree_path, parameter_path, value)


func get_parameters(params: Variant) -> Variant:
	var tree_path: String = _get_string_param(params, "tree_path", 0, "")
	return _backend.get_parameters(tree_path)


func set_active(params: Variant) -> Variant:
	var tree_path: String = _get_string_param(params, "tree_path", 0, "")
	var active: bool = _get_bool_param(params, "active", 1, false)
	return _backend.set_active(tree_path, active)


## Bulk-register all four editor-channel AnimationTree MCP methods on the
## supplied dispatcher. Returns `self` so the caller can chain.
func register_on(dispatcher: Object) -> Object:
	dispatcher.register_handler("animation_tree.create", Callable(self, "create"))
	dispatcher.register_handler("animation_tree.set_parameter", Callable(self, "set_parameter"))
	dispatcher.register_handler("animation_tree.get_parameters", Callable(self, "get_parameters"))
	dispatcher.register_handler("animation_tree.set_active", Callable(self, "set_active"))
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
