extends GutTest
## Unit tests for McpEditorScriptTools: JSON-RPC handler adapter that exposes
## the eight editor-channel Script MCP tools on top of a duck-typed
## EditorScriptBackend.
##
## Tools:
##   gdscript.validate(source)                        → {ok, errors, duration_ms}
##   gdscript.save_with_validation(path, source)      → {written, path} | {error}
##   script.load(path)                                → {source}
##   script.create(path, source)                      → {created, path} | {error}
##   script.attach(scene_path, node_path, script_path)→ {attached, previous_script}
##   script.detach(scene_path, node_path)             → {detached, previous_script}
##   script.list_classes(path?)                       → {classes: [...]}
##   script.get_documentation(class_name_)            → {documentation}
##
## Undo/Redo is the backend's responsibility — the three mutating tools
## (create, attach, detach) are expected to route through McpUndoRedoWrapper
## inside the production backend. The adapter only forwards parameters
## verbatim and passes the backend's return envelope through unchanged.


const SCRIPT_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/tools/script_tools.gd")
const DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")
const MCP_ERROR_CODES_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/mcp_error_codes.gd")


# ---------------------------------------------------------------------------
# FakeEditorScriptBackend — records every call and returns a canned success
# payload or an injected override. Mirrors the pattern used by the other
# editor-channel tool adapters.
# ---------------------------------------------------------------------------

class FakeEditorScriptBackend:
	extends RefCounted

	var calls: Array = []
	var overrides: Dictionary = {}

	func validate_source(source: String) -> Variant:
		calls.append({"op": "validate_source", "source": source})
		if overrides.has("validate_source"):
			return overrides["validate_source"]
		return {"ok": true, "errors": [], "duration_ms": 1}

	func save_with_validation(path: String, source: String) -> Variant:
		calls.append({"op": "save_with_validation", "path": path, "source": source})
		if overrides.has("save_with_validation"):
			return overrides["save_with_validation"]
		return {"written": true, "path": path}

	func load_script(path: String) -> Variant:
		calls.append({"op": "load_script", "path": path})
		if overrides.has("load_script"):
			return overrides["load_script"]
		return {"source": "# %s\n" % path}

	func create_script(path: String, source: String) -> Variant:
		calls.append({"op": "create_script", "path": path, "source": source})
		if overrides.has("create_script"):
			return overrides["create_script"]
		return {"created": true, "path": path}

	func attach_script(scene_path: String, node_path: String, script_path: String) -> Variant:
		calls.append({
			"op": "attach_script",
			"scene_path": scene_path,
			"node_path": node_path,
			"script_path": script_path,
		})
		if overrides.has("attach_script"):
			return overrides["attach_script"]
		return {"attached": true, "previous_script": ""}

	func detach_script(scene_path: String, node_path: String) -> Variant:
		calls.append({
			"op": "detach_script",
			"scene_path": scene_path,
			"node_path": node_path,
		})
		if overrides.has("detach_script"):
			return overrides["detach_script"]
		return {"detached": true, "previous_script": "res://old.gd"}

	func list_classes(path: String) -> Variant:
		calls.append({"op": "list_classes", "path": path})
		if overrides.has("list_classes"):
			return overrides["list_classes"]
		return {"classes": [{"name": "FakeClass", "path": path}]}

	func get_documentation(class_name_: String) -> Variant:
		calls.append({"op": "get_documentation", "class_name": class_name_})
		if overrides.has("get_documentation"):
			return overrides["get_documentation"]
		return {"documentation": "Docs for %s" % class_name_}

	func find_calls(op: String) -> Array:
		var out: Array = []
		for c in calls:
			if (c as Dictionary).get("op", "") == op:
				out.append(c)
		return out


func _new_env() -> Dictionary:
	var backend: FakeEditorScriptBackend = FakeEditorScriptBackend.new()
	var tools: Object = SCRIPT_TOOLS_SCRIPT.new(backend)
	return {"backend": backend, "tools": tools}


# ---------------------------------------------------------------------------
# 1) gdscript.validate — forwards source and returns validator dict
# ---------------------------------------------------------------------------

func test_gdscript_validate_forwards_source_and_returns_validator_dict() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorScriptBackend = env["backend"]

	var result: Variant = tools.gdscript_validate({"source": "extends RefCounted\n"})

	var call: Dictionary = backend.find_calls("validate_source")[0]
	assert_eq(call.get("source", ""), "extends RefCounted\n", "source must be forwarded verbatim")
	assert_true((result as Dictionary).has("ok"), "Validator dictionary must be returned")
	assert_true((result as Dictionary).has("errors"), "Validator dictionary must include errors list")


# ---------------------------------------------------------------------------
# 2) gdscript.save_with_validation — forwards path + source; returns envelope
# ---------------------------------------------------------------------------

