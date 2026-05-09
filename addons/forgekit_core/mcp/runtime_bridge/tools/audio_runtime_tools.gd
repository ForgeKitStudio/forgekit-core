extends RefCounted
## McpAudioRuntimeTools — JSON-RPC handler adapter for the two
## runtime-channel Audio MCP tools on top of a duck-typed
## AudioRuntimeBackend.
##
##   audio.play_stream(stream_path, bus?, volume_db?)  → {player_id}
##   audio.stop_stream(player_id)                      → {stopped: true}
##
## These tools require a running game launched with `--mcp-bridge`. The
## backend is responsible for creating an `AudioStreamPlayer`, attaching
## it to the scene tree, and tracking the returned `player_id` so
## `stop_stream` can free the node on demand. `bus` defaults to `Master`
## and `volume_db` defaults to `0.0` so smoke-test calls without either
## parameter match the common "play this SFX" use case.


class_name McpAudioRuntimeTools


const DEFAULT_BUS: String = "Master"


var _backend: Object = null


func _init(backend: Object = null) -> void:
	_backend = backend


func set_backend(backend: Object) -> void:
	_backend = backend


# ---------------------------------------------------------------------------
# MCP tool handlers.
# ---------------------------------------------------------------------------

func play_stream(params: Variant) -> Variant:
	var stream_path: String = _get_string_param(params, "stream_path", 0, "")
	var bus: String = _get_string_param(params, "bus", 1, DEFAULT_BUS)
	var volume_db: float = _get_float_param(params, "volume_db", 2, 0.0)
	return _backend.play_stream(stream_path, bus, volume_db)


func stop_stream(params: Variant) -> Variant:
	var player_id: String = _get_string_param(params, "player_id", 0, "")
	return _backend.stop_stream(player_id)


## Bulk-register both runtime-channel Audio MCP methods on the supplied
## dispatcher. Returns `self` so the caller can chain.
func register_on(dispatcher: Object) -> Object:
	dispatcher.register_handler("audio.play_stream", Callable(self, "play_stream"))
	dispatcher.register_handler("audio.stop_stream", Callable(self, "stop_stream"))
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
