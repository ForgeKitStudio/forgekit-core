extends GutTest
## Unit tests for McpEditorRefactorTools: JSON-RPC handler adapter that
## exposes the 5 editor-channel Refactor MCP tools on top of a duck-typed
## EditorRefactorBackend.
##
##   refactor.rename_class(old_name, new_name)              → {files_changed}
##   refactor.rename_method(class_name, old, new)           → {files_changed}
##   refactor.move_file(from, to, update_refs?)             → {moved, refs_updated}
##   refactor.find_unused_assets(root?)                     → {unused}
##   refactor.organize_imports(path)                        → {modified}
##
## The adapter extracts parameters from each JSON-RPC `params` payload,
## calls the matching backend method, and returns the backend's result
## verbatim. Business-level errors surface as `{"error": {...}}` envelopes
## that the dispatcher hoists to JSON-RPC error responses.


const REFACTOR_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/tools/refactor_tools.gd")
const DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")
const MCP_ERROR_CODES_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/mcp_error_codes.gd")


# ---------------------------------------------------------------------------
# FakeEditorRefactorBackend — records every call and returns either a canned
# success payload or an injected override.
# ---------------------------------------------------------------------------

class FakeEditorRefactorBackend:
	extends RefCounted

	var calls: Array = []
	var overrides: Dictionary = {}

	func rename_class(old_name: String, new_name: String) -> Variant:
		calls.append({"op": "rename_class", "old_name": old_name, "new_name": new_name})
		if overrides.has("rename_class"):
			return overrides["rename_class"]
		return {"files_changed": ["res://scripts/a.gd", "res://scenes/a.tscn"]}

	func rename_method(class_name_: String, old_name: String, new_name: String) -> Variant:
		calls.append({"op": "rename_method", "class_name": class_name_, "old_name": old_name, "new_name": new_name})
		if overrides.has("rename_method"):
			return overrides["rename_method"]
		return {"files_changed": ["res://scripts/caller.gd"]}

	func move_file(from_path: String, to_path: String, update_refs: bool) -> Variant:
		calls.append({"op": "move_file", "from": from_path, "to": to_path, "update_refs": update_refs})
		if overrides.has("move_file"):
			return overrides["move_file"]
		return {"moved": true, "refs_updated": 3 if update_refs else 0}

	func find_unused_assets(root: String) -> Variant:
		calls.append({"op": "find_unused_assets", "root": root})
		if overrides.has("find_unused_assets"):
			return overrides["find_unused_assets"]
		return {"unused": ["res://sprites/unused.png"]}

	func organize_imports(path: String) -> Variant:
		calls.append({"op": "organize_imports", "path": path})
		if overrides.has("organize_imports"):
			return overrides["organize_imports"]
		return {"modified": true}

	func find_calls(op: String) -> Array:
		var out: Array = []
		for c in calls:
			if (c as Dictionary).get("op", "") == op:
				out.append(c)
		return out


func _new_env() -> Dictionary:
	var backend: FakeEditorRefactorBackend = FakeEditorRefactorBackend.new()
	var tools: Object = REFACTOR_TOOLS_SCRIPT.new(backend)
	return {"backend": backend, "tools": tools}


# ---------------------------------------------------------------------------
# 1) refactor.rename_class — forwards old_name and new_name
# ---------------------------------------------------------------------------

func test_rename_class_forwards_old_and_new_names() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorRefactorBackend = env["backend"]

	var result: Variant = tools.rename_class({"old_name": "OldCls", "new_name": "NewCls"})

	var renames: Array = backend.find_calls("rename_class")
	assert_eq(renames.size(), 1, "Backend.rename_class must be called once")
	var call: Dictionary = renames[0]
	assert_eq(call.get("old_name", ""), "OldCls", "old_name must be forwarded")
	assert_eq(call.get("new_name", ""), "NewCls", "new_name must be forwarded")
	assert_true(result is Dictionary and (result as Dictionary).has("files_changed"), "Result must include files_changed")
	assert_eq(((result as Dictionary).get("files_changed", []) as Array).size(), 2, "Result must carry backend files_changed list")


# ---------------------------------------------------------------------------
# 2) refactor.rename_method — forwards class_name, old, new
# ---------------------------------------------------------------------------

func test_rename_method_forwards_all_three_params() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorRefactorBackend = env["backend"]

	var result: Variant = tools.rename_method({"class_name": "Player", "old": "move", "new": "translate"})

	var renames: Array = backend.find_calls("rename_method")
	assert_eq(renames.size(), 1, "Backend.rename_method must be called once")
	var call: Dictionary = renames[0]
	assert_eq(call.get("class_name", ""), "Player", "class_name must be forwarded")
	assert_eq(call.get("old_name", ""), "move", "old must be forwarded")
	assert_eq(call.get("new_name", ""), "translate", "new must be forwarded")
	assert_true((result as Dictionary).has("files_changed"), "Result must include files_changed")


# ---------------------------------------------------------------------------
# 3) refactor.move_file — forwards from, to, update_refs=true
# ---------------------------------------------------------------------------

func test_move_file_forwards_paths_and_update_refs_true() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorRefactorBackend = env["backend"]

	var result: Variant = tools.move_file({
		"from": "res://scripts/a.gd",
		"to": "res://scripts/b.gd",
		"update_refs": true,
	})

	var moves: Array = backend.find_calls("move_file")
	assert_eq(moves.size(), 1, "Backend.move_file must be called once")
	var call: Dictionary = moves[0]
	assert_eq(call.get("from", ""), "res://scripts/a.gd", "from path must be forwarded")
	assert_eq(call.get("to", ""), "res://scripts/b.gd", "to path must be forwarded")
	assert_eq(call.get("update_refs", false), true, "update_refs must be forwarded verbatim")
	assert_eq((result as Dictionary).get("refs_updated", 0), 3, "refs_updated must reflect backend result")


