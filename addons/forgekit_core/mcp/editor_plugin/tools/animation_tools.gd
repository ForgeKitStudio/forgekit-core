extends RefCounted
## McpAnimationTools — JSON-RPC handler adapter for the six editor-channel
## Animation MCP tools.
##
##   animation.list(player_path)                                      → {animations}
##   animation.play(player_path, name, speed?)                        → {playing, name}
##   animation.stop(player_path)                                      → {stopped: true}
##   animation.add_track(player_path, animation_name, track_type, path)
##                                                                    → {track_index}  (UndoRedo)
##   animation.insert_keyframe(player_path, animation_name, track, time, value)
##                                                                    → {keyframe_index} (UndoRedo)
##   animation.remove_track(player_path, animation_name, track_index) → {removed: true}  (UndoRedo)
##
## The adapter is intentionally thin. It translates by-name (Dictionary) and
## by-position (Array) JSON-RPC params into calls on an injected
## AnimationBackend (duck-typed). UndoRedo wrapping for the three mutating
## tools lives inside the backend so the adapter can run headlessly against
## a fake without pulling in `EditorUndoRedoManager`.


class_name McpAnimationTools


var _backend: Object = null


func _init(backend: Object = null) -> void:
	_backend = backend


func set_backend(backend: Object) -> void:
	_backend = backend


# ---------------------------------------------------------------------------
# MCP tool handlers.
# ---------------------------------------------------------------------------

func list(params: Variant) -> Variant:
	var player_path: String = _get_string_param(params, "player_path", 0, "")
	return _backend.list_animations(player_path)


func play(params: Variant) -> Variant:
	var player_path: String = _get_string_param(params, "player_path", 0, "")
	var name: String = _get_string_param(params, "name", 1, "")
	var speed: float = _get_float_param(params, "speed", 2, 1.0)
	return _backend.play_animation(player_path, name, speed)


func stop(params: Variant) -> Variant:
	var player_path: String = _get_string_param(params, "player_path", 0, "")
	return _backend.stop_animation(player_path)


func add_track(params: Variant) -> Variant:
	var player_path: String = _get_string_param(params, "player_path", 0, "")
	var animation_name: String = _get_string_param(params, "animation_name", 1, "")
	var track_type: String = _get_string_param(params, "track_type", 2, "")
	var path: String = _get_string_param(params, "path", 3, "")
	return _backend.add_track(player_path, animation_name, track_type, path)


func insert_keyframe(params: Variant) -> Variant:
	var player_path: String = _get_string_param(params, "player_path", 0, "")
	var animation_name: String = _get_string_param(params, "animation_name", 1, "")
	var track: int = _get_int_param(params, "track", 2, 0)
	var time: float = _get_float_param(params, "time", 3, 0.0)
	var value: Variant = _get_variant_param(params, "value", 4, null)
	return _backend.insert_keyframe(player_path, animation_name, track, time, value)


func remove_track(params: Variant) -> Variant:
	var player_path: String = _get_string_param(params, "player_path", 0, "")
	var animation_name: String = _get_string_param(params, "animation_name", 1, "")
	var track_index: int = _get_int_param(params, "track_index", 2, 0)
	return _backend.remove_track(player_path, animation_name, track_index)


## Bulk-register all six editor-channel Animation MCP methods on the
## supplied dispatcher. Returns `self` so the caller can chain.
func register_on(dispatcher: Object) -> Object:
	dispatcher.register_handler("animation.list", Callable(self, "list"))
	dispatcher.register_handler("animation.play", Callable(self, "play"))
	dispatcher.register_handler("animation.stop", Callable(self, "stop"))
	dispatcher.register_handler("animation.add_track", Callable(self, "add_track"))
	dispatcher.register_handler("animation.insert_keyframe", Callable(self, "insert_keyframe"))
	dispatcher.register_handler("animation.remove_track", Callable(self, "remove_track"))
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
