extends GutTest
## Unit tests for McpEditorSceneTools: JSON-RPC handler adapter that exposes
## the 8 editor-channel Scene MCP tools on top of a duck-typed
## EditorSceneBackend.
##
## The adapter extracts parameters from each JSON-RPC `params` payload, calls
## the matching backend method, and returns the backend's result verbatim.
## Business-level errors surface as `{"error": {...}}` envelopes that the
## dispatcher hoists to JSON-RPC error responses.


const SCENE_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/tools/scene_tools.gd")
const DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")
const MCP_ERROR_CODES_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/mcp_error_codes.gd")


# ---------------------------------------------------------------------------
# FakeEditorSceneBackend — records every call and returns either a canned
# success payload or an injected override. Each method in the real backend
# wraps the underlying EditorInterface calls; tests only care that the
# adapter forwards parameters verbatim.
# ---------------------------------------------------------------------------

class FakeEditorSceneBackend:
	extends RefCounted

	var calls: Array = []
	var overrides: Dictionary = {}

	func open_scene(scene_path: String) -> Variant:
		calls.append({"op": "open_scene", "scene_path": scene_path})
		if overrides.has("open_scene"):
			return overrides["open_scene"]
		return {"node_count": 5, "root_path": "/root/Forest"}

	func save_scene(scene_path: String) -> Variant:
		calls.append({"op": "save_scene", "scene_path": scene_path})
		if overrides.has("save_scene"):
			return overrides["save_scene"]
		return {"saved_path": scene_path, "size_bytes": 1024}

	func save_scene_as(scene_path: String, target_path: String) -> Variant:
		calls.append({"op": "save_scene_as", "scene_path": scene_path, "target_path": target_path})
		if overrides.has("save_scene_as"):
			return overrides["save_scene_as"]
		return {"saved_path": target_path}

	func close_scene(scene_path: String) -> Variant:
		calls.append({"op": "close_scene", "scene_path": scene_path})
		if overrides.has("close_scene"):
			return overrides["close_scene"]
		return {"closed": true}

	func list_open_scenes() -> Variant:
		calls.append({"op": "list_open_scenes"})
		if overrides.has("list_open_scenes"):
			return overrides["list_open_scenes"]
		return {"scenes": [{"scene_path": "res://levels/forest.tscn", "root_path": "/root/Forest"}]}

	func get_scene_tree(scene_path: String, max_depth: int) -> Variant:
		calls.append({"op": "get_scene_tree", "scene_path": scene_path, "max_depth": max_depth})
		if overrides.has("get_scene_tree"):
			return overrides["get_scene_tree"]
		return {"tree": {"path": "/root/Forest", "type": "Node3D", "children": []}}

	func instantiate_scene(scene_path: String, parent_path: String, transform: Variant) -> Variant:
		calls.append({"op": "instantiate_scene", "scene_path": scene_path, "parent_path": parent_path, "transform": transform})
		if overrides.has("instantiate_scene"):
			return overrides["instantiate_scene"]
		return {"node_path": parent_path + "/Instantiated"}

	func create_scene(scene_path: String, root_type: String, root_name: String) -> Variant:
		calls.append({"op": "create_scene", "scene_path": scene_path, "root_type": root_type, "root_name": root_name})
		if overrides.has("create_scene"):
			return overrides["create_scene"]
		return {"saved_path": scene_path}

	func find_calls(op: String) -> Array:
		var out: Array = []
		for c in calls:
			if (c as Dictionary).get("op", "") == op:
				out.append(c)
		return out


func _new_env() -> Dictionary:
	var backend: FakeEditorSceneBackend = FakeEditorSceneBackend.new()
	var tools: Object = SCENE_TOOLS_SCRIPT.new(backend)
	return {"backend": backend, "tools": tools}


# ---------------------------------------------------------------------------
# 1) scene.open — forwards scene_path and returns backend payload
# ---------------------------------------------------------------------------

