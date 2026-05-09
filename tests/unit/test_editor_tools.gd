extends GutTest
## Unit tests for McpEditorTools: JSON-RPC handler adapter that exposes the
## nine editor-channel Editor MCP tools on top of a duck-typed
## EditorEditorBackend.
##
##   editor.get_selection()                      → {selected}
##   editor.set_selection(node_paths)            → {selected}
##   editor.focus_node(node_path)                → {focused: true}
##   editor.get_output_log(max_lines?)           → {lines}
##   editor.get_errors()                         → {errors}
##   editor.clear_output()                       → {cleared: true}
##   editor.undo()                               → {undone, action_name}
##   editor.redo()                               → {redone, action_name}
##   editor.get_undo_stack(max?)                 → {entries}
##
## Plus the canonical `UPDATE_AVAILABLE` entry shape used by the MCP Server
## when it detects a newer ForgeKit_Core or @forgekitstudio/core-mcp release and
## wants the entry to appear in the editor output log.


const EDITOR_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/tools/editor_tools.gd")
const DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")
const MCP_ERROR_CODES_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/mcp_error_codes.gd")


# ---------------------------------------------------------------------------
# FakeEditorEditorBackend — records every call and returns either a canned
# success payload or an injected override.
# ---------------------------------------------------------------------------

class FakeEditorEditorBackend:
	extends RefCounted

	var calls: Array = []
	var overrides: Dictionary = {}
	var log_lines: Array = []
	var errors: Array = []
	var undo_stack: Array = []

	func get_selection() -> Variant:
		calls.append({"op": "get_selection"})
		if overrides.has("get_selection"):
			return overrides["get_selection"]
		return {"selected": ["/root/Main/Player"]}

	func set_selection(node_paths: Array) -> Variant:
		calls.append({"op": "set_selection", "node_paths": node_paths})
		if overrides.has("set_selection"):
			return overrides["set_selection"]
		return {"selected": node_paths}

	func focus_node(node_path: String) -> Variant:
		calls.append({"op": "focus_node", "node_path": node_path})
		if overrides.has("focus_node"):
			return overrides["focus_node"]
		return {"focused": true}

	func get_output_log(max_lines: int) -> Variant:
		calls.append({"op": "get_output_log", "max_lines": max_lines})
		if overrides.has("get_output_log"):
			return overrides["get_output_log"]
		var slice: Array = log_lines.duplicate()
		if max_lines >= 0 and slice.size() > max_lines:
			slice = slice.slice(slice.size() - max_lines, slice.size())
		return {"lines": slice}

	func get_errors() -> Variant:
		calls.append({"op": "get_errors"})
		if overrides.has("get_errors"):
			return overrides["get_errors"]
		return {"errors": errors}

	func clear_output() -> Variant:
		calls.append({"op": "clear_output"})
		if overrides.has("clear_output"):
			return overrides["clear_output"]
		log_lines.clear()
		return {"cleared": true}

	func undo() -> Variant:
		calls.append({"op": "undo"})
		if overrides.has("undo"):
			return overrides["undo"]
		return {"undone": true, "action_name": "MCP: node.add /root/Main/Rock"}

	func redo() -> Variant:
		calls.append({"op": "redo"})
		if overrides.has("redo"):
			return overrides["redo"]
		return {"redone": true, "action_name": "MCP: node.add /root/Main/Rock"}

	func get_undo_stack(max_entries: int) -> Variant:
		calls.append({"op": "get_undo_stack", "max_entries": max_entries})
		if overrides.has("get_undo_stack"):
			return overrides["get_undo_stack"]
		var entries: Array = undo_stack.duplicate()
		if max_entries >= 0 and entries.size() > max_entries:
			entries = entries.slice(entries.size() - max_entries, entries.size())
		return {"entries": entries}

	func find_calls(op: String) -> Array:
		var out: Array = []
		for c in calls:
			if (c as Dictionary).get("op", "") == op:
				out.append(c)
		return out


