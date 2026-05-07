extends GutTest
## Unit tests for McpEditorResourceTools: JSON-RPC handler adapter that
## exposes the six editor-channel Resource MCP tools on top of a
## duck-typed EditorResourceBackend.
##
## Tools:
##   resource.load(path)                           → {type, fields}
##   resource.save(path, fields)                   → {path, size_bytes}
##   resource.inspect(path)                        → {type, fields, issues, suggested_fix?}
##   resource.apply_fix(path, fix)                 → {applied, path} | {error}
##   resource.duplicate(from, to, transform?)      → {source, target, size_bytes}
##   resource.list_by_type(class_name, root?)      → {resources}
##
## Undo/Redo is the backend's responsibility — `resource.save` and
## `resource.apply_fix` are expected to route through McpUndoRedoWrapper
## inside the production backend. The adapter only forwards parameters
## verbatim and passes the backend's return envelope through unchanged.


const RESOURCE_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/tools/resource_tools.gd")
const DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")
const MCP_ERROR_CODES_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/mcp_error_codes.gd")


# ---------------------------------------------------------------------------
# FakeEditorResourceBackend — records every call and returns a canned
# success payload or an injected override. Mirrors the pattern used by the
# other editor-channel tool adapters.
# ---------------------------------------------------------------------------

class FakeEditorResourceBackend:
	extends RefCounted

	var calls: Array = []
	var overrides: Dictionary = {}

	func load_resource(path: String) -> Variant:
		calls.append({"op": "load_resource", "path": path})
		if overrides.has("load_resource"):
			return overrides["load_resource"]
		return {"type": "ItemResource", "fields": {"id": "iron_ore", "stack_size": 99}}

	func save_resource(path: String, fields: Dictionary) -> Variant:
		calls.append({"op": "save_resource", "path": path, "fields": fields})
		if overrides.has("save_resource"):
			return overrides["save_resource"]
		return {"path": path, "size_bytes": 128}

	func inspect_resource(path: String) -> Variant:
		calls.append({"op": "inspect_resource", "path": path})
		if overrides.has("inspect_resource"):
			return overrides["inspect_resource"]
		return {
			"type": "ItemResource",
			"fields": {"id": "iron_ore", "stack_size": 99},
			"issues": [],
		}

	func apply_fix(path: String, fix: Dictionary) -> Variant:
		calls.append({"op": "apply_fix", "path": path, "fix": fix})
		if overrides.has("apply_fix"):
			return overrides["apply_fix"]
		return {"applied": true, "path": path}

	func duplicate_resource(source_path: String, target_path: String, transform: Variant) -> Variant:
		calls.append({
			"op": "duplicate_resource",
			"source": source_path,
			"target": target_path,
			"transform": transform,
		})
		if overrides.has("duplicate_resource"):
			return overrides["duplicate_resource"]
		return {"source": source_path, "target": target_path, "size_bytes": 128}

	func list_by_type(class_name_: String, root_path: String) -> Variant:
		calls.append({"op": "list_by_type", "class_name": class_name_, "root": root_path})
		if overrides.has("list_by_type"):
			return overrides["list_by_type"]
		return {"resources": ["res://%s/a.tres" % root_path, "res://%s/b.tres" % root_path]}

	func find_calls(op: String) -> Array:
		var out: Array = []
		for c in calls:
			if (c as Dictionary).get("op", "") == op:
				out.append(c)
		return out


func _new_env() -> Dictionary:
	var backend: FakeEditorResourceBackend = FakeEditorResourceBackend.new()
	var tools: Object = RESOURCE_TOOLS_SCRIPT.new(backend)
	return {"backend": backend, "tools": tools}


# ---------------------------------------------------------------------------
# 1) resource.load — forwards path and returns {type, fields}
# ---------------------------------------------------------------------------

func test_resource_load_forwards_path_and_returns_type_and_fields() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorResourceBackend = env["backend"]

	var result: Variant = tools.load({"path": "res://items/iron_ore.tres"})

	var call: Dictionary = backend.find_calls("load_resource")[0]
	assert_eq(call.get("path", ""), "res://items/iron_ore.tres", "path must be forwarded verbatim")
	assert_true((result as Dictionary).has("type"), "type field returned")
	assert_true((result as Dictionary).has("fields"), "fields field returned")


