extends GutTest
## Unit tests for McpEditorNodeTools: JSON-RPC handler adapter that exposes
## the 13 editor-channel Node MCP tools on top of a duck-typed
## EditorNodeBackend.
##
## The adapter extracts parameters from each JSON-RPC `params` payload, calls
## the matching backend method, and returns the backend's result verbatim.
## Business-level errors surface as `{"error": {...}}` envelopes that the
## dispatcher hoists to JSON-RPC error responses.


const NODE_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/tools/node_tools.gd")
const DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")
const MCP_ERROR_CODES_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/mcp_error_codes.gd")


# ---------------------------------------------------------------------------
# FakeEditorNodeBackend — records every call and returns either a canned
# success payload or an injected override. Each method in the real backend
# wraps EditorInterface / EditorUndoRedoManager calls; tests only care that
# the adapter forwards parameters verbatim and that the backend's result
# (or `{"error": {...}}` envelope) is returned unchanged.
# ---------------------------------------------------------------------------

class FakeEditorNodeBackend:
	extends RefCounted

	var calls: Array = []
	var overrides: Dictionary = {}

	func add_node(scene_path: String, parent_path: String, type: String, name: String, properties: Variant) -> Variant:
		calls.append({
			"op": "add_node",
			"scene_path": scene_path,
			"parent_path": parent_path,
			"type": type,
			"name": name,
			"properties": properties,
		})
		if overrides.has("add_node"):
			return overrides["add_node"]
		return {"node_path": "%s/%s" % [parent_path, name]}

	func remove_node(scene_path: String, node_path: String) -> Variant:
		calls.append({"op": "remove_node", "scene_path": scene_path, "node_path": node_path})
		if overrides.has("remove_node"):
			return overrides["remove_node"]
		return {"removed_path": node_path}

	func set_node_property(scene_path: String, node_path: String, property: String, value: Variant) -> Variant:
		calls.append({
			"op": "set_node_property",
			"scene_path": scene_path,
			"node_path": node_path,
			"property": property,
			"value": value,
		})
		if overrides.has("set_node_property"):
			return overrides["set_node_property"]
		return {"property": property, "previous_value": null, "new_value": value}

	func get_node_property(scene_path: String, node_path: String, property: String) -> Variant:
		calls.append({
			"op": "get_node_property",
			"scene_path": scene_path,
			"node_path": node_path,
			"property": property,
		})
		if overrides.has("get_node_property"):
			return overrides["get_node_property"]
		return {"property": property, "value": "default"}

	func get_node_properties(scene_path: String, node_path: String) -> Variant:
		calls.append({
			"op": "get_node_properties",
			"scene_path": scene_path,
			"node_path": node_path,
		})
		if overrides.has("get_node_properties"):
			return overrides["get_node_properties"]
		return {"properties": {"name": "Player", "position": [0, 0, 0]}}

	func rename_node(scene_path: String, node_path: String, new_name: String) -> Variant:
		calls.append({
			"op": "rename_node",
			"scene_path": scene_path,
			"node_path": node_path,
			"new_name": new_name,
		})
		if overrides.has("rename_node"):
			return overrides["rename_node"]
		var parent: String = node_path.get_base_dir()
		return {"previous_path": node_path, "new_path": "%s/%s" % [parent, new_name]}

	func reparent_node(scene_path: String, node_path: String, new_parent_path: String) -> Variant:
		calls.append({
			"op": "reparent_node",
			"scene_path": scene_path,
			"node_path": node_path,
			"new_parent_path": new_parent_path,
		})
		if overrides.has("reparent_node"):
			return overrides["reparent_node"]
		return {"previous_path": node_path, "new_path": "%s/%s" % [new_parent_path, node_path.get_file()]}

	func duplicate_node(scene_path: String, node_path: String, new_name: String) -> Variant:
		calls.append({
			"op": "duplicate_node",
			"scene_path": scene_path,
			"node_path": node_path,
			"new_name": new_name,
		})
		if overrides.has("duplicate_node"):
			return overrides["duplicate_node"]
		var parent: String = node_path.get_base_dir()
		return {"source_path": node_path, "duplicated_path": "%s/%s" % [parent, new_name]}

	func find_by_type(scene_path: String, type: String, root_path: String) -> Variant:
		calls.append({
			"op": "find_by_type",
			"scene_path": scene_path,
			"type": type,
			"root_path": root_path,
		})
		if overrides.has("find_by_type"):
			return overrides["find_by_type"]
		return {"matches": ["%s/Match1" % root_path, "%s/Match2" % root_path]}

	func find_by_name(scene_path: String, pattern: String, root_path: String, regex: bool) -> Variant:
		calls.append({
			"op": "find_by_name",
			"scene_path": scene_path,
			"pattern": pattern,
			"root_path": root_path,
			"regex": regex,
		})
		if overrides.has("find_by_name"):
			return overrides["find_by_name"]
		return {"matches": ["%s/MatchByName" % root_path]}

	func get_node_signals(scene_path: String, node_path: String) -> Variant:
		calls.append({"op": "get_node_signals", "scene_path": scene_path, "node_path": node_path})
		if overrides.has("get_node_signals"):
			return overrides["get_node_signals"]
		return {"signals": [{"name": "pressed", "args": []}]}

	func connect_node_signal(scene_path: String, source_path: String, signal_name: String, target_path: String, method: String) -> Variant:
		calls.append({
			"op": "connect_node_signal",
			"scene_path": scene_path,
			"source_path": source_path,
			"signal_name": signal_name,
			"target_path": target_path,
			"method": method,
		})
		if overrides.has("connect_node_signal"):
			return overrides["connect_node_signal"]
		return {"connected": true}

	func disconnect_node_signal(scene_path: String, source_path: String, signal_name: String, target_path: String, method: String) -> Variant:
		calls.append({
			"op": "disconnect_node_signal",
			"scene_path": scene_path,
			"source_path": source_path,
			"signal_name": signal_name,
			"target_path": target_path,
			"method": method,
		})
		if overrides.has("disconnect_node_signal"):
			return overrides["disconnect_node_signal"]
		return {"disconnected": true}

	func find_calls(op: String) -> Array:
		var out: Array = []
		for c in calls:
			if (c as Dictionary).get("op", "") == op:
				out.append(c)
		return out


