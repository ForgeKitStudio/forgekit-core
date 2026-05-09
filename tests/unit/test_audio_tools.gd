extends GutTest
## Unit tests for McpAudioTools: four editor-channel Audio MCP tools on
## top of a duck-typed AudioBackend.
##
##   audio.list_buses()                                              → {buses}
##   audio.set_bus_volume_db(bus_name, db)                           (UndoRedo)
##   audio.add_bus_effect(bus_name, effect_type, params?)            (UndoRedo)
##   audio.import_sound(source_path, target_path, import_flags?)     (UndoRedo)


const AUDIO_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/tools/audio_tools.gd")
const DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")


class FakeAudioBackend:
	extends RefCounted

	var calls: Array = []

	func list_buses() -> Variant:
		calls.append({"op": "list_buses"})
		return {"buses": [{"index": 0, "name": "Master", "volume_db": 0.0, "mute": false, "solo": false, "bypass": false, "effects": []}]}

	func set_bus_volume_db(bus_name: String, db: float) -> Variant:
		calls.append({"op": "set_bus_volume_db", "bus_name": bus_name, "db": db})
		return {"applied": true}

	func add_bus_effect(bus_name: String, effect_type: String, params: Dictionary) -> Variant:
		calls.append({
			"op": "add_bus_effect",
			"bus_name": bus_name,
			"effect_type": effect_type,
			"params": params,
		})
		return {"applied": true}

	func import_sound(source_path: String, target_path: String, import_flags: Dictionary) -> Variant:
		calls.append({
			"op": "import_sound",
			"source_path": source_path,
			"target_path": target_path,
			"import_flags": import_flags,
		})
		return {"target_path": target_path}

	func find_calls(op: String) -> Array:
		var out: Array = []
		for c in calls:
			if (c as Dictionary).get("op", "") == op:
				out.append(c)
		return out


func _new_env() -> Dictionary:
	var backend: FakeAudioBackend = FakeAudioBackend.new()
	var tools: Object = AUDIO_TOOLS_SCRIPT.new(backend)
	return {"backend": backend, "tools": tools}


func test_list_buses_returns_buses_array() -> void:
	var env: Dictionary = _new_env()
	var result: Variant = (env["tools"] as Object).list_buses({})
	assert_true(((result as Dictionary).get("buses", []) as Array).size() > 0,
		"buses returned")


func test_set_bus_volume_db_forwards_params() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).set_bus_volume_db({
		"bus_name": "Music",
		"db": -6.0,
	})
	var call: Dictionary = (env["backend"] as FakeAudioBackend).find_calls("set_bus_volume_db")[0]
	assert_eq(call.get("bus_name", ""), "Music", "bus_name forwarded")
	assert_eq(call.get("db", 0.0), -6.0, "db forwarded as float")


func test_add_bus_effect_forwards_params() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).add_bus_effect({
		"bus_name": "Music",
		"effect_type": "reverb",
		"params": {"room_size": 0.8},
	})
	var call: Dictionary = (env["backend"] as FakeAudioBackend).find_calls("add_bus_effect")[0]
	assert_eq(call.get("effect_type", ""), "reverb", "effect_type forwarded")


func test_import_sound_forwards_paths_and_flags() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).import_sound({
		"source_path": "res://a.wav",
		"target_path": "res://a.tres",
		"import_flags": {"loop": true},
	})
	var call: Dictionary = (env["backend"] as FakeAudioBackend).find_calls("import_sound")[0]
	assert_eq((call.get("import_flags", {}) as Dictionary).get("loop", false), true,
		"import_flags forwarded")


func test_register_on_wires_all_four_editor_audio_methods() -> void:
	var env: Dictionary = _new_env()
	var dispatcher: Object = DISPATCHER_SCRIPT.new()
	(env["tools"] as Object).register_on(dispatcher)
	var expected: Array = [
		"audio.list_buses",
		"audio.set_bus_volume_db",
		"audio.add_bus_effect",
		"audio.import_sound",
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