# ---------------------------------------------------------------------------
# 4) refactor.move_file — defaults update_refs to false when absent
# ---------------------------------------------------------------------------

func test_move_file_defaults_update_refs_false_when_absent() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorRefactorBackend = env["backend"]

	var _result: Variant = tools.move_file({"from": "res://a.gd", "to": "res://b.gd"})

	var moves: Array = backend.find_calls("move_file")
	assert_eq(moves.size(), 1, "Backend.move_file must be called once")
	assert_eq((moves[0] as Dictionary).get("update_refs", true), false, "Missing update_refs must default to false")


# ---------------------------------------------------------------------------
# 5) refactor.find_unused_assets — forwards root param, defaults to ""
# ---------------------------------------------------------------------------

func test_find_unused_assets_forwards_root_and_defaults_to_empty_string() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorRefactorBackend = env["backend"]

	var _result: Variant = tools.find_unused_assets({"root": "res://sprites"})
	var _result2: Variant = tools.find_unused_assets({})

	var finds: Array = backend.find_calls("find_unused_assets")
	assert_eq(finds.size(), 2, "Backend.find_unused_assets must be called twice")
	assert_eq((finds[0] as Dictionary).get("root", ""), "res://sprites", "root must be forwarded")
	assert_eq((finds[1] as Dictionary).get("root", "__missing"), "", "Missing root must default to empty string")


# ---------------------------------------------------------------------------
# 6) refactor.organize_imports — forwards path
# ---------------------------------------------------------------------------

func test_organize_imports_forwards_path() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorRefactorBackend = env["backend"]

	var result: Variant = tools.organize_imports({"path": "res://scripts/player.gd"})

	var organizes: Array = backend.find_calls("organize_imports")
	assert_eq(organizes.size(), 1, "Backend.organize_imports must be called once")
	assert_eq((organizes[0] as Dictionary).get("path", ""), "res://scripts/player.gd", "path must be forwarded")
	assert_eq((result as Dictionary).get("modified", null), true, "Result must carry backend modified flag")


# ---------------------------------------------------------------------------
# 7) rename_class — passes through FILE_NOT_FOUND envelope from the backend
# ---------------------------------------------------------------------------

func test_rename_class_passes_through_error_envelope() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorRefactorBackend = env["backend"]

	backend.overrides["rename_class"] = {
		"error": MCP_ERROR_CODES_SCRIPT.make_error(
			MCP_ERROR_CODES_SCRIPT.CORE_BOUNDARY_VIOLATION,
			{"path": "res://addons/forgekit_core/resources/item.gd"}
		),
	}

	var result: Variant = tools.rename_class({"old_name": "Item", "new_name": "Thing"})

	assert_true(result is Dictionary, "rename_class() must return a Dictionary")
	assert_true((result as Dictionary).has("error"), "Result must carry an 'error' envelope when backend returns one")
	var err: Dictionary = (result as Dictionary).get("error", {})
	assert_eq(err.get("code", 0), MCP_ERROR_CODES_SCRIPT.CORE_BOUNDARY_VIOLATION, "Envelope must carry CORE_BOUNDARY_VIOLATION code")


# ---------------------------------------------------------------------------
# 8) register_on — wires all 5 refactor MCP method names on the dispatcher
# ---------------------------------------------------------------------------

func test_register_on_wires_all_five_refactor_methods() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var dispatcher: Object = DISPATCHER_SCRIPT.new()

	tools.register_on(dispatcher)

	var expected_methods: Array = [
		{"method": "refactor.rename_class", "params": {"old_name": "A", "new_name": "B"}},
		{"method": "refactor.rename_method", "params": {"class_name": "C", "old": "x", "new": "y"}},
		{"method": "refactor.move_file", "params": {"from": "res://a.gd", "to": "res://b.gd"}},
		{"method": "refactor.find_unused_assets", "params": {}},
		{"method": "refactor.organize_imports", "params": {"path": "res://a.gd"}},
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
# 9) Dispatcher hoists a CORE_BOUNDARY_VIOLATION envelope from the backend
#    into a top-level JSON-RPC error response.
# ---------------------------------------------------------------------------

func test_dispatcher_hoists_core_boundary_violation_from_backend() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorRefactorBackend = env["backend"]
	var dispatcher: Object = DISPATCHER_SCRIPT.new()
	tools.register_on(dispatcher)

	backend.overrides["move_file"] = {
		"error": MCP_ERROR_CODES_SCRIPT.make_error(
			MCP_ERROR_CODES_SCRIPT.CORE_BOUNDARY_VIOLATION,
			{"path": "res://addons/forgekit_core/resources/item.gd"}
		),
	}

	var response: Dictionary = dispatcher.dispatch({
		"jsonrpc": "2.0",
		"method": "refactor.move_file",
		"params": {"from": "res://addons/forgekit_core/resources/item.gd", "to": "res://addons/forgekit_rpg/item.gd"},
		"id": 7,
	})

	assert_false(response.has("result"), "Business-error response must not carry 'result'")
	assert_true(response.has("error"), "Business-error response must carry 'error'")
	var err: Dictionary = response["error"]
	assert_eq(err.get("code", 0), MCP_ERROR_CODES_SCRIPT.CORE_BOUNDARY_VIOLATION, "Error code must be -32002 CORE_BOUNDARY_VIOLATION")
	assert_eq(response.get("id", null), 7, "Error envelope must echo the request id")