func _new_env() -> Dictionary:
	var backend: FakeEditorNodeBackend = FakeEditorNodeBackend.new()
	var tools: Object = NODE_TOOLS_SCRIPT.new(backend)
	return {"backend": backend, "tools": tools}


# ---------------------------------------------------------------------------
# 1) node.add — forwards all five params including properties
# ---------------------------------------------------------------------------

func test_add_forwards_all_params_and_returns_backend_payload() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorNodeBackend = env["backend"]

	var props: Dictionary = {"position": "Vector3(1, 2, 3)"}
	var result: Variant = tools.add({
		"scene_path": "res://levels/forest.tscn",
		"parent_path": "/root/Forest",
		"type": "Node3D",
		"name": "Rock",
		"properties": props,
	})

	var adds: Array = backend.find_calls("add_node")
	assert_eq(adds.size(), 1, "Backend.add_node must be called once")
	var call: Dictionary = adds[0]
	assert_eq(call.get("scene_path", ""), "res://levels/forest.tscn", "scene_path forwarded")
	assert_eq(call.get("parent_path", ""), "/root/Forest", "parent_path forwarded")
	assert_eq(call.get("type", ""), "Node3D", "type forwarded")
	assert_eq(call.get("name", ""), "Rock", "name forwarded")
	assert_eq(call.get("properties", null), props, "properties forwarded verbatim")
	assert_eq((result as Dictionary).get("node_path", ""), "/root/Forest/Rock", "Backend payload returned")


# ---------------------------------------------------------------------------
# 2) node.add — defaults properties to an empty Dictionary when absent
# ---------------------------------------------------------------------------

func test_add_defaults_properties_to_empty_dict_when_absent() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorNodeBackend = env["backend"]

	var _result: Variant = tools.add({
		"scene_path": "res://levels/forest.tscn",
		"parent_path": "/root/Forest",
		"type": "Node3D",
		"name": "Rock",
	})

	var call: Dictionary = backend.find_calls("add_node")[0]
	var props: Variant = call.get("properties", null)
	assert_true(props is Dictionary, "Missing properties must default to an empty Dictionary")
	assert_eq((props as Dictionary).size(), 0, "Default properties must be empty")


