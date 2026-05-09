extends GutTest
## Unit tests for McpParticleTools: five editor-channel Particle MCP tools
## on top of a duck-typed ParticleBackend.
##
##   particle.create_gpu(scene_path, parent_path, transform?)           (UndoRedo)
##   particle.create_cpu(scene_path, parent_path, transform?)           (UndoRedo)
##   particle.set_emission_shape(material_path, shape, params)          (UndoRedo)
##   particle.preview_in_editor(node_path, duration?)                   → {previewing, duration_ms}
##   particle.convert_cpu_to_gpu(node_path)                             (UndoRedo)


const PARTICLE_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/tools/particle_tools.gd")
const DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")


class FakeParticleBackend:
	extends RefCounted

	var calls: Array = []

	func create_gpu(scene_path: String, parent_path: String, transform: Variant) -> Variant:
		calls.append({"op": "create_gpu", "scene_path": scene_path, "parent_path": parent_path, "transform": transform})
		return {"node_path": parent_path + "/GPUParticles3D"}

	func create_cpu(scene_path: String, parent_path: String, transform: Variant) -> Variant:
		calls.append({"op": "create_cpu", "scene_path": scene_path, "parent_path": parent_path, "transform": transform})
		return {"node_path": parent_path + "/CPUParticles3D"}

	func set_emission_shape(material_path: String, shape: String, params: Dictionary) -> Variant:
		calls.append({
			"op": "set_emission_shape",
			"material_path": material_path,
			"shape": shape,
			"params": params,
		})
		return {"applied": true}

	func preview_in_editor(node_path: String, duration: int) -> Variant:
		calls.append({"op": "preview_in_editor", "node_path": node_path, "duration": duration})
		return {"previewing": true, "duration_ms": duration}

	func convert_cpu_to_gpu(node_path: String) -> Variant:
		calls.append({"op": "convert_cpu_to_gpu", "node_path": node_path})
		return {"new_node_path": node_path + "_gpu"}

	func find_calls(op: String) -> Array:
		var out: Array = []
		for c in calls:
			if (c as Dictionary).get("op", "") == op:
				out.append(c)
		return out


func _new_env() -> Dictionary:
	var backend: FakeParticleBackend = FakeParticleBackend.new()
	var tools: Object = PARTICLE_TOOLS_SCRIPT.new(backend)
	return {"backend": backend, "tools": tools}


func test_create_gpu_forwards_params() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).create_gpu({
		"scene_path": "res://m.tscn",
		"parent_path": "/root/M",
	})
	var call: Dictionary = (env["backend"] as FakeParticleBackend).find_calls("create_gpu")[0]
	assert_eq(call.get("parent_path", ""), "/root/M", "parent_path forwarded")


func test_create_cpu_forwards_params() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).create_cpu({
		"scene_path": "res://m.tscn",
		"parent_path": "/root/M",
	})
	var call: Dictionary = (env["backend"] as FakeParticleBackend).find_calls("create_cpu")[0]
	assert_eq(call.get("parent_path", ""), "/root/M", "parent_path forwarded")


func test_set_emission_shape_forwards_params() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).set_emission_shape({
		"material_path": "res://m.tres",
		"shape": "sphere",
		"params": {"radius": 2.0},
	})
	var call: Dictionary = (env["backend"] as FakeParticleBackend).find_calls("set_emission_shape")[0]
	assert_eq(call.get("shape", ""), "sphere", "shape forwarded")
	assert_eq((call.get("params", {}) as Dictionary).get("radius", 0.0), 2.0, "params forwarded")


func test_preview_in_editor_forwards_duration_with_default() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).preview_in_editor({"node_path": "/root/M/Part"})
	var call: Dictionary = (env["backend"] as FakeParticleBackend).find_calls("preview_in_editor")[0]
	assert_eq(call.get("duration", -1), 2000, "duration defaults to 2000ms when absent")


func test_preview_in_editor_forwards_explicit_duration() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).preview_in_editor({
		"node_path": "/root/M/Part",
		"duration": 5000,
	})
	var call: Dictionary = (env["backend"] as FakeParticleBackend).find_calls("preview_in_editor")[0]
	assert_eq(call.get("duration", -1), 5000, "explicit duration forwarded")


func test_convert_cpu_to_gpu_returns_new_node_path() -> void:
	var env: Dictionary = _new_env()
	var result: Variant = (env["tools"] as Object).convert_cpu_to_gpu({"node_path": "/root/M/Part"})
	assert_true((result as Dictionary).has("new_node_path"), "new_node_path returned")


func test_register_on_wires_all_five_particle_methods() -> void:
	var env: Dictionary = _new_env()
	var dispatcher: Object = DISPATCHER_SCRIPT.new()
	(env["tools"] as Object).register_on(dispatcher)
	var expected: Array = [
		"particle.create_gpu",
		"particle.create_cpu",
		"particle.set_emission_shape",
		"particle.preview_in_editor",
		"particle.convert_cpu_to_gpu",
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
