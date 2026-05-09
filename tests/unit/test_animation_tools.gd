extends GutTest
## Unit tests for McpAnimationTools: JSON-RPC handler adapter that exposes
## the six editor-channel Animation MCP tools on top of a duck-typed
## AnimationBackend.
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
## The adapter forwards by-name (Dictionary) and by-position (Array) JSON-RPC
## params verbatim to the injected backend. UndoRedo wrapping for the three
## mutating tools is the backend's responsibility; the adapter only verifies
## parameter marshalling.


const ANIMATION_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/tools/animation_tools.gd")
const DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")


class FakeAnimationBackend:
	extends RefCounted

	var calls: Array = []
	var overrides: Dictionary = {}

	func list_animations(player_path: String) -> Variant:
		calls.append({"op": "list_animations", "player_path": player_path})
		if overrides.has("list_animations"):
			return overrides["list_animations"]
		return {"animations": [{"name": "idle", "length": 1.0, "loop_mode": "linear"}]}

	func play_animation(player_path: String, name: String, speed: float) -> Variant:
		calls.append({"op": "play_animation", "player_path": player_path, "name": name, "speed": speed})
		if overrides.has("play_animation"):
			return overrides["play_animation"]
		return {"playing": true, "name": name}

	func stop_animation(player_path: String) -> Variant:
		calls.append({"op": "stop_animation", "player_path": player_path})
		if overrides.has("stop_animation"):
			return overrides["stop_animation"]
		return {"stopped": true}

	func add_track(player_path: String, animation_name: String, track_type: String, path: String) -> Variant:
		calls.append({
			"op": "add_track",
			"player_path": player_path,
			"animation_name": animation_name,
			"track_type": track_type,
			"path": path,
		})
		if overrides.has("add_track"):
			return overrides["add_track"]
		return {"track_index": 0}

	func insert_keyframe(player_path: String, animation_name: String, track: int, time: float, value: Variant) -> Variant:
		calls.append({
			"op": "insert_keyframe",
			"player_path": player_path,
			"animation_name": animation_name,
			"track": track,
			"time": time,
			"value": value,
		})
		if overrides.has("insert_keyframe"):
			return overrides["insert_keyframe"]
		return {"keyframe_index": 0}

	func remove_track(player_path: String, animation_name: String, track_index: int) -> Variant:
		calls.append({
			"op": "remove_track",
			"player_path": player_path,
			"animation_name": animation_name,
			"track_index": track_index,
		})
		if overrides.has("remove_track"):
			return overrides["remove_track"]
		return {"removed": true}

	func find_calls(op: String) -> Array:
		var out: Array = []
		for c in calls:
			if (c as Dictionary).get("op", "") == op:
				out.append(c)
		return out


func _new_env() -> Dictionary:
	var backend: FakeAnimationBackend = FakeAnimationBackend.new()
	var tools: Object = ANIMATION_TOOLS_SCRIPT.new(backend)
	return {"backend": backend, "tools": tools}


func test_list_forwards_player_path() -> void:
	var env: Dictionary = _new_env()
	var result: Variant = (env["tools"] as Object).list({"player_path": "/root/Main/AnimationPlayer"})
	var calls: Array = (env["backend"] as FakeAnimationBackend).find_calls("list_animations")
	assert_eq(calls.size(), 1, "Backend.list_animations must be called once")
	assert_eq((calls[0] as Dictionary).get("player_path", ""), "/root/Main/AnimationPlayer",
		"player_path must be forwarded")
	assert_true(result is Dictionary and (result as Dictionary).has("animations"),
		"Result must contain the animations array")


func test_play_forwards_name_and_default_speed() -> void:
	var env: Dictionary = _new_env()
	var result: Variant = (env["tools"] as Object).play({
		"player_path": "/root/Main/AnimationPlayer",
		"name": "idle",
	})
	var calls: Array = (env["backend"] as FakeAnimationBackend).find_calls("play_animation")
	assert_eq((calls[0] as Dictionary).get("name", ""), "idle", "name forwarded")
	assert_eq((calls[0] as Dictionary).get("speed", 0.0), 1.0, "speed defaults to 1.0 when absent")
	assert_eq((result as Dictionary).get("playing", false), true, "playing flag returned")


func test_play_forwards_speed_when_provided() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).play({
		"player_path": "/root/P",
		"name": "run",
		"speed": 2.5,
	})
	var calls: Array = (env["backend"] as FakeAnimationBackend).find_calls("play_animation")
	assert_eq((calls[0] as Dictionary).get("speed", 0.0), 2.5, "speed forwarded")


func test_stop_forwards_player_path() -> void:
	var env: Dictionary = _new_env()
	var result: Variant = (env["tools"] as Object).stop({"player_path": "/root/P"})
	var calls: Array = (env["backend"] as FakeAnimationBackend).find_calls("stop_animation")
	assert_eq(calls.size(), 1, "Backend.stop_animation called once")
	assert_eq((result as Dictionary).get("stopped", false), true, "stopped flag returned")


func test_add_track_forwards_all_params() -> void:
	var env: Dictionary = _new_env()
	var result: Variant = (env["tools"] as Object).add_track({
		"player_path": "/root/P",
		"animation_name": "run",
		"track_type": "position_3d",
		"path": "Player/Skeleton:bone",
	})
	var call: Dictionary = (env["backend"] as FakeAnimationBackend).find_calls("add_track")[0]
	assert_eq(call.get("animation_name", ""), "run", "animation_name forwarded")
	assert_eq(call.get("track_type", ""), "position_3d", "track_type forwarded")
	assert_eq(call.get("path", ""), "Player/Skeleton:bone", "path forwarded")
	assert_true((result as Dictionary).has("track_index"), "track_index returned")


func test_insert_keyframe_forwards_all_params() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).insert_keyframe({
		"player_path": "/root/P",
		"animation_name": "run",
		"track": 2,
		"time": 0.5,
		"value": 42,
	})
	var call: Dictionary = (env["backend"] as FakeAnimationBackend).find_calls("insert_keyframe")[0]
	assert_eq(call.get("track", -1), 2, "track forwarded")
	assert_eq(call.get("time", -1.0), 0.5, "time forwarded")
	assert_eq(call.get("value", null), 42, "value forwarded verbatim")


func test_remove_track_forwards_track_index() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).remove_track({
		"player_path": "/root/P",
		"animation_name": "run",
		"track_index": 3,
	})
	var call: Dictionary = (env["backend"] as FakeAnimationBackend).find_calls("remove_track")[0]
	assert_eq(call.get("track_index", -1), 3, "track_index forwarded")


func test_accepts_by_position_params() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).play(["/root/P", "idle", 1.5])
	var call: Dictionary = (env["backend"] as FakeAnimationBackend).find_calls("play_animation")[0]
	assert_eq(call.get("name", ""), "idle", "by-position name forwarded")
	assert_eq(call.get("speed", 0.0), 1.5, "by-position speed forwarded")


func test_register_on_wires_all_six_animation_methods() -> void:
	var env: Dictionary = _new_env()
	var dispatcher: Object = DISPATCHER_SCRIPT.new()
	(env["tools"] as Object).register_on(dispatcher)
	var expected: Array = [
		"animation.list",
		"animation.play",
		"animation.stop",
		"animation.add_track",
		"animation.insert_keyframe",
		"animation.remove_track",
	]
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
