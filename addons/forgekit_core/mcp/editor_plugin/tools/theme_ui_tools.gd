extends RefCounted
## McpThemeUiTools — JSON-RPC handler adapter for the six editor-channel
## Theme and UI MCP tools.
##
##   theme.create(path)                                                          (UndoRedo)
##   theme.set_default_font(path, font_path, size)                               (UndoRedo)
##   theme.set_color(path, class_name, color_name, value)                        (UndoRedo)
##   theme.set_stylebox(path, class_name, stylebox_name, stylebox_resource_path) (UndoRedo)
##   ui.build_control_tree(scene_path, spec)                                     (UndoRedo)
##   ui.apply_layout_preset(node_path, preset)                                   (UndoRedo)
##
## All mutations flow through `McpUndoRedoWrapper` inside the backend so
## a single Ctrl+Z undoes the AI-driven change. Color values for
## `theme.set_color` are forwarded verbatim — the backend resolves strings
## like `"#ff0000"` through Smart_Type_Parser (closed-grammar literal
## reader, no eval).


class_name McpThemeUiTools


var _backend: Object = null


func _init(backend: Object = null) -> void:
	_backend = backend


func set_backend(backend: Object) -> void:
	_backend = backend


# ---------------------------------------------------------------------------
# MCP tool handlers.
# ---------------------------------------------------------------------------

func create(params: Variant) -> Variant:
	var path: String = _get_string_param(params, "path", 0, "")
	return _backend.create_theme(path)


func set_default_font(params: Variant) -> Variant:
	var path: String = _get_string_param(params, "path", 0, "")
	var font_path: String = _get_string_param(params, "font_path", 1, "")
	var size: int = _get_int_param(params, "size", 2, 16)
	return _backend.set_default_font(path, font_path, size)


func set_color(params: Variant) -> Variant:
	var path: String = _get_string_param(params, "path", 0, "")
	var class_name_: String = _get_string_param(params, "class_name", 1, "")
	var color_name: String = _get_string_param(params, "color_name", 2, "")
	var value: Variant = _get_variant_param(params, "value", 3, null)
	return _backend.set_color(path, class_name_, color_name, value)


func set_stylebox(params: Variant) -> Variant:
	var path: String = _get_string_param(params, "path", 0, "")
	var class_name_: String = _get_string_param(params, "class_name", 1, "")
	var stylebox_name: String = _get_string_param(params, "stylebox_name", 2, "")
	var stylebox_resource_path: String = _get_string_param(params, "stylebox_resource_path", 3, "")
	return _backend.set_stylebox(path, class_name_, stylebox_name, stylebox_resource_path)


func build_control_tree(params: Variant) -> Variant:
	var scene_path: String = _get_string_param(params, "scene_path", 0, "")
	var spec: Dictionary = _get_dict_param(params, "spec", 1, {})
	return _backend.build_control_tree(scene_path, spec)


func apply_layout_preset(params: Variant) -> Variant:
	var node_path: String = _get_string_param(params, "node_path", 0, "")
	var preset: String = _get_string_param(params, "preset", 1, "")
	return _backend.apply_layout_preset(node_path, preset)


## Bulk-register all six editor-channel Theme/UI MCP methods on the
## supplied dispatcher. Returns `self` so the caller can chain.
func register_on(dispatcher: Object) -> Object:
	dispatcher.register_handler("theme.create", Callable(self, "create"))
	dispatcher.register_handler("theme.set_default_font", Callable(self, "set_default_font"))
	dispatcher.register_handler("theme.set_color", Callable(self, "set_color"))
	dispatcher.register_handler("theme.set_stylebox", Callable(self, "set_stylebox"))
	dispatcher.register_handler("ui.build_control_tree", Callable(self, "build_control_tree"))
	dispatcher.register_handler("ui.apply_layout_preset", Callable(self, "apply_layout_preset"))
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