func test_open_forwards_scene_path_and_returns_backend_payload() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorSceneBackend = env["backend"]

	var result: Variant = tools.open({"scene_path": "res://levels/forest.tscn"})

	assert_true(result is Dictionary, "open() must return a Dictionary")
	var dict: Dictionary = result as Dictionary
	assert_eq(dict.get("node_count", 0), 5, "open() must return backend node_count")
	assert_eq(dict.get("root_path", ""), "/root/Forest", "open() must return backend root_path")

	var opens: Array = backend.find_calls("open_scene")
	assert_eq(opens.size(), 1, "Backend.open_scene must be called exactly once")
	assert_eq((opens[0] as Dictionary).get("scene_path", ""), "res://levels/forest.tscn", "scene_path must be forwarded verbatim")


# ---------------------------------------------------------------------------
# 2) scene.open — passes through a FILE_NOT_FOUND envelope from the backend
# ---------------------------------------------------------------------------

func test_open_passes_through_file_not_found_envelope() -> void:
	var env: Dictionary = _new_env()
	var backend: FakeEditorSceneBackend = env["backend"]
	var tools: Object = env["tools"]
	backend.overrides["open_scene"] = {
		"error": MCP_ERROR_CODES_SCRIPT.make_error(
			MCP_ERROR_CODES_SCRIPT.FILE_NOT_FOUND,
			{"requested_path": "res://levels/missing.tscn"}
		),
	}

	var result: Variant = tools.open({"scene_path": "res://levels/missing.tscn"})

	assert_true(result is Dictionary, "open() must return a Dictionary")
	var dict: Dictionary = result as Dictionary
	assert_true(dict.has("error"), "Result must carry an 'error' envelope when backend returns one")
	var err: Dictionary = dict.get("error", {})
	assert_eq(err.get("code", 0), MCP_ERROR_CODES_SCRIPT.FILE_NOT_FOUND, "Envelope must carry FILE_NOT_FOUND code")


# ---------------------------------------------------------------------------
# 3) scene.save — forwards optional scene_path
# ---------------------------------------------------------------------------

func test_save_forwards_scene_path_when_supplied() -> void:
	var env: Dictionary = _new_env()
	var backend: FakeEditorSceneBackend = env["backend"]
	var tools: Object = env["tools"]

	var result: Variant = tools.save({"scene_path": "res://levels/forest.tscn"})

	var saves: Array = backend.find_calls("save_scene")
	assert_eq(saves.size(), 1, "Backend.save_scene must be called once")
	assert_eq((saves[0] as Dictionary).get("scene_path", ""), "res://levels/forest.tscn", "scene_path must be forwarded")
	assert_eq((result as Dictionary).get("saved_path", ""), "res://levels/forest.tscn", "Backend payload must be returned")


# ---------------------------------------------------------------------------
# 4) scene.save — forwards empty path when scene_path param is absent
# ---------------------------------------------------------------------------

func test_save_forwards_empty_path_when_scene_path_absent() -> void:
	var env: Dictionary = _new_env()
	var backend: FakeEditorSceneBackend = env["backend"]
	var tools: Object = env["tools"]

	var _result: Variant = tools.save({})

	var saves: Array = backend.find_calls("save_scene")
	assert_eq(saves.size(), 1, "Backend.save_scene must be called once")
	assert_eq((saves[0] as Dictionary).get("scene_path", "__missing"), "", "Missing scene_path must forward as empty string")


# ---------------------------------------------------------------------------
# 5) scene.save_as — forwards scene_path and target_path
# ---------------------------------------------------------------------------

func test_save_as_forwards_both_paths() -> void:
	var env: Dictionary = _new_env()
	var backend: FakeEditorSceneBackend = env["backend"]
	var tools: Object = env["tools"]

	var result: Variant = tools.save_as({
		"scene_path": "res://levels/forest.tscn",
		"target_path": "res://levels/forest_copy.tscn",
	})

	var calls: Array = backend.find_calls("save_scene_as")
	assert_eq(calls.size(), 1, "Backend.save_scene_as must be called once")
	var call: Dictionary = calls[0]
	assert_eq(call.get("scene_path", ""), "res://levels/forest.tscn", "scene_path must be forwarded")
	assert_eq(call.get("target_path", ""), "res://levels/forest_copy.tscn", "target_path must be forwarded")
	assert_eq((result as Dictionary).get("saved_path", ""), "res://levels/forest_copy.tscn", "Backend payload must be returned")


# ---------------------------------------------------------------------------
# 6) scene.close — forwards scene_path
# ---------------------------------------------------------------------------