func _new_env() -> Dictionary:
	var backend: FakeEditorEditorBackend = FakeEditorEditorBackend.new()
	var tools: Object = EDITOR_TOOLS_SCRIPT.new(backend)
	return {"backend": backend, "tools": tools}


# ---------------------------------------------------------------------------
# 1) editor.get_selection — returns backend payload
# ---------------------------------------------------------------------------

func test_get_selection_returns_backend_payload() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorEditorBackend = env["backend"]

	var result: Variant = tools.get_selection({})

	var selection_calls: Array = backend.find_calls("get_selection")
	assert_eq(selection_calls.size(), 1, "Backend.get_selection must be called once")
	assert_true(result is Dictionary, "Result must be a Dictionary")
	assert_true((result as Dictionary).get("selected", []) is Array, "Backend payload exposes 'selected' array")


# ---------------------------------------------------------------------------
# 2) editor.set_selection — forwards node_paths
# ---------------------------------------------------------------------------

func test_set_selection_forwards_node_paths() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorEditorBackend = env["backend"]

	var paths: Array = ["/root/Main/Player", "/root/Main/Enemy"]
	var result: Variant = tools.set_selection({"node_paths": paths})

	var call: Dictionary = backend.find_calls("set_selection")[0]
	assert_eq(call.get("node_paths", []), paths, "node_paths forwarded verbatim")
	assert_eq((result as Dictionary).get("selected", []), paths, "Backend payload returned")


func test_set_selection_defaults_node_paths_to_empty_array_when_absent() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorEditorBackend = env["backend"]

	var _result: Variant = tools.set_selection({})

	var call: Dictionary = backend.find_calls("set_selection")[0]
	var forwarded: Variant = call.get("node_paths", null)
	assert_true(forwarded is Array, "Missing node_paths must default to an empty Array")
	assert_eq((forwarded as Array).size(), 0, "Default node_paths must be empty")


# ---------------------------------------------------------------------------
# 3) editor.focus_node — forwards node_path
# ---------------------------------------------------------------------------

func test_focus_node_forwards_node_path() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorEditorBackend = env["backend"]

	var result: Variant = tools.focus_node({"node_path": "/root/Main/Player"})

	var call: Dictionary = backend.find_calls("focus_node")[0]
	assert_eq(call.get("node_path", ""), "/root/Main/Player", "node_path forwarded")
	assert_eq((result as Dictionary).get("focused", false), true, "Backend payload returned")


# ---------------------------------------------------------------------------
# 4) editor.get_output_log — forwards max_lines when provided
# ---------------------------------------------------------------------------

func test_get_output_log_forwards_max_lines() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorEditorBackend = env["backend"]
	backend.log_lines = [
		{"severity": "info", "text": "line1"},
		{"severity": "info", "text": "line2"},
		{"severity": "info", "text": "line3"},
	]

	var result: Variant = tools.get_output_log({"max_lines": 2})

	var call: Dictionary = backend.find_calls("get_output_log")[0]
	assert_eq(call.get("max_lines", -999), 2, "max_lines forwarded")
	var lines: Array = (result as Dictionary).get("lines", [])
	assert_eq(lines.size(), 2, "Backend honored max_lines cap")


func test_get_output_log_defaults_max_lines_to_minus_one_when_absent() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorEditorBackend = env["backend"]

	var _result: Variant = tools.get_output_log({})

	var call: Dictionary = backend.find_calls("get_output_log")[0]
	assert_eq(call.get("max_lines", -999), -1, "Missing max_lines must forward as -1 (no limit)")


# ---------------------------------------------------------------------------
# 5) editor.get_errors — returns backend payload
# ---------------------------------------------------------------------------

func test_get_errors_returns_backend_payload() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorEditorBackend = env["backend"]
	backend.errors = [
		{"file": "res://game.gd", "line": 42, "msg": "Parse error", "severity": "error"},
	]

	var result: Variant = tools.get_errors({})

	assert_eq(backend.find_calls("get_errors").size(), 1, "Backend.get_errors called once")
	var errors: Array = (result as Dictionary).get("errors", [])
	assert_eq(errors.size(), 1, "Backend errors forwarded")
	assert_eq((errors[0] as Dictionary).get("severity", ""), "error", "Error entry severity preserved")