# ---------------------------------------------------------------------------
# 3) node.remove — forwards scene_path and node_path
# ---------------------------------------------------------------------------

func test_remove_forwards_scene_path_and_node_path() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorNodeBackend = env["backend"]

	var result: Variant = tools.remove({
		"scene_path": "res://levels/forest.tscn",
		"node_path": "/root/Forest/Rock",
	})

	var call: Dictionary = backend.find_calls("remove_node")[0]
	assert_eq(call.get("scene_path", ""), "res://levels/forest.tscn", "scene_path forwarded")
	assert_eq(call.get("node_path", ""), "/root/Forest/Rock", "node_path forwarded")
	assert_eq((result as Dictionary).get("removed_path", ""), "/root/Forest/Rock", "Backend payload returned")


# ---------------------------------------------------------------------------
# 4) node.set_property — forwards value VERBATIM when non-String (already parsed)
# ---------------------------------------------------------------------------

func test_set_property_forwards_non_string_value_verbatim() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorNodeBackend = env["backend"]

	var _result: Variant = tools.set_property({
		"scene_path": "res://levels/forest.tscn",
		"node_path": "/root/Forest/Player",
		"property": "visible",
		"value": true,
	})

	var call: Dictionary = backend.find_calls("set_node_property")[0]
	assert_eq(call.get("value", null), true, "Boolean value must be forwarded verbatim")


# ---------------------------------------------------------------------------
# 5) node.set_property — forwards String value VERBATIM so the backend can
#    route it through Smart_Type_Parser (no eval, closed grammar).
# ---------------------------------------------------------------------------

func test_set_property_forwards_string_value_to_backend_for_smart_type_parsing() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorNodeBackend = env["backend"]

	var _result: Variant = tools.set_property({
		"scene_path": "res://levels/forest.tscn",
		"node_path": "/root/Forest/Player",
		"property": "position",
		"value": "Vector3(12.5, 0, -4)",
	})

	var call: Dictionary = backend.find_calls("set_node_property")[0]
	assert_eq(call.get("property", ""), "position", "property forwarded")
	var forwarded_value: Variant = call.get("value", null)
	assert_true(forwarded_value is String, "String values must be forwarded as-is for Smart_Type_Parser on the backend")
	assert_eq(String(forwarded_value), "Vector3(12.5, 0, -4)", "String payload must be forwarded verbatim (no eval, no early parse)")


# ---------------------------------------------------------------------------
# 6) node.set_property — passes through INVALID_LITERAL envelope from the
#    backend when Smart_Type_Parser rejects a literal outside the grammar.
# ---------------------------------------------------------------------------

func test_set_property_passes_through_invalid_literal_envelope_from_backend() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorNodeBackend = env["backend"]

	# Backend returns an INVALID_LITERAL-like envelope when Smart_Type_Parser
	# sees a construct outside the closed grammar (e.g. arbitrary code).
	backend.overrides["set_node_property"] = {
		"error": {
			"code": -32006,
			"message": "INVALID_LITERAL",
			"data": {"position": 0, "fragment": "os.system('rm -rf /')"},
		},
	}

	var result: Variant = tools.set_property({
		"scene_path": "res://levels/forest.tscn",
		"node_path": "/root/Forest/Player",
		"property": "position",
		"value": "os.system('rm -rf /')",
	})

	assert_true(result is Dictionary, "Result must be a Dictionary")
	var dict: Dictionary = result as Dictionary
	assert_true(dict.has("error"), "INVALID_LITERAL envelope must propagate to the dispatcher")
	assert_eq((dict["error"] as Dictionary).get("message", ""), "INVALID_LITERAL", "Error message must carry INVALID_LITERAL")


# ---------------------------------------------------------------------------
# 7) node.get_property — forwards all three params
# ---------------------------------------------------------------------------

