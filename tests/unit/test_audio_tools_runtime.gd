extends GutTest
## Unit tests for McpAudioRuntimeTools: two runtime-channel Audio MCP
## tools on top of a duck-typed AudioRuntimeBackend.
##
##   audio.play_stream(stream_path, bus?, volume_db?)  → {player_id}
##   audio.stop_stream(player_id)                      → {stopped: true}


const AUDIO_RUNTIME_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/runtime_bridge/tools/audio_runtime_tools.gd")
const DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")


class FakeAudioRuntimeBackend:
	extends RefCounted

	var calls: Array = []

	func play_stream(stream_path: String, bus: String, volume_db: float) -> Variant:
		calls.append({"op": "play_stream", "stream_path": stream_path, "bus": bus, "volume_db": volume_db})
		return {"player_id": "p1"}

	func stop_stream(player_id: String) -> Variant:
		calls.append({"op": "stop_stream", "player_id": player_id})
		return {"stopped": true}

	func find_calls(op: String) -> Array:
		var out: Array = []
		for c in calls:
			if (c as Dictionary).get("op", "") == op:
				out.append(c)
		return out


func _new_env() -> Dictionary:
	var backend: FakeAudioRuntimeBackend = FakeAudioRuntimeBackend.new()
	var tools: Object = AUDIO_RUNTIME_SCRIPT.new(backend)
	return {"backend": backend, "tools": tools}


func test_play_stream_forwards_stream_path_with_defaults() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).play_stream({"stream_path": "res://a.wav"})
	var call: Dictionary = (env["backend"] as FakeAudioRuntimeBackend).find_calls("play_stream")[0]
	assert_eq(call.get("bus", ""), "Master", "bus defaults to Master")
	assert_eq(call.get("volume_db", -999.0), 0.0, "volume_db defaults to 0")


func test_play_stream_forwards_explicit_params() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).play_stream({
		"stream_path": "res://a.wav",
		"bus": "SFX",
		"volume_db": -3.0,
	})
	var call: Dictionary = (env["backend"] as FakeAudioRuntimeBackend).find_calls("play_stream")[0]
	assert_eq(call.get("bus", ""), "SFX", "bus forwarded")
	assert_eq(call.get("volume_db", 0.0), -3.0, "volume_db forwarded")


func test_stop_stream_forwards_player_id() -> void:
	var env: Dictionary = _new_env()
	var result: Variant = (env["tools"] as Object).stop_stream({"player_id": "p1"})
	var call: Dictionary = (env["backend"] as FakeAudioRuntimeBackend).find_calls("stop_stream")[0]
	assert_eq(call.get("player_id", ""), "p1", "player_id forwarded")
	assert_eq((result as Dictionary).get("stopped", false), true, "stopped flag returned")


func test_register_on_wires_both_runtime_audio_methods() -> void:
	var env: Dictionary = _new_env()
	var dispatcher: Object = DISPATCHER_SCRIPT.new()
	(env["tools"] as Object).register_on(dispatcher)
	var expected: Array = ["audio.play_stream", "audio.stop_stream"]
	var req_id: int = 1
	for method in expected:
		var resp: Dictionary = dispatcher.dispatch({
			"jsonrpc": "2.0",
			"method": method,
			"params": {},
			"id": req_id,
		})
		assert_true(resp.has("result"), "Method %s must reach the adapter" % method)
		req_id += 1