# ---------------------------------------------------------------------------
# 6) editor.clear_output — calls backend and returns cleared flag
# ---------------------------------------------------------------------------

func test_clear_output_calls_backend_and_returns_flag() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorEditorBackend = env["backend"]
	backend.log_lines = [{"severity": "info", "text": "stale"}]

	var result: Variant = tools.clear_output({})

	assert_eq(backend.find_calls("clear_output").size(), 1, "Backend.clear_output called once")
	assert_eq((result as Dictionary).get("cleared", false), true, "cleared flag returned")
	assert_eq(backend.log_lines.size(), 0, "Backend log buffer drained")


# ---------------------------------------------------------------------------
# 7) editor.undo / editor.redo — return backend payload
# ---------------------------------------------------------------------------

func test_undo_returns_backend_payload() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorEditorBackend = env["backend"]

	var result: Variant = tools.undo({})

	assert_eq(backend.find_calls("undo").size(), 1, "Backend.undo called once")
	assert_eq((result as Dictionary).get("undone", false), true, "undone flag returned")
	assert_true((result as Dictionary).has("action_name"), "action_name included in response")


func test_redo_returns_backend_payload() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorEditorBackend = env["backend"]

	var result: Variant = tools.redo({})

	assert_eq(backend.find_calls("redo").size(), 1, "Backend.redo called once")
	assert_eq((result as Dictionary).get("redone", false), true, "redone flag returned")
	assert_true((result as Dictionary).has("action_name"), "action_name included in response")


# ---------------------------------------------------------------------------
# 8) editor.get_undo_stack — forwards max when provided, defaults to -1
# ---------------------------------------------------------------------------

func test_get_undo_stack_forwards_max() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorEditorBackend = env["backend"]
	backend.undo_stack = [
		{"name": "MCP: node.add /a", "id": 1},
		{"name": "MCP: node.add /b", "id": 2},
		{"name": "MCP: node.add /c", "id": 3},
	]

	var result: Variant = tools.get_undo_stack({"max": 2})

	var call: Dictionary = backend.find_calls("get_undo_stack")[0]
	assert_eq(call.get("max_entries", -999), 2, "max forwarded as max_entries")
	var entries: Array = (result as Dictionary).get("entries", [])
	assert_eq(entries.size(), 2, "Backend honored max cap")


func test_get_undo_stack_defaults_max_to_minus_one_when_absent() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorEditorBackend = env["backend"]

	var _result: Variant = tools.get_undo_stack({})

	var call: Dictionary = backend.find_calls("get_undo_stack")[0]
	assert_eq(call.get("max_entries", -999), -1, "Missing max must forward as -1 (no limit)")


# ---------------------------------------------------------------------------
# 9) UPDATE_AVAILABLE entry shape — canonical builder produces the fields
#     required by the `editor.get_output_log` contract (component, current,
#     latest) so the MCP Server can publish version notifications that flow
#     through the existing log stream.
# ---------------------------------------------------------------------------

func test_build_update_available_entry_has_canonical_shape() -> void:
	var entry: Dictionary = EDITOR_TOOLS_SCRIPT.build_update_available_entry(
		"forgekit_core", "0.1.0", "0.2.0"
	)

	assert_eq(entry.get("kind", ""), "UPDATE_AVAILABLE", "kind tags the entry as UPDATE_AVAILABLE")
	assert_eq(entry.get("severity", ""), "info", "UPDATE_AVAILABLE is informational, not an error")
	assert_eq(entry.get("component", ""), "forgekit_core", "component preserved")
	assert_eq(entry.get("current", ""), "0.1.0", "current preserved")
	assert_eq(entry.get("latest", ""), "0.2.0", "latest preserved")