func test_close_forwards_scene_path() -> void:
	var env: Dictionary = _new_env()
	var backend: FakeEditorSceneBackend = env["backend"]
	var tools: Object = env["tools"]

	var result: Variant = tools.close({"scene_path": "res://levels/forest.tscn"})

	var calls: Array = backend.find_calls("close_scene")
	assert_eq(calls.size(), 1, "Backend.close_scene must be called once")
	assert_eq((calls[0] as Dictionary).get("scene_path", ""), "res://levels/forest.tscn", "scene_path must be forwarded")
	assert_true((result as Dictionary).get("closed", false), "Backend payload must be returned")


# ---------------------------------------------------------------------------
# 7) scene.list_open — no params
# ---------------------------------------------------------------------------

func test_list_open_calls_backend_without_params() -> void:
	var env: Dictionary = _new_env()
	var backend: FakeEditorSceneBackend = env["backend"]
	var tools: Object = env["tools"]

	var result: Variant = tools.list_open({})

	var calls: Array = backend.find_calls("list_open_scenes")
	assert_eq(calls.size(), 1, "Backend.list_open_scenes must be called once")
	assert_true(result is Dictionary and (result as Dictionary).has("scenes"), "Result must include scenes array")


# ---------------------------------------------------------------------------
# 8) scene.get_tree — forwards scene_path and max_depth
# ---------------------------------------------------------------------------

func test_get_tree_forwards_scene_path_and_max_depth() -> void:
	var env: Dictionary = _new_env()
	var backend: FakeEditorSceneBackend = env["backend"]
	var tools: Object = env["tools"]

	var _result: Variant = tools.get_tree({
		"scene_path": "res://levels/forest.tscn",
		"max_depth": 2,
	})

	var calls: Array = backend.find_calls("get_scene_tree")
	assert_eq(calls.size(), 1, "Backend.get_scene_tree must be called once")
	var call: Dictionary = calls[0]
	assert_eq(call.get("scene_path", ""), "res://levels/forest.tscn", "scene_path must be forwarded")
	assert_eq(call.get("max_depth", -99), 2, "max_depth must be forwarded verbatim")


# ---------------------------------------------------------------------------
# 9) scene.get_tree — defaults max_depth to -1 when absent (unlimited)
# ---------------------------------------------------------------------------

func test_get_tree_defaults_max_depth_to_minus_one_when_absent() -> void:
	var env: Dictionary = _new_env()
	var backend: FakeEditorSceneBackend = env["backend"]
	var tools: Object = env["tools"]

	var _result: Variant = tools.get_tree({})

	var calls: Array = backend.find_calls("get_scene_tree")
	assert_eq(calls.size(), 1, "Backend.get_scene_tree must be called once")
	var call: Dictionary = calls[0]
	assert_eq(call.get("scene_path", "__missing"), "", "Missing scene_path must forward as empty string")
	assert_eq(call.get("max_depth", -99), -1, "Missing max_depth must forward as -1 (unlimited)")


# ---------------------------------------------------------------------------
# 10) scene.instantiate — forwards scene_path, parent_path and transform
# ---------------------------------------------------------------------------

func test_instantiate_forwards_all_three_params() -> void:
	var env: Dictionary = _new_env()
	var backend: FakeEditorSceneBackend = env["backend"]
	var tools: Object = env["tools"]

	var transform_payload: Dictionary = {"position": [1.0, 2.0, 3.0]}
	var result: Variant = tools.instantiate({
		"scene_path": "res://prefabs/enemy.tscn",
		"parent_path": "/root/Forest",
		"transform": transform_payload,
	})

	var calls: Array = backend.find_calls("instantiate_scene")
	assert_eq(calls.size(), 1, "Backend.instantiate_scene must be called once")
	var call: Dictionary = calls[0]
	assert_eq(call.get("scene_path", ""), "res://prefabs/enemy.tscn", "scene_path must be forwarded")
	assert_eq(call.get("parent_path", ""), "/root/Forest", "parent_path must be forwarded")
	assert_eq(call.get("transform", null), transform_payload, "transform must be forwarded verbatim")
	assert_eq((result as Dictionary).get("node_path", ""), "/root/Forest/Instantiated", "Backend payload must be returned")


# ---------------------------------------------------------------------------
# 11) scene.create — forwards scene_path, root_type, root_name
# ---------------------------------------------------------------------------