func test_get_property_forwards_all_three_params() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorNodeBackend = env["backend"]

	var result: Variant = tools.get_property({
		"scene_path": "res://levels/forest.tscn",
		"node_path": "/root/Forest/Player",
		"property": "position",
	})

	var call: Dictionary = backend.find_calls("get_node_property")[0]
	assert_eq(call.get("scene_path", ""), "res://levels/forest.tscn", "scene_path forwarded")
	assert_eq(call.get("node_path", ""), "/root/Forest/Player", "node_path forwarded")
	assert_eq(call.get("property", ""), "position", "property forwarded")
	assert_eq((result as Dictionary).get("property", ""), "position", "Backend payload returned")


# ---------------------------------------------------------------------------
# 8) node.get_properties — forwards scene_path and node_path
# ---------------------------------------------------------------------------

func test_get_properties_forwards_scene_path_and_node_path() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorNodeBackend = env["backend"]

	var result: Variant = tools.get_properties({
		"scene_path": "res://levels/forest.tscn",
		"node_path": "/root/Forest/Player",
	})

	var call: Dictionary = backend.find_calls("get_node_properties")[0]
	assert_eq(call.get("scene_path", ""), "res://levels/forest.tscn", "scene_path forwarded")
	assert_eq(call.get("node_path", ""), "/root/Forest/Player", "node_path forwarded")
	assert_true((result as Dictionary).has("properties"), "Backend payload returned")


# ---------------------------------------------------------------------------
# 9) node.rename — forwards scene_path, node_path, new_name
# ---------------------------------------------------------------------------

func test_rename_forwards_scene_path_node_path_and_new_name() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorNodeBackend = env["backend"]

	var result: Variant = tools.rename({
		"scene_path": "res://levels/forest.tscn",
		"node_path": "/root/Forest/Player",
		"new_name": "Hero",
	})

	var call: Dictionary = backend.find_calls("rename_node")[0]
	assert_eq(call.get("new_name", ""), "Hero", "new_name forwarded")
	assert_eq((result as Dictionary).get("new_path", ""), "/root/Forest/Hero", "Backend payload returned")


# ---------------------------------------------------------------------------
# 10) node.reparent — forwards scene_path, node_path, new_parent_path
# ---------------------------------------------------------------------------

func test_reparent_forwards_all_three_paths() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorNodeBackend = env["backend"]

	var _result: Variant = tools.reparent({
		"scene_path": "res://levels/forest.tscn",
		"node_path": "/root/Forest/Rock",
		"new_parent_path": "/root/Forest/Terrain",
	})

	var call: Dictionary = backend.find_calls("reparent_node")[0]
	assert_eq(call.get("node_path", ""), "/root/Forest/Rock", "node_path forwarded")
	assert_eq(call.get("new_parent_path", ""), "/root/Forest/Terrain", "new_parent_path forwarded")


# ---------------------------------------------------------------------------
# 11) node.duplicate — forwards scene_path, node_path, new_name
# ---------------------------------------------------------------------------

func test_duplicate_forwards_scene_path_node_path_and_new_name() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorNodeBackend = env["backend"]

	var _result: Variant = tools.duplicate({
		"scene_path": "res://levels/forest.tscn",
		"node_path": "/root/Forest/Rock",
		"new_name": "Rock2",
	})

	var call: Dictionary = backend.find_calls("duplicate_node")[0]
	assert_eq(call.get("node_path", ""), "/root/Forest/Rock", "node_path forwarded")
	assert_eq(call.get("new_name", ""), "Rock2", "new_name forwarded")


# ---------------------------------------------------------------------------
# 12) node.find_by_type — forwards scene_path, type, optional root_path
# ---------------------------------------------------------------------------

func test_find_by_type_forwards_scene_path_type_and_root_path() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorNodeBackend = env["backend"]

	var result: Variant = tools.find_by_type({
		"scene_path": "res://levels/forest.tscn",
		"type": "StaticBody3D",
		"root_path": "/root/Forest/Terrain",
	})

	var call: Dictionary = backend.find_calls("find_by_type")[0]
	assert_eq(call.get("type", ""), "StaticBody3D", "type forwarded")
	assert_eq(call.get("root_path", ""), "/root/Forest/Terrain", "root_path forwarded")
	assert_true((result as Dictionary).get("matches", []) is Array, "Backend payload returned")