func test_save_with_validation_forwards_path_and_source() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorScriptBackend = env["backend"]

	var result: Variant = tools.save_with_validation({
		"path": "res://scripts/new_script.gd",
		"source": "extends RefCounted\n",
	})

	var call: Dictionary = backend.find_calls("save_with_validation")[0]
	assert_eq(call.get("path", ""), "res://scripts/new_script.gd", "path forwarded")
	assert_eq(call.get("source", ""), "extends RefCounted\n", "source forwarded")
	assert_true((result as Dictionary).get("written", false), "Backend payload returned")


func test_save_with_validation_passes_through_gdscript_syntax_error() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorScriptBackend = env["backend"]
	backend.overrides["save_with_validation"] = {
		"written": false,
		"error": MCP_ERROR_CODES_SCRIPT.make_error(
			MCP_ERROR_CODES_SCRIPT.GDSCRIPT_SYNTAX_ERROR,
			{"path": "res://scripts/broken.gd", "errors": [{"line": 2, "col": 1, "msg": "parse error"}]}
		),
	}

	var result: Variant = tools.save_with_validation({
		"path": "res://scripts/broken.gd",
		"source": "extends RefCounted\nfunc broken(\n",
	})

	assert_true((result as Dictionary).has("error"), "GDSCRIPT_SYNTAX_ERROR envelope must propagate")


func test_save_with_validation_passes_through_core_boundary_violation() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorScriptBackend = env["backend"]
	backend.overrides["save_with_validation"] = {
		"written": false,
		"error": MCP_ERROR_CODES_SCRIPT.make_error(
			MCP_ERROR_CODES_SCRIPT.CORE_BOUNDARY_VIOLATION,
			{"path": "res://addons/forgekit_core/event_bus/game_events.gd"}
		),
	}

	var result: Variant = tools.save_with_validation({
		"path": "res://addons/forgekit_core/event_bus/game_events.gd",
		"source": "extends RefCounted\n",
	})

	var err: Dictionary = (result as Dictionary).get("error", {})
	assert_eq(
		err.get("code", 0),
		MCP_ERROR_CODES_SCRIPT.CORE_BOUNDARY_VIOLATION,
		"CORE_BOUNDARY_VIOLATION must propagate from backend"
	)


# ---------------------------------------------------------------------------
# 3) script.load — forwards path
# ---------------------------------------------------------------------------

func test_script_load_forwards_path_and_returns_source() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorScriptBackend = env["backend"]

	var result: Variant = tools.load({"path": "res://scripts/hero.gd"})

	var call: Dictionary = backend.find_calls("load_script")[0]
	assert_eq(call.get("path", ""), "res://scripts/hero.gd", "path forwarded")
	assert_true((result as Dictionary).has("source"), "source field returned")


# ---------------------------------------------------------------------------
# 4) script.create — forwards path + source
# ---------------------------------------------------------------------------

func test_script_create_forwards_path_and_source() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorScriptBackend = env["backend"]

	var result: Variant = tools.create({
		"path": "res://scripts/new.gd",
		"source": "extends RefCounted\n",
	})

	var call: Dictionary = backend.find_calls("create_script")[0]
	assert_eq(call.get("path", ""), "res://scripts/new.gd", "path forwarded")
	assert_eq(call.get("source", ""), "extends RefCounted\n", "source forwarded")
	assert_true((result as Dictionary).get("created", false), "created flag returned")


# ---------------------------------------------------------------------------
# 5) script.attach — forwards scene_path, node_path, script_path
# ---------------------------------------------------------------------------

func test_script_attach_forwards_all_three_paths() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorScriptBackend = env["backend"]

	var result: Variant = tools.attach({
		"scene_path": "res://levels/forest.tscn",
		"node_path": "/root/Forest/Hero",
		"script_path": "res://scripts/hero.gd",
	})

	var call: Dictionary = backend.find_calls("attach_script")[0]
	assert_eq(call.get("scene_path", ""), "res://levels/forest.tscn", "scene_path forwarded")
	assert_eq(call.get("node_path", ""), "/root/Forest/Hero", "node_path forwarded")
	assert_eq(call.get("script_path", ""), "res://scripts/hero.gd", "script_path forwarded")
	assert_true((result as Dictionary).get("attached", false), "attached flag returned")


# ---------------------------------------------------------------------------
# 6) script.detach — forwards scene_path, node_path
# ---------------------------------------------------------------------------

func test_script_detach_forwards_scene_and_node_path() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorScriptBackend = env["backend"]

	var result: Variant = tools.detach({
		"scene_path": "res://levels/forest.tscn",
		"node_path": "/root/Forest/Hero",
	})

	var call: Dictionary = backend.find_calls("detach_script")[0]
	assert_eq(call.get("scene_path", ""), "res://levels/forest.tscn", "scene_path forwarded")
	assert_eq(call.get("node_path", ""), "/root/Forest/Hero", "node_path forwarded")
	assert_true((result as Dictionary).get("detached", false), "detached flag returned")


