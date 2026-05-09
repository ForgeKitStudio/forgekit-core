extends RefCounted
## McpParticleTools — JSON-RPC handler adapter for the five editor-channel
## Particle MCP tools on top of a duck-typed ParticleBackend.
##
##   particle.create_gpu(scene_path, parent_path, transform?)           (UndoRedo)
##   particle.create_cpu(scene_path, parent_path, transform?)           (UndoRedo)
##   particle.set_emission_shape(material_path, shape, params)          (UndoRedo)
##   particle.preview_in_editor(node_path, duration?)                   → {previewing, duration_ms}
##   particle.convert_cpu_to_gpu(node_path)                             (UndoRedo)
##
## `duration` for `preview_in_editor` is expressed in milliseconds and
## defaults to 2000ms when absent. Preview is fire-and-forget — the
## backend returns immediately after scheduling the preview timer.


class_name McpParticleTools


const DEFAULT_PREVIEW_DURATION_MS: int = 2000


var _backend: Object = null


func _init(backend: Object = null) -> void:
	_backend = backend


func set_backend(backend: Object) -> void:
	_backend = backend


# ---------------------------------------------------------------------------
# MCP tool handlers.
# ---------------------------------------------------------------------------

func create_gpu(params: Variant) -> Variant:
	var scene_path: String = _get_string_param(params, "scene_path", 0, "")
	var parent_path: String = _get_string_param(params, "parent_path", 1, "")
	var transform: Variant = _get_variant_param(params, "transform", 2, null)
	return _backend.create_gpu(scene_path, parent_path, transform)


func create_cpu(params: Variant) -> Variant:
	var scene_path: String = _get_string_param(params, "scene_path", 0, "")
	var parent_path: String = _get_string_param(params, "parent_path", 1, "")
	var transform: Variant = _get_variant_param(params, "transform", 2, null)
	return _backend.create_cpu(scene_path, parent_path, transform)


func set_emission_shape(params: Variant) -> Variant:
	var material_path: String = _get_string_param(params, "material_path", 0, "")
	var shape: String = _get_string_param(params, "shape", 1, "")
	var p: Dictionary = _get_dict_param(params, "params", 2, {})
	return _backend.set_emission_shape(material_path, shape, p)


func preview_in_editor(params: Variant) -> Variant:
	var node_path: String = _get_string_param(params, "node_path", 0, "")
	var duration: int = _get_int_param(params, "duration", 1, DEFAULT_PREVIEW_DURATION_MS)
	return _backend.preview_in_editor(node_path, duration)


func convert_cpu_to_gpu(params: Variant) -> Variant:
	var node_path: String = _get_string_param(params, "node_path", 0, "")
	return _backend.convert_cpu_to_gpu(node_path)


## Bulk-register all five editor-channel Particle MCP methods on the
## supplied dispatcher. Returns `self` so the caller can chain.
func register_on(dispatcher: Object) -> Object:
	dispatcher.register_handler("particle.create_gpu", Callable(self, "create_gpu"))
	dispatcher.register_handler("particle.create_cpu", Callable(self, "create_cpu"))
	dispatcher.register_handler("particle.set_emission_shape", Callable(self, "set_emission_shape"))
	dispatcher.register_handler("particle.preview_in_editor", Callable(self, "preview_in_editor"))
	dispatcher.register_handler("particle.convert_cpu_to_gpu", Callable(self, "convert_cpu_to_gpu"))
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