func test_resource_load_passes_through_file_not_found_envelope() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorResourceBackend = env["backend"]
	backend.overrides["load_resource"] = {
		"error": MCP_ERROR_CODES_SCRIPT.make_error(
			MCP_ERROR_CODES_SCRIPT.FILE_NOT_FOUND,
			{"requested_path": "res://items/missing.tres"}
		),
	}

	var result: Variant = tools.load({"path": "res://items/missing.tres"})

	assert_true((result as Dictionary).has("error"), "FILE_NOT_FOUND envelope must propagate")


# ---------------------------------------------------------------------------
# 2) resource.save — forwards path + fields
# ---------------------------------------------------------------------------

func test_resource_save_forwards_path_and_fields() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorResourceBackend = env["backend"]

	var result: Variant = tools.save({
		"path": "res://items/copper_ore.tres",
		"fields": {"id": "copper_ore", "stack_size": 64},
	})

	var call: Dictionary = backend.find_calls("save_resource")[0]
	assert_eq(call.get("path", ""), "res://items/copper_ore.tres", "path forwarded")
	var fields: Dictionary = call.get("fields", {})
	assert_eq(fields.get("id", ""), "copper_ore", "fields.id forwarded")
	assert_eq(fields.get("stack_size", 0), 64, "fields.stack_size forwarded")
	assert_true((result as Dictionary).has("size_bytes"), "size_bytes returned")


func test_resource_save_defaults_fields_to_empty_dict_when_absent() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorResourceBackend = env["backend"]

	var _result: Variant = tools.save({"path": "res://items/empty.tres"})

	var call: Dictionary = backend.find_calls("save_resource")[0]
	var fields: Variant = call.get("fields", null)
	assert_true(fields is Dictionary, "fields must default to a Dictionary when the caller omits it")
	assert_eq((fields as Dictionary).size(), 0, "Default fields dictionary is empty")


func test_resource_save_passes_through_core_boundary_violation() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorResourceBackend = env["backend"]
	backend.overrides["save_resource"] = {
		"error": MCP_ERROR_CODES_SCRIPT.make_error(
			MCP_ERROR_CODES_SCRIPT.CORE_BOUNDARY_VIOLATION,
			{"path": "res://addons/forgekit_core/resources/item_resource.gd"}
		),
	}

	var result: Variant = tools.save({
		"path": "res://addons/forgekit_core/resources/item_resource.gd",
		"fields": {},
	})

	var err: Dictionary = (result as Dictionary).get("error", {})
	assert_eq(
		err.get("code", 0),
		MCP_ERROR_CODES_SCRIPT.CORE_BOUNDARY_VIOLATION,
		"CORE_BOUNDARY_VIOLATION must propagate from backend"
	)


# ---------------------------------------------------------------------------
# 3) resource.inspect — forwards path; backend returns {type, fields, issues, suggested_fix?}
# ---------------------------------------------------------------------------

func test_resource_inspect_forwards_path_and_returns_inspection() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorResourceBackend = env["backend"]

	var result: Variant = tools.inspect({"path": "res://items/iron_ore.tres"})

	var call: Dictionary = backend.find_calls("inspect_resource")[0]
	assert_eq(call.get("path", ""), "res://items/iron_ore.tres", "path forwarded")
	var result_dict: Dictionary = result as Dictionary
	assert_true(result_dict.has("type"), "type field returned")
	assert_true(result_dict.has("fields"), "fields field returned")
	assert_true(result_dict.has("issues"), "issues field returned")


func test_resource_inspect_passes_through_issues_and_suggested_fix() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorResourceBackend = env["backend"]
	backend.overrides["inspect_resource"] = {
		"type": "RecipeResource",
		"fields": {"id": "iron_ingot", "inputs": [], "outputs": []},
		"issues": [
			{"kind": "missing_ext_resource", "field": "inputs[0]", "path": "res://items/gone.tres"},
		],
		"suggested_fix": {
			"op": "replace_ext_resource",
			"field": "inputs[0]",
			"from": "res://items/gone.tres",
			"to": "res://items/iron_ore.tres",
		},
	}

	var result: Variant = tools.inspect({"path": "res://recipes/iron_ingot.tres"})

	var result_dict: Dictionary = result as Dictionary
	var issues: Array = result_dict.get("issues", [])
	assert_eq(issues.size(), 1, "issues list propagated verbatim")
	var suggested_fix: Dictionary = result_dict.get("suggested_fix", {})
	assert_eq(suggested_fix.get("op", ""), "replace_ext_resource", "suggested_fix propagated")