func test_find_by_type_defaults_root_path_to_empty_when_absent() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorNodeBackend = env["backend"]

	var _result: Variant = tools.find_by_type({
		"scene_path": "res://levels/forest.tscn",
		"type": "StaticBody3D",
	})

	var call: Dictionary = backend.find_calls("find_by_type")[0]
	assert_eq(call.get("root_path", "__missing"), "", "Missing root_path must forward as empty string (full-scene search)")


# ---------------------------------------------------------------------------
# 13) node.find_by_name — forwards pattern, root_path, and regex flag
# ---------------------------------------------------------------------------

func test_find_by_name_forwards_pattern_root_path_and_regex_flag() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorNodeBackend = env["backend"]

	var _result: Variant = tools.find_by_name({
		"scene_path": "res://levels/forest.tscn",
		"pattern": "^Enemy_\\d+$",
		"root_path": "/root/Forest",
		"regex": true,
	})

	var call: Dictionary = backend.find_calls("find_by_name")[0]
	assert_eq(call.get("pattern", ""), "^Enemy_\\d+$", "pattern forwarded verbatim")
	assert_eq(call.get("root_path", ""), "/root/Forest", "root_path forwarded")
	assert_eq(call.get("regex", null), true, "regex flag forwarded")


func test_find_by_name_defaults_regex_to_false_when_absent() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorNodeBackend = env["backend"]

	var _result: Variant = tools.find_by_name({
		"scene_path": "res://levels/forest.tscn",
		"pattern": "Enemy",
	})

	var call: Dictionary = backend.find_calls("find_by_name")[0]
	assert_eq(call.get("regex", null), false, "Missing regex flag must default to false (literal match)")


# ---------------------------------------------------------------------------
# 14) node.get_signals — forwards scene_path and node_path
# ---------------------------------------------------------------------------

func test_get_signals_forwards_scene_path_and_node_path() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorNodeBackend = env["backend"]

	var result: Variant = tools.get_signals({
		"scene_path": "res://levels/forest.tscn",
		"node_path": "/root/Forest/Button",
	})

	var call: Dictionary = backend.find_calls("get_node_signals")[0]
	assert_eq(call.get("node_path", ""), "/root/Forest/Button", "node_path forwarded")
	assert_true((result as Dictionary).get("signals", []) is Array, "Backend payload returned")


# ---------------------------------------------------------------------------
# 15) node.connect_signal — forwards all five params
# ---------------------------------------------------------------------------

func test_connect_signal_forwards_all_five_params() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorNodeBackend = env["backend"]

	var _result: Variant = tools.connect_signal({
		"scene_path": "res://levels/forest.tscn",
		"source_path": "/root/Forest/Button",
		"signal_name": "pressed",
		"target_path": "/root/Forest/Controller",
		"method": "on_button_pressed",
	})

	var call: Dictionary = backend.find_calls("connect_node_signal")[0]
	assert_eq(call.get("source_path", ""), "/root/Forest/Button", "source_path forwarded")
	assert_eq(call.get("signal_name", ""), "pressed", "signal_name forwarded")
	assert_eq(call.get("target_path", ""), "/root/Forest/Controller", "target_path forwarded")
	assert_eq(call.get("method", ""), "on_button_pressed", "method forwarded")


# ---------------------------------------------------------------------------
# 16) node.disconnect_signal — forwards all five params
# ---------------------------------------------------------------------------

func test_disconnect_signal_forwards_all_five_params() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorNodeBackend = env["backend"]

	var _result: Variant = tools.disconnect_signal({
		"scene_path": "res://levels/forest.tscn",
		"source_path": "/root/Forest/Button",
		"signal_name": "pressed",
		"target_path": "/root/Forest/Controller",
		"method": "on_button_pressed",
	})

	var call: Dictionary = backend.find_calls("disconnect_node_signal")[0]
	assert_eq(call.get("signal_name", ""), "pressed", "signal_name forwarded")
	assert_eq(call.get("method", ""), "on_button_pressed", "method forwarded")