func test_get_output_log_includes_update_available_entries_from_backend() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorEditorBackend = env["backend"]

	# Simulate the MCP Server publishing an UPDATE_AVAILABLE entry through
	# the backend's output-log buffer. The adapter itself must not filter
	# or transform the entry — it forwards whatever the backend returns.
	var entry: Dictionary = EDITOR_TOOLS_SCRIPT.build_update_available_entry(
		"@forgekitstudio/core-mcp", "0.1.3", "0.2.0"
	)
	backend.log_lines = [entry]

	var result: Variant = tools.get_output_log({})
	var lines: Array = (result as Dictionary).get("lines", [])
	assert_eq(lines.size(), 1, "UPDATE_AVAILABLE entry reaches the caller via get_output_log")
	assert_eq((lines[0] as Dictionary).get("kind", ""), "UPDATE_AVAILABLE", "Entry kind preserved through the adapter")
	assert_eq((lines[0] as Dictionary).get("component", ""), "@forgekitstudio/core-mcp", "component preserved")


# ---------------------------------------------------------------------------
# 10) Business-error pass-through — NON_UNDOABLE_OPERATION from undo backend
# ---------------------------------------------------------------------------

func test_undo_passes_through_non_undoable_operation_envelope() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorEditorBackend = env["backend"]
	backend.overrides["undo"] = {
		"error": MCP_ERROR_CODES_SCRIPT.make_error(MCP_ERROR_CODES_SCRIPT.NON_UNDOABLE_OPERATION),
	}

	var result: Variant = tools.undo({})

	assert_true((result as Dictionary).has("error"), "NON_UNDOABLE_OPERATION envelope must propagate")
	assert_eq(((result as Dictionary)["error"] as Dictionary).get("code", 0),
		MCP_ERROR_CODES_SCRIPT.NON_UNDOABLE_OPERATION,
		"Error code must be NON_UNDOABLE_OPERATION")


# ---------------------------------------------------------------------------
# 11) register_on — wires all 9 editor-channel Editor MCP methods
# ---------------------------------------------------------------------------

func test_register_on_wires_all_nine_editor_methods() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var dispatcher: Object = DISPATCHER_SCRIPT.new()

	tools.register_on(dispatcher)

	var expected: Array = [
		{"method": "editor.get_selection", "params": {}},
		{"method": "editor.set_selection", "params": {"node_paths": ["/root/Main/Player"]}},
		{"method": "editor.focus_node", "params": {"node_path": "/root/Main/Player"}},
		{"method": "editor.get_output_log", "params": {}},
		{"method": "editor.get_errors", "params": {}},
		{"method": "editor.clear_output", "params": {}},
		{"method": "editor.undo", "params": {}},
		{"method": "editor.redo", "params": {}},
		{"method": "editor.get_undo_stack", "params": {}},
	]

	assert_eq(expected.size(), 9, "Editor-channel Editor MCP surface must be 9 methods")

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
# 12) Dispatcher hoists a business-error envelope from the backend into a
#     top-level JSON-RPC error response.
# ---------------------------------------------------------------------------

func test_dispatcher_hoists_non_undoable_operation_from_backend() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorEditorBackend = env["backend"]
	var dispatcher: Object = DISPATCHER_SCRIPT.new()
	tools.register_on(dispatcher)

	backend.overrides["undo"] = {
		"error": MCP_ERROR_CODES_SCRIPT.make_error(MCP_ERROR_CODES_SCRIPT.NON_UNDOABLE_OPERATION),
	}

	var response: Dictionary = dispatcher.dispatch({
		"jsonrpc": "2.0",
		"method": "editor.undo",
		"params": {},
		"id": 99,
	})

	assert_true(response.has("error"), "Business error must be hoisted into JSON-RPC error")
	var err: Dictionary = response["error"]
	assert_eq(err.get("code", 0), MCP_ERROR_CODES_SCRIPT.NON_UNDOABLE_OPERATION,
		"Error code must be NON_UNDOABLE_OPERATION")
