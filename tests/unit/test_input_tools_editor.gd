extends GutTest
## Unit tests for McpEditorInputTools: JSON-RPC handler adapter that exposes
## the editor-channel Input MCP tools on top of a duck-typed
## EditorInputBackend.
##
## Covered handlers:
##   input.list_actions()                               → {actions: [{name, deadzone, events}]}
##   input.configure_action(action, events, deadzone?)  → {applied, previous}
##   input.remove_action(action)                        → {removed: true}
##
## The `configure_action` handler is the fix for the known tomyud1 bug where
## the `deadzone` field was silently dropped on update: the production
## backend uses `McpProjectSettingsAtomicWriter` to write events and deadzone
## together, preserving every sibling action.


const INPUT_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/tools/input_tools.gd")
const DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")
const MCP_ERROR_CODES_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/mcp_error_codes.gd")


class FakeEditorInputBackend:
	extends RefCounted

	var calls: Array = []
	var overrides: Dictionary = {}

	func list_actions() -> Variant:
		calls.append({"op": "list_actions"})
		if overrides.has("list_actions"):
			return overrides["list_actions"]
		return {
			"actions": [
				{
					"name": "ui_accept",
					"deadzone": 0.5,
					"events": [{"type": "key", "keycode": 32}],
				},
				{
					"name": "attack",
					"deadzone": 0.2,
					"events": [],
				},
			],
		}

	func configure_action(action: String, events: Array, deadzone: float, deadzone_supplied: bool) -> Variant:
		calls.append({
			"op": "configure_action",
			"action": action,
			"events": events,
			"deadzone": deadzone,
			"deadzone_supplied": deadzone_supplied,
		})
		if overrides.has("configure_action"):
			return overrides["configure_action"]
		return {
			"applied": {
				"events": events,
				"deadzone": deadzone,
			},
			"previous": {
				"events": [],
				"deadzone": 0.5,
			},
		}

	func remove_action(action: String) -> Variant:
		calls.append({"op": "remove_action", "action": action})
		if overrides.has("remove_action"):
			return overrides["remove_action"]
		return {"removed": true}

	func find_calls(op: String) -> Array:
		var out: Array = []
		for c in calls:
			if (c as Dictionary).get("op", "") == op:
				out.append(c)
		return out


func _new_env() -> Dictionary:
	var backend: FakeEditorInputBackend = FakeEditorInputBackend.new()
	var tools: Object = INPUT_TOOLS_SCRIPT.new(backend)
	return {"backend": backend, "tools": tools}


# ---------------------------------------------------------------------------
# 1) input.list_actions — calls backend with no arguments
# ---------------------------------------------------------------------------

func test_list_actions_calls_backend_and_returns_actions_array() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorInputBackend = env["backend"]

	var result: Variant = tools.list_actions({})

	assert_eq(backend.find_calls("list_actions").size(), 1, "Backend.list_actions called once")
	var actions: Array = (result as Dictionary).get("actions", [])
	assert_eq(actions.size(), 2, "Default fake returns two actions")
	var first: Dictionary = actions[0]
	assert_eq(first.get("name", ""), "ui_accept", "first action name")
	assert_true(first.has("deadzone"), "action entry contains deadzone")
	assert_true(first.has("events"), "action entry contains events")


# ---------------------------------------------------------------------------
# 2) input.configure_action — forwards action, events, and deadzone when supplied
# ---------------------------------------------------------------------------

func test_configure_action_forwards_action_events_and_deadzone_when_supplied() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorInputBackend = env["backend"]

	var events: Array = [{"type": "key", "keycode": 32}]
	var _result: Variant = tools.configure_action({
		"action": "ui_accept",
		"events": events,
		"deadzone": 0.25,
	})

	var call: Dictionary = backend.find_calls("configure_action")[0]
	assert_eq(call.get("action", ""), "ui_accept", "action forwarded")
	var events_out: Array = call.get("events", [])
	assert_eq(events_out.size(), 1, "events length forwarded")
	assert_almost_eq(float(call.get("deadzone", -1.0)), 0.25, 0.0001, "deadzone forwarded")
	assert_true(bool(call.get("deadzone_supplied", false)), "deadzone_supplied flag true when value given")


func test_configure_action_marks_deadzone_unsupplied_when_omitted() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorInputBackend = env["backend"]

	var _result: Variant = tools.configure_action({
		"action": "attack",
		"events": [],
	})

	var call: Dictionary = backend.find_calls("configure_action")[0]
	assert_false(bool(call.get("deadzone_supplied", true)), "deadzone_supplied flag false when value omitted")


func test_configure_action_passes_through_backend_error_envelope() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorInputBackend = env["backend"]
	backend.overrides["configure_action"] = {
		"error": MCP_ERROR_CODES_SCRIPT.make_error(
			MCP_ERROR_CODES_SCRIPT.ATOMIC_WRITE_FAILED,
			{"path": "res://project.godot"}
		),
	}

	var result: Variant = tools.configure_action({
		"action": "ui_accept",
		"events": [],
		"deadzone": 0.3,
	})

	assert_true((result as Dictionary).has("error"), "Backend error envelope must propagate")


# ---------------------------------------------------------------------------
# 3) input.remove_action — forwards action
# ---------------------------------------------------------------------------

func test_remove_action_forwards_action_name() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorInputBackend = env["backend"]

	var _result: Variant = tools.remove_action({"action": "old_action"})

	var call: Dictionary = backend.find_calls("remove_action")[0]
	assert_eq(call.get("action", ""), "old_action", "action forwarded")


# ---------------------------------------------------------------------------
# 4) register_on — wires all three editor Input MCP methods on the dispatcher
# ---------------------------------------------------------------------------

func test_register_on_wires_all_three_editor_input_methods_on_dispatcher() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var dispatcher: Object = DISPATCHER_SCRIPT.new()

	tools.register_on(dispatcher)

	var cases: Array = [
		{"method": "input.list_actions", "params": {}},
		{
			"method": "input.configure_action",
			"params": {"action": "ui_accept", "events": [], "deadzone": 0.5},
		},
		{"method": "input.remove_action", "params": {"action": "attack"}},
	]
	for c in cases:
		var case_dict: Dictionary = c
		var response: Dictionary = dispatcher.dispatch({
			"jsonrpc": "2.0",
			"method": case_dict["method"],
			"params": case_dict["params"],
			"id": 1,
		})
		assert_true(response.has("result"), "%s must be reachable via dispatcher" % case_dict["method"])
		assert_false(response.has("error"), "%s must not produce a dispatcher error" % case_dict["method"])