# ---------------------------------------------------------------------------
# 7) script.list_classes — path is optional; defaults to empty string
# ---------------------------------------------------------------------------

func test_list_classes_forwards_path_when_present() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorScriptBackend = env["backend"]

	var result: Variant = tools.list_classes({"path": "res://scripts/hero.gd"})

	var call: Dictionary = backend.find_calls("list_classes")[0]
	assert_eq(call.get("path", ""), "res://scripts/hero.gd", "path forwarded")
	assert_true((result as Dictionary).has("classes"), "classes list returned")


func test_list_classes_defaults_path_to_empty_string_when_absent() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorScriptBackend = env["backend"]

	var _result: Variant = tools.list_classes({})

	var call: Dictionary = backend.find_calls("list_classes")[0]
	assert_eq(
		call.get("path", "__missing"),
		"",
		"Missing path must forward as an empty string (whole-project scan)"
	)


# ---------------------------------------------------------------------------
# 8) script.get_documentation — forwards class_name
# ---------------------------------------------------------------------------

func test_get_documentation_forwards_class_name() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorScriptBackend = env["backend"]

	var result: Variant = tools.get_documentation({"class_name": "GameEvents"})

	var call: Dictionary = backend.find_calls("get_documentation")[0]
	assert_eq(call.get("class_name", ""), "GameEvents", "class_name forwarded")
	assert_true((result as Dictionary).has("documentation"), "documentation field returned")


# ---------------------------------------------------------------------------
# 9) Business-error pass-through — FILE_NOT_FOUND envelope from script.load
# ---------------------------------------------------------------------------

func test_load_passes_through_file_not_found_envelope() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorScriptBackend = env["backend"]
	backend.overrides["load_script"] = {
		"error": MCP_ERROR_CODES_SCRIPT.make_error(
			MCP_ERROR_CODES_SCRIPT.FILE_NOT_FOUND,
			{"requested_path": "res://scripts/missing.gd"}
		),
	}

	var result: Variant = tools.load({"path": "res://scripts/missing.gd"})

	assert_true((result as Dictionary).has("error"), "FILE_NOT_FOUND envelope must propagate")


# ---------------------------------------------------------------------------
# 10) register_on — wires all eight Script MCP method names on the dispatcher
# ---------------------------------------------------------------------------

func test_register_on_wires_all_eight_script_methods() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var dispatcher: Object = DISPATCHER_SCRIPT.new()

	tools.register_on(dispatcher)

	var expected: Array = [
		{"method": "gdscript.validate", "params": {"source": "extends RefCounted\n"}},
		{"method": "gdscript.save_with_validation", "params": {"path": "res://a.gd", "source": "extends RefCounted\n"}},
		{"method": "script.load", "params": {"path": "res://a.gd"}},
		{"method": "script.create", "params": {"path": "res://b.gd", "source": "extends RefCounted\n"}},
		{"method": "script.attach", "params": {"scene_path": "res://s.tscn", "node_path": "/root/N", "script_path": "res://a.gd"}},
		{"method": "script.detach", "params": {"scene_path": "res://s.tscn", "node_path": "/root/N"}},
		{"method": "script.list_classes", "params": {"path": "res://a.gd"}},
		{"method": "script.get_documentation", "params": {"class_name": "GameEvents"}},
	]

	assert_eq(expected.size(), 8, "Editor-channel Script MCP surface must be eight methods")

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
# 11) Dispatcher hoists a backend error envelope into a JSON-RPC error response
# ---------------------------------------------------------------------------

func test_dispatcher_hoists_gdscript_syntax_error_from_backend() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorScriptBackend = env["backend"]
	var dispatcher: Object = DISPATCHER_SCRIPT.new()
	tools.register_on(dispatcher)

	backend.overrides["save_with_validation"] = {
		"written": false,
		"error": MCP_ERROR_CODES_SCRIPT.make_error(
			MCP_ERROR_CODES_SCRIPT.GDSCRIPT_SYNTAX_ERROR,
			{"path": "res://scripts/bad.gd", "errors": [{"line": 2, "col": 1, "msg": "parse error"}]}
		),
	}

	var response: Dictionary = dispatcher.dispatch({
		"jsonrpc": "2.0",
		"method": "gdscript.save_with_validation",
		"params": {"path": "res://scripts/bad.gd", "source": "func broken(\n"},
		"id": 7,
	})

	assert_true(response.has("error"), "Backend error must be hoisted to JSON-RPC error response")
	var err: Dictionary = response["error"]
	assert_eq(
		err.get("code", 0),
		MCP_ERROR_CODES_SCRIPT.GDSCRIPT_SYNTAX_ERROR,
		"Error code must be GDSCRIPT_SYNTAX_ERROR"
	)
