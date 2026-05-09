extends GutTest
## Unit tests for McpScene3dTools: six editor-channel 3D Scene MCP tools on
## top of a duck-typed Scene3dBackend.
##
##   scene3d.add_mesh_instance(scene_path, parent_path, mesh_path, transform?)  (UndoRedo)
##   scene3d.add_light(scene_path, parent_path, type, transform?, params?)      (UndoRedo)
##   scene3d.add_camera(scene_path, parent_path, transform?, params?)           (UndoRedo)
##   scene3d.set_environment(scene_path, env_path)                              (UndoRedo)
##   scene3d.bake_lightmap(scene_path, quality?)                                → {success, lightmap_path, duration_ms}
##   scene3d.import_gltf(source_path, target_path)                              (UndoRedo)


const SCENE3D_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/tools/scene3d_tools.gd")
const DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")


class FakeScene3dBackend:
	extends RefCounted

	var calls: Array = []

	func add_mesh_instance(scene_path: String, parent_path: String, mesh_path: String, transform: Variant) -> Variant:
		calls.append({
			"op": "add_mesh_instance",
			"scene_path": scene_path,
			"parent_path": parent_path,
			"mesh_path": mesh_path,
			"transform": transform,
		})
		return {"node_path": parent_path + "/MeshInstance3D"}

	func add_light(scene_path: String, parent_path: String, type: String, transform: Variant, params: Dictionary) -> Variant:
		calls.append({
			"op": "add_light",
			"scene_path": scene_path,
			"parent_path": parent_path,
			"type": type,
			"transform": transform,
			"params": params,
		})
		return {"node_path": parent_path + "/Light"}

	func add_camera(scene_path: String, parent_path: String, transform: Variant, params: Dictionary) -> Variant:
		calls.append({
			"op": "add_camera",
			"scene_path": scene_path,
			"parent_path": parent_path,
			"transform": transform,
			"params": params,
		})
		return {"node_path": parent_path + "/Camera3D"}

	func set_environment(scene_path: String, env_path: String) -> Variant:
		calls.append({"op": "set_environment", "scene_path": scene_path, "env_path": env_path})
		return {"applied": true}

	func bake_lightmap(scene_path: String, quality: String) -> Variant:
		calls.append({"op": "bake_lightmap", "scene_path": scene_path, "quality": quality})
		return {"success": true, "lightmap_path": "res://lightmaps/a.lmbake", "duration_ms": 1234}

	func import_gltf(source_path: String, target_path: String) -> Variant:
		calls.append({"op": "import_gltf", "source_path": source_path, "target_path": target_path})
		return {"target_path": target_path}

	func find_calls(op: String) -> Array:
		var out: Array = []
		for c in calls:
			if (c as Dictionary).get("op", "") == op:
				out.append(c)
		return out


func _new_env() -> Dictionary:
	var backend: FakeScene3dBackend = FakeScene3dBackend.new()
	var tools: Object = SCENE3D_TOOLS_SCRIPT.new(backend)
	return {"backend": backend, "tools": tools}


func test_add_mesh_instance_forwards_all_params() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).add_mesh_instance({
		"scene_path": "res://main.tscn",
		"parent_path": "/root/Main",
		"mesh_path": "res://meshes/a.mesh",
	})
	var call: Dictionary = (env["backend"] as FakeScene3dBackend).find_calls("add_mesh_instance")[0]
	assert_eq(call.get("mesh_path", ""), "res://meshes/a.mesh", "mesh_path forwarded")


func test_add_light_forwards_type_and_params() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).add_light({
		"scene_path": "res://m.tscn",
		"parent_path": "/root/M",
		"type": "directional",
		"params": {"energy": 2.0},
	})
	var call: Dictionary = (env["backend"] as FakeScene3dBackend).find_calls("add_light")[0]
	assert_eq(call.get("type", ""), "directional", "type forwarded")
	assert_eq((call.get("params", {}) as Dictionary).get("energy", 0.0), 2.0, "params forwarded")


func test_add_camera_forwards_params() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).add_camera({
		"scene_path": "res://m.tscn",
		"parent_path": "/root/M",
		"params": {"fov": 75},
	})
	var call: Dictionary = (env["backend"] as FakeScene3dBackend).find_calls("add_camera")[0]
	assert_eq((call.get("params", {}) as Dictionary).get("fov", 0), 75, "camera params forwarded")


func test_set_environment_forwards_env_path() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).set_environment({
		"scene_path": "res://m.tscn",
		"env_path": "res://env/a.tres",
	})
	var call: Dictionary = (env["backend"] as FakeScene3dBackend).find_calls("set_environment")[0]
	assert_eq(call.get("env_path", ""), "res://env/a.tres", "env_path forwarded")


func test_bake_lightmap_forwards_quality_with_default() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).bake_lightmap({"scene_path": "res://m.tscn"})
	var call: Dictionary = (env["backend"] as FakeScene3dBackend).find_calls("bake_lightmap")[0]
	assert_eq(call.get("quality", ""), "medium", "quality defaults to medium when absent")


func test_bake_lightmap_forwards_explicit_quality() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).bake_lightmap({"scene_path": "res://m.tscn", "quality": "high"})
	var call: Dictionary = (env["backend"] as FakeScene3dBackend).find_calls("bake_lightmap")[0]
	assert_eq(call.get("quality", ""), "high", "explicit quality forwarded")


func test_import_gltf_forwards_paths() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).import_gltf({
		"source_path": "res://a.glb",
		"target_path": "res://a.tscn",
	})
	var call: Dictionary = (env["backend"] as FakeScene3dBackend).find_calls("import_gltf")[0]
	assert_eq(call.get("source_path", ""), "res://a.glb", "source_path forwarded")


func test_register_on_wires_all_six_scene3d_methods() -> void:
	var env: Dictionary = _new_env()
	var dispatcher: Object = DISPATCHER_SCRIPT.new()
	(env["tools"] as Object).register_on(dispatcher)
	var expected: Array = [
		"scene3d.add_mesh_instance",
		"scene3d.add_light",
		"scene3d.add_camera",
		"scene3d.set_environment",
		"scene3d.bake_lightmap",
		"scene3d.import_gltf",
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