# ---------------------------------------------------------------------------
# 4) resource.apply_fix — forwards path + fix; backend wraps in Undo_Redo
# ---------------------------------------------------------------------------

func test_resource_apply_fix_forwards_path_and_fix() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorResourceBackend = env["backend"]

	var fix: Dictionary = {
		"op": "replace_ext_resource",
		"field": "inputs[0]",
		"from": "res://items/gone.tres",
		"to": "res://items/iron_ore.tres",
	}
	var result: Variant = tools.apply_fix({
		"path": "res://recipes/iron_ingot.tres",
		"fix": fix,
	})

	var call: Dictionary = backend.find_calls("apply_fix")[0]
	assert_eq(call.get("path", ""), "res://recipes/iron_ingot.tres", "path forwarded")
	var forwarded_fix: Dictionary = call.get("fix", {})
	assert_eq(forwarded_fix.get("op", ""), "replace_ext_resource", "fix.op forwarded")
	assert_eq(
		forwarded_fix.get("to", ""),
		"res://items/iron_ore.tres",
		"fix.to forwarded"
	)
	assert_true((result as Dictionary).get("applied", false), "applied flag returned")


func test_resource_apply_fix_defaults_fix_to_empty_dict_when_absent() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorResourceBackend = env["backend"]

	var _result: Variant = tools.apply_fix({"path": "res://recipes/noop.tres"})

	var call: Dictionary = backend.find_calls("apply_fix")[0]
	var fix: Variant = call.get("fix", null)
	assert_true(fix is Dictionary, "fix must default to Dictionary when caller omits it")
	assert_eq((fix as Dictionary).size(), 0, "Default fix dictionary is empty")


func test_resource_apply_fix_passes_through_atomic_write_failed() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorResourceBackend = env["backend"]
	backend.overrides["apply_fix"] = {
		"applied": false,
		"error": MCP_ERROR_CODES_SCRIPT.make_error(
			MCP_ERROR_CODES_SCRIPT.ATOMIC_WRITE_FAILED,
			{"path": "res://recipes/locked.tres"}
		),
	}

	var result: Variant = tools.apply_fix({
		"path": "res://recipes/locked.tres",
		"fix": {"op": "noop"},
	})

	var err: Dictionary = (result as Dictionary).get("error", {})
	assert_eq(
		err.get("code", 0),
		MCP_ERROR_CODES_SCRIPT.ATOMIC_WRITE_FAILED,
		"ATOMIC_WRITE_FAILED envelope must propagate"
	)


# ---------------------------------------------------------------------------
# 5) resource.duplicate — forwards from, to, and optional transform
# ---------------------------------------------------------------------------

func test_resource_duplicate_forwards_source_and_target() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorResourceBackend = env["backend"]

	var result: Variant = tools.duplicate({
		"from": "res://items/iron_ore.tres",
		"to": "res://items/copper_ore.tres",
	})

	var call: Dictionary = backend.find_calls("duplicate_resource")[0]
	assert_eq(call.get("source", ""), "res://items/iron_ore.tres", "source forwarded")
	assert_eq(call.get("target", ""), "res://items/copper_ore.tres", "target forwarded")
	assert_eq(call.get("transform", "__present"), null, "transform defaults to null when absent")
	assert_true((result as Dictionary).has("size_bytes"), "size_bytes returned")


func test_resource_duplicate_forwards_transform_when_provided() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorResourceBackend = env["backend"]

	var transform: Dictionary = {"id": "copper_ore", "stack_size": 32}
	var _result: Variant = tools.duplicate({
		"from": "res://items/iron_ore.tres",
		"to": "res://items/copper_ore.tres",
		"transform": transform,
	})

	var call: Dictionary = backend.find_calls("duplicate_resource")[0]
	var forwarded: Dictionary = call.get("transform", {})
	assert_eq(forwarded.get("id", ""), "copper_ore", "transform.id forwarded")
	assert_eq(forwarded.get("stack_size", 0), 32, "transform.stack_size forwarded")


# ---------------------------------------------------------------------------
# 6) resource.list_by_type — forwards class_name and optional root
# ---------------------------------------------------------------------------