# ---------------------------------------------------------------------------
# 17) Business-error pass-through — FILE_NOT_FOUND envelope from any handler
# ---------------------------------------------------------------------------

func test_add_passes_through_file_not_found_envelope() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorNodeBackend = env["backend"]
	backend.overrides["add_node"] = {
		"error": MCP_ERROR_CODES_SCRIPT.make_error(
			MCP_ERROR_CODES_SCRIPT.FILE_NOT_FOUND,
			{"requested_path": "res://levels/missing.tscn"}
		),
	}

	var result: Variant = tools.add({
		"scene_path": "res://levels/missing.tscn",
		"parent_path": "/root/Forest",
		"type": "Node3D",
		"name": "Rock",
	})

	assert_true((result as Dictionary).has("error"), "FILE_NOT_FOUND envelope must propagate")


# ---------------------------------------------------------------------------
# 18) register_on — wires all 13 editor-channel Node MCP method names
# ---------------------------------------------------------------------------

func test_register_on_wires_all_thirteen_editor_node_methods() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var dispatcher: Object = DISPATCHER_SCRIPT.new()

	tools.register_on(dispatcher)

	var expected: Array = [
		{"method": "node.add", "params": {"scene_path": "a", "parent_path": "b", "type": "Node", "name": "n"}},
		{"method": "node.remove", "params": {"scene_path": "a", "node_path": "b"}},
		{"method": "node.set_property", "params": {"scene_path": "a", "node_path": "b", "property": "p", "value": 1}},
		{"method": "node.get_property", "params": {"scene_path": "a", "node_path": "b", "property": "p"}},
		{"method": "node.get_properties", "params": {"scene_path": "a", "node_path": "b"}},
		{"method": "node.rename", "params": {"scene_path": "a", "node_path": "b", "new_name": "n"}},
		{"method": "node.reparent", "params": {"scene_path": "a", "node_path": "b", "new_parent_path": "c"}},
		{"method": "node.duplicate", "params": {"scene_path": "a", "node_path": "b", "new_name": "n2"}},
		{"method": "node.find_by_type", "params": {"scene_path": "a", "type": "Node"}},
		{"method": "node.find_by_name", "params": {"scene_path": "a", "pattern": "x"}},
		{"method": "node.get_signals", "params": {"scene_path": "a", "node_path": "b"}},
		{"method": "node.connect_signal", "params": {"scene_path": "a", "source_path": "s", "signal_name": "sig", "target_path": "t", "method": "m"}},
		{"method": "node.disconnect_signal", "params": {"scene_path": "a", "source_path": "s", "signal_name": "sig", "target_path": "t", "method": "m"}},
	]

	assert_eq(expected.size(), 13, "Editor-channel Node MCP surface must be 13 methods")

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
# 19) Dispatcher hoists a business-error envelope from the backend into a
#     top-level JSON-RPC error response (integration with scene_tools pattern).
# ---------------------------------------------------------------------------

func test_dispatcher_hoists_core_boundary_violation_from_backend() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorNodeBackend = env["backend"]
	var dispatcher: Object = DISPATCHER_SCRIPT.new()
	tools.register_on(dispatcher)

	backend.overrides["set_node_property"] = {
		"error": MCP_ERROR_CODES_SCRIPT.make_error(
			MCP_ERROR_CODES_SCRIPT.CORE_BOUNDARY_VIOLATION,
			{"path": "res://addons/forgekit_core/event_bus/game_events.gd"}
		),
	}

	var response: Dictionary = dispatcher.dispatch({
		"jsonrpc": "2.0",
		"method": "node.set_property",
		"params": {
			"scene_path": "res://addons/forgekit_core/demo.tscn",
			"node_path": "/root/Demo",
			"property": "script",
			"value": "res://addons/forgekit_core/event_bus/game_events.gd",
		},
		"id": 99,
	})

	assert_true(response.has("error"), "Business error must be hoisted into JSON-RPC error")
	var err: Dictionary = response["error"]
	assert_eq(err.get("code", 0), MCP_ERROR_CODES_SCRIPT.CORE_BOUNDARY_VIOLATION, "Error code must be CORE_BOUNDARY_VIOLATION")
