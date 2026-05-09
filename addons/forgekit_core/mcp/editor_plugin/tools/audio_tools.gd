extends RefCounted
## McpAudioTools — JSON-RPC handler adapter for the four editor-channel
## Audio MCP tools on top of a duck-typed AudioBackend.
##
##   audio.list_buses()                                              → {buses}
##   audio.set_bus_volume_db(bus_name, db)                           (UndoRedo)
##   audio.add_bus_effect(bus_name, effect_type, params?)            (UndoRedo)
##   audio.import_sound(source_path, target_path, import_flags?)     (UndoRedo)
##
## `effect_type` for `add_bus_effect` is one of `reverb`, `chorus`, `delay`,
## `compressor`, `eq`, etc. — the backend validates against the full
## `AudioEffect` subclass list. The two runtime-channel audio tools
## (`audio.play_stream`, `audio.stop_stream`) live on the runtime dispatcher
## under `runtime_bridge/tools/audio_runtime_tools.gd`.


class_name McpAudioTools


var _backend: Object = null


func _init(backend: Object = null) -> void:
	_backend = backend


func set_backend(backend: Object) -> void:
	_backend = backend


# ---------------------------------------------------------------------------
# MCP tool handlers.
# ---------------------------------------------------------------------------

func list_buses(_params: Variant) -> Variant:
	return _backend.list_buses()


func set_bus_volume_db(params: Variant) -> Variant:
	var bus_name: String = _get_string_param(params, "bus_name", 0, "")
	var db: float = _get_float_param(params, "db", 1, 0.0)
	return _backend.set_bus_volume_db(bus_name, db)


func add_bus_effect(params: Variant) -> Variant:
	var bus_name: String = _get_string_param(params, "bus_name", 0, "")
	var effect_type: String = _get_string_param(params, "effect_type", 1, "")
	var p: Dictionary = _get_dict_param(params, "params", 2, {})
	return _backend.add_bus_effect(bus_name, effect_type, p)


func import_sound(params: Variant) -> Variant:
	var source_path: String = _get_string_param(params, "source_path", 0, "")
	var target_path: String = _get_string_param(params, "target_path", 1, "")
	var import_flags: Dictionary = _get_dict_param(params, "import_flags", 2, {})
	return _backend.import_sound(source_path, target_path, import_flags)


## Bulk-register all four editor-channel Audio MCP methods on the supplied
## dispatcher. Returns `self` so the caller can chain.
func register_on(dispatcher: Object) -> Object:
	dispatcher.register_handler("audio.list_buses", Callable(self, "list_buses"))
	dispatcher.register_handler("audio.set_bus_volume_db", Callable(self, "set_bus_volume_db"))
	dispatcher.register_handler("audio.add_bus_effect", Callable(self, "add_bus_effect"))
	dispatcher.register_handler("audio.import_sound", Callable(self, "import_sound"))
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


static func _get_float_param(params: Variant, key: String, index: int, default_value: float) -> float:
	if params is Dictionary:
		var dict: Dictionary = params as Dictionary
		if dict.has(key):
			var v: Variant = dict[key]
			if typeof(v) == TYPE_FLOAT:
				return float(v)
			if typeof(v) == TYPE_INT:
				return float(v)
	elif params is Array:
		var arr: Array = params as Array
		if index >= 0 and index < arr.size():
			var v: Variant = arr[index]
			if typeof(v) == TYPE_FLOAT:
				return float(v)
			if typeof(v) == TYPE_INT:
				return float(v)
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