func test_create_forwards_scene_path_root_type_and_root_name() -> void:
	var env: Dictionary = _new_env()
	var backend: FakeEditorSceneBackend = env["backend"]
	var tools: Object = env["tools"]

	var result: Variant = tools.create({
		"scene_path": "res://levels/new_level.tscn",
		"root_type": "Node3D",
		"root_name": "NewLevel",
	})

	var calls: Array = backend.find_calls("create_scene")
	assert_eq(calls.size(), 1, "Backend.create_scene must be called once")
	var call: Dictionary = calls[0]
	assert_eq(call.get("scene_path", ""), "res://levels/new_level.tscn", "scene_path must be forwarded")
	assert_eq(call.get("root_type", ""), "Node3D", "root_type must be forwarded")
	assert_eq(call.get("root_name", ""), "NewLevel", "root_name must be forwarded")
	assert_eq((result as Dictionary).get("saved_path", ""), "res://levels/new_level.tscn", "Backend payload must be returned")


# ---------------------------------------------------------------------------
# 12) register_on — wires all 8 MCP method names on the dispatcher
# ---------------------------------------------------------------------------

func test_register_on_wires_all_eight_mcp_methods() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var dispatcher: Object = DISPATCHER_SCRIPT.new()

	tools.register_on(dispatcher)

	var expected_methods: Array = [
		{"method": "scene.open", "params": {"scene_path": "res://levels/forest.tscn"}},
		{"method": "scene.save", "params": {"scene_path": "res://levels/forest.tscn"}},
		{"method": "scene.save_as", "params": {"scene_path": "res://a.tscn", "target_path": "res://b.tscn"}},
		{"method": "scene.close", "params": {"scene_path": "res://levels/forest.tscn"}},
		{"method": "scene.list_open", "params": {}},
		{"method": "scene.get_tree", "params": {"scene_path": "res://levels/forest.tscn"}},
		{"method": "scene.instantiate", "params": {"scene_path": "res://p.tscn", "parent_path": "/root/A"}},
		{"method": "scene.create", "params": {"scene_path": "res://x.tscn", "root_type": "Node3D", "root_name": "X"}},
	]

	var req_id: int = 1
	for entry in expected_methods:
		var e: Dictionary = entry
		var response: Dictionary = dispatcher.dispatch({
			"jsonrpc": "2.0",
			"method": e["method"],
			"params": e["params"],
			"id": req_id,
		})
		assert_true(response.has("result"), "Method %s must be reachable via dispatcher" % e["method"])
		assert_false(response.has("error"), "Method %s must not produce a dispatcher error" % e["method"])
		req_id += 1


# ---------------------------------------------------------------------------
# 13) Dispatcher hoists a FILE_NOT_FOUND envelope from the backend into a
#     top-level JSON-RPC error response.
# ---------------------------------------------------------------------------

func test_dispatcher_hoists_file_not_found_from_backend_to_error_envelope() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorSceneBackend = env["backend"]
	var dispatcher: Object = DISPATCHER_SCRIPT.new()
	tools.register_on(dispatcher)

	backend.overrides["open_scene"] = {
		"error": MCP_ERROR_CODES_SCRIPT.make_error(
			MCP_ERROR_CODES_SCRIPT.FILE_NOT_FOUND,
			{"requested_path": "res://levels/missing.tscn"}
		),
	}

	var response: Dictionary = dispatcher.dispatch({
		"jsonrpc": "2.0",
		"method": "scene.open",
		"params": {"scene_path": "res://levels/missing.tscn"},
		"id": 42,
	})

	assert_false(response.has("result"), "Business-error response must not carry 'result'")
	assert_true(response.has("error"), "Business-error response must carry 'error'")
	var err: Dictionary = response["error"]
	assert_eq(err.get("code", 0), MCP_ERROR_CODES_SCRIPT.FILE_NOT_FOUND, "Error code must be -32001 FILE_NOT_FOUND")
	assert_eq(err.get("message", ""), "FILE_NOT_FOUND", "Error message must be the literal 'FILE_NOT_FOUND'")
	var data: Dictionary = err.get("data", {})
	assert_eq(data.get("requested_path", ""), "res://levels/missing.tscn", "Error data must echo requested_path")
	assert_eq(response.get("id", null), 42, "Error envelope must echo the request id")