func test_list_by_type_forwards_class_name_and_root() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorResourceBackend = env["backend"]

	var result: Variant = tools.list_by_type({
		"class_name": "ItemResource",
		"root": "items",
	})

	var call: Dictionary = backend.find_calls("list_by_type")[0]
	assert_eq(call.get("class_name", ""), "ItemResource", "class_name forwarded")
	assert_eq(call.get("root", ""), "items", "root forwarded")
	assert_true((result as Dictionary).has("resources"), "resources list returned")


func test_list_by_type_defaults_root_to_empty_string_when_absent() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorResourceBackend = env["backend"]

	var _result: Variant = tools.list_by_type({"class_name": "ItemResource"})

	var call: Dictionary = backend.find_calls("list_by_type")[0]
	assert_eq(
		call.get("root", "__missing"),
		"",
		"Missing root must forward as an empty string (whole-project scan)"
	)


# ---------------------------------------------------------------------------
# 7) register_on — wires all six Resource MCP method names on the dispatcher
# ---------------------------------------------------------------------------

func test_register_on_wires_all_six_resource_methods() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var dispatcher: Object = DISPATCHER_SCRIPT.new()

	tools.register_on(dispatcher)

	var expected: Array = [
		{"method": "resource.load", "params": {"path": "res://a.tres"}},
		{"method": "resource.save", "params": {"path": "res://a.tres", "fields": {}}},
		{"method": "resource.inspect", "params": {"path": "res://a.tres"}},
		{"method": "resource.apply_fix", "params": {"path": "res://a.tres", "fix": {}}},
		{"method": "resource.duplicate", "params": {"from": "res://a.tres", "to": "res://b.tres"}},
		{"method": "resource.list_by_type", "params": {"class_name": "ItemResource"}},
	]

	assert_eq(expected.size(), 6, "Editor-channel Resource MCP surface must be six methods")

	var req_id: int = 1
	for entry in expected:
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
# 8) Dispatcher hoists a backend error envelope into a JSON-RPC error response
# ---------------------------------------------------------------------------

func test_dispatcher_hoists_file_not_found_from_resource_load() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorResourceBackend = env["backend"]
	var dispatcher: Object = DISPATCHER_SCRIPT.new()
	tools.register_on(dispatcher)

	backend.overrides["load_resource"] = {
		"error": MCP_ERROR_CODES_SCRIPT.make_error(
			MCP_ERROR_CODES_SCRIPT.FILE_NOT_FOUND,
			{"requested_path": "res://items/missing.tres"}
		),
	}

	var response: Dictionary = dispatcher.dispatch({
		"jsonrpc": "2.0",
		"method": "resource.load",
		"params": {"path": "res://items/missing.tres"},
		"id": 7,
	})

	assert_true(response.has("error"), "Backend error must be hoisted to JSON-RPC error response")
	var err: Dictionary = response["error"]
	assert_eq(
		err.get("code", 0),
		MCP_ERROR_CODES_SCRIPT.FILE_NOT_FOUND,
		"Error code must be FILE_NOT_FOUND"
	)


# ---------------------------------------------------------------------------
# 9) By-position (Array) params — forward just like by-name
# ---------------------------------------------------------------------------

func test_resource_save_accepts_by_position_params() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorResourceBackend = env["backend"]

	var _result: Variant = tools.save(["res://items/copper_ore.tres", {"id": "copper_ore"}])

	var call: Dictionary = backend.find_calls("save_resource")[0]
	assert_eq(call.get("path", ""), "res://items/copper_ore.tres", "by-position path forwarded")
	assert_eq(
		(call.get("fields", {}) as Dictionary).get("id", ""),
		"copper_ore",
		"by-position fields forwarded"
	)


func test_resource_duplicate_accepts_by_position_params_with_transform() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorResourceBackend = env["backend"]

	var _result: Variant = tools.duplicate([
		"res://items/iron_ore.tres",
		"res://items/copper_ore.tres",
		{"id": "copper_ore"},
	])

	var call: Dictionary = backend.find_calls("duplicate_resource")[0]
	assert_eq(call.get("source", ""), "res://items/iron_ore.tres", "by-position source forwarded")
	assert_eq(call.get("target", ""), "res://items/copper_ore.tres", "by-position target forwarded")
	assert_eq(
		(call.get("transform", {}) as Dictionary).get("id", ""),
		"copper_ore",
		"by-position transform forwarded"
	)
