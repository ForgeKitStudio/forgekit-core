extends RefCounted
## McpShaderTools — JSON-RPC handler adapter for the six editor-channel
## Shader MCP tools.
##
##   shader.create(path, template?)                                 (UndoRedo)
##   shader.validate(source)                                        → {ok, errors}
##   shader.save_with_validation(path, source)                      (UndoRedo, validate-first)
##   shader.set_uniform(material_path, uniform, value)              (UndoRedo)
##   shader.list_uniforms(material_path)                            → {uniforms}
##   shader.convert_visual_to_text(visual_shader_path, target_path) (UndoRedo)
##
## `template` defaults to `canvas_item` when absent. Valid templates are
## `canvas_item`, `spatial`, `particles`. `shader.validate` compiles the
## source via the backend (production backend uses
## `Shader.new(); .code = source` on Shader) and returns `{ok, errors: [{line, col, msg}]}`.
## `shader.set_uniform` forwards `value` verbatim so the backend can route
## string values (e.g. `"Vector3(1,0,0)"`) through Smart_Type_Parser.


class_name McpShaderTools


const DEFAULT_TEMPLATE: String = "canvas_item"


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
	var template: String = _get_string_param(params, "template", 1, DEFAULT_TEMPLATE)
	return _backend.create_shader(path, template)


func validate(params: Variant) -> Variant:
	var source: String = _get_string_param(params, "source", 0, "")
	return _backend.validate_shader(source)


func save_with_validation(params: Variant) -> Variant:
	var path: String = _get_string_param(params, "path", 0, "")
	var source: String = _get_string_param(params, "source", 1, "")
	return _backend.save_with_validation(path, source)


func set_uniform(params: Variant) -> Variant:
	var material_path: String = _get_string_param(params, "material_path", 0, "")
	var uniform: String = _get_string_param(params, "uniform", 1, "")
	var value: Variant = _get_variant_param(params, "value", 2, null)
	return _backend.set_uniform(material_path, uniform, value)


func list_uniforms(params: Variant) -> Variant:
	var material_path: String = _get_string_param(params, "material_path", 0, "")
	return _backend.list_uniforms(material_path)


func convert_visual_to_text(params: Variant) -> Variant:
	var visual_shader_path: String = _get_string_param(params, "visual_shader_path", 0, "")
	var target_path: String = _get_string_param(params, "target_path", 1, "")
	return _backend.convert_visual_to_text(visual_shader_path, target_path)


## Bulk-register all six editor-channel Shader MCP methods on the supplied
## dispatcher. Returns `self` so the caller can chain.
func register_on(dispatcher: Object) -> Object:
	dispatcher.register_handler("shader.create", Callable(self, "create"))
	dispatcher.register_handler("shader.validate", Callable(self, "validate"))
	dispatcher.register_handler("shader.save_with_validation", Callable(self, "save_with_validation"))
	dispatcher.register_handler("shader.set_uniform", Callable(self, "set_uniform"))
	dispatcher.register_handler("shader.list_uniforms", Callable(self, "list_uniforms"))
	dispatcher.register_handler("shader.convert_visual_to_text", Callable(self, "convert_visual_to_text"))
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
