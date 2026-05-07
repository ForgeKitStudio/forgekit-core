extends GutTest
## Unit tests for McpRuntimeInputTools: JSON-RPC handler adapter that exposes
## the runtime-channel Input MCP tools on top of a duck-typed
## RuntimeInputBackend.
##
## The adapter translates JSON-RPC `params` (Dictionary or Array) into
## backend method calls and returns the backend's result verbatim. The
## production backend is expected to emit events via
## `Input.parse_input_event` and query `InputMap.get_actions()`; the tests
## use a FakeRuntimeInputBackend so they run headless without a SceneTree.
##
## Covered handlers:
##   input.simulate_action(action, strength?, pressed?)       → {action, strength, pressed}
##   input.simulate_key(keycode, pressed, echo?)              → {keycode, pressed, echo}
##   input.simulate_mouse_button(button, pressed, position?)  → {button, pressed, position}
##   input.simulate_mouse_motion(position, relative?)         → {position, relative}
##   input.list_actions()                                     → {actions: [{name, events}]}


const INPUT_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/runtime_bridge/tools/input_tools.gd")
const DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")


class FakeRuntimeInputBackend:
	extends RefCounted

	var calls: Array = []
	var overrides: Dictionary = {}

	func simulate_action(action: String, strength: float, pressed: bool) -> Variant:
		calls.append({
			"op": "simulate_action",
			"action": action,
			"strength": strength,
			"pressed": pressed,
		})
		if overrides.has("simulate_action"):
			return overrides["simulate_action"]
		return {"action": action, "strength": strength, "pressed": pressed}

	func simulate_key(keycode: int, pressed: bool, echo: bool) -> Variant:
		calls.append({
			"op": "simulate_key",
			"keycode": keycode,
			"pressed": pressed,
			"echo": echo,
		})
		if overrides.has("simulate_key"):
			return overrides["simulate_key"]
		return {"keycode": keycode, "pressed": pressed, "echo": echo}

	func simulate_mouse_button(button: int, pressed: bool, position: Vector2) -> Variant:
		calls.append({
			"op": "simulate_mouse_button",
			"button": button,
			"pressed": pressed,
			"position": position,
		})
		if overrides.has("simulate_mouse_button"):
			return overrides["simulate_mouse_button"]
		return {
			"button": button,
			"pressed": pressed,
			"position": [position.x, position.y],
		}

	func simulate_mouse_motion(position: Vector2, relative: Vector2) -> Variant:
		calls.append({
			"op": "simulate_mouse_motion",
			"position": position,
			"relative": relative,
		})
		if overrides.has("simulate_mouse_motion"):
			return overrides["simulate_mouse_motion"]
		return {
			"position": [position.x, position.y],
			"relative": [relative.x, relative.y],
		}

	func list_actions() -> Variant:
		calls.append({"op": "list_actions"})
		if overrides.has("list_actions"):
			return overrides["list_actions"]
		return {
			"actions": [
				{"name": "ui_accept", "events": []},
				{"name": "attack", "events": []},
			],
		}

	func find_calls(op: String) -> Array:
		var out: Array = []
		for c in calls:
			if (c as Dictionary).get("op", "") == op:
				out.append(c)
		return out


func _new_env() -> Dictionary:
	var backend: FakeRuntimeInputBackend = FakeRuntimeInputBackend.new()
	var tools: Object = INPUT_TOOLS_SCRIPT.new(backend)
	return {"backend": backend, "tools": tools}


# ---------------------------------------------------------------------------
# 1) input.simulate_action — forwards action, strength, pressed
# ---------------------------------------------------------------------------

func test_simulate_action_forwards_action_strength_and_pressed() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeInputBackend = env["backend"]

	var _result: Variant = tools.simulate_action({
		"action": "attack",
		"strength": 0.75,
		"pressed": true,
	})

	var calls: Array = backend.find_calls("simulate_action")
	assert_eq(calls.size(), 1, "Backend.simulate_action must be called once")
	var call: Dictionary = calls[0]
	assert_eq(call.get("action", ""), "attack", "action forwarded")
	assert_almost_eq(float(call.get("strength", 0.0)), 0.75, 0.0001, "strength forwarded")
	assert_true(bool(call.get("pressed", false)), "pressed=true forwarded")


func test_simulate_action_defaults_strength_to_one_and_pressed_to_true() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeInputBackend = env["backend"]

	var _result: Variant = tools.simulate_action({"action": "ui_accept"})

	var call: Dictionary = backend.find_calls("simulate_action")[0]
	assert_almost_eq(float(call.get("strength", 0.0)), 1.0, 0.0001, "strength defaults to 1.0")
	assert_true(bool(call.get("pressed", false)), "pressed defaults to true")


func test_simulate_action_accepts_positional_params() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeInputBackend = env["backend"]

	var _result: Variant = tools.simulate_action(["jump", 0.5, false])

	var call: Dictionary = backend.find_calls("simulate_action")[0]
	assert_eq(call.get("action", ""), "jump", "positional action forwarded")
	assert_almost_eq(float(call.get("strength", 0.0)), 0.5, 0.0001, "positional strength forwarded")
	assert_false(bool(call.get("pressed", true)), "positional pressed=false forwarded")


# ---------------------------------------------------------------------------
# 2) input.simulate_key — forwards keycode, pressed, echo
# ---------------------------------------------------------------------------

func test_simulate_key_forwards_keycode_pressed_and_echo() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeInputBackend = env["backend"]

	var _result: Variant = tools.simulate_key({
		"keycode": 32,
		"pressed": true,
		"echo": false,
	})

	var call: Dictionary = backend.find_calls("simulate_key")[0]
	assert_eq(int(call.get("keycode", 0)), 32, "keycode forwarded")
	assert_true(bool(call.get("pressed", false)), "pressed forwarded")
	assert_false(bool(call.get("echo", true)), "echo forwarded")


func test_simulate_key_defaults_echo_to_false() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeInputBackend = env["backend"]

	var _result: Variant = tools.simulate_key({"keycode": 65, "pressed": true})

	var call: Dictionary = backend.find_calls("simulate_key")[0]
	assert_false(bool(call.get("echo", true)), "echo defaults to false")


# ---------------------------------------------------------------------------
# 3) input.simulate_mouse_button — forwards button, pressed, position
# ---------------------------------------------------------------------------

func test_simulate_mouse_button_forwards_button_pressed_and_position() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeInputBackend = env["backend"]

	var _result: Variant = tools.simulate_mouse_button({
		"button": 1,
		"pressed": true,
		"position": [320.0, 240.0],
	})

	var call: Dictionary = backend.find_calls("simulate_mouse_button")[0]
	assert_eq(int(call.get("button", 0)), 1, "button forwarded")
	assert_true(bool(call.get("pressed", false)), "pressed forwarded")
	var pos: Vector2 = call.get("position", Vector2.ZERO)
	assert_almost_eq(pos.x, 320.0, 0.0001, "position.x forwarded")
	assert_almost_eq(pos.y, 240.0, 0.0001, "position.y forwarded")


func test_simulate_mouse_button_defaults_position_to_zero_when_absent() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeInputBackend = env["backend"]

	var _result: Variant = tools.simulate_mouse_button({"button": 2, "pressed": false})

	var call: Dictionary = backend.find_calls("simulate_mouse_button")[0]
	var pos: Vector2 = call.get("position", Vector2.ONE)
	assert_almost_eq(pos.x, 0.0, 0.0001, "default position.x is 0")
	assert_almost_eq(pos.y, 0.0, 0.0001, "default position.y is 0")


# ---------------------------------------------------------------------------
# 4) input.simulate_mouse_motion — forwards position and relative
# ---------------------------------------------------------------------------

func test_simulate_mouse_motion_forwards_position_and_relative() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeInputBackend = env["backend"]

	var _result: Variant = tools.simulate_mouse_motion({
		"position": [100.0, 50.0],
		"relative": [10.0, -5.0],
	})

	var call: Dictionary = backend.find_calls("simulate_mouse_motion")[0]
	var pos: Vector2 = call.get("position", Vector2.ZERO)
	var rel: Vector2 = call.get("relative", Vector2.ZERO)
	assert_almost_eq(pos.x, 100.0, 0.0001, "position.x forwarded")
	assert_almost_eq(pos.y, 50.0, 0.0001, "position.y forwarded")
	assert_almost_eq(rel.x, 10.0, 0.0001, "relative.x forwarded")
	assert_almost_eq(rel.y, -5.0, 0.0001, "relative.y forwarded")


func test_simulate_mouse_motion_defaults_relative_to_zero_when_absent() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeInputBackend = env["backend"]

	var _result: Variant = tools.simulate_mouse_motion({"position": [1.0, 2.0]})

	var call: Dictionary = backend.find_calls("simulate_mouse_motion")[0]
	var rel: Vector2 = call.get("relative", Vector2.ONE)
	assert_almost_eq(rel.x, 0.0, 0.0001, "default relative.x is 0")
	assert_almost_eq(rel.y, 0.0, 0.0001, "default relative.y is 0")


# ---------------------------------------------------------------------------
# 5) input.list_actions — calls backend with no arguments
# ---------------------------------------------------------------------------

func test_list_actions_calls_backend_and_returns_actions_array() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeInputBackend = env["backend"]

	var result: Variant = tools.list_actions({})

	assert_eq(backend.find_calls("list_actions").size(), 1, "Backend.list_actions called once")
	var actions: Array = (result as Dictionary).get("actions", [])
	assert_eq(actions.size(), 2, "Default fake returns two actions")


# ---------------------------------------------------------------------------
# 6) register_on — wires all five runtime Input MCP methods on the dispatcher
# ---------------------------------------------------------------------------

func test_register_on_wires_all_five_input_methods_on_dispatcher() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var dispatcher: Object = DISPATCHER_SCRIPT.new()

	tools.register_on(dispatcher)

	var methods: Array = [
		"input.simulate_action",
		"input.simulate_key",
		"input.simulate_mouse_button",
		"input.simulate_mouse_motion",
		"input.list_actions",
	]
	for method in methods:
		var params: Dictionary = {}
		match method:
			"input.simulate_action":
				params = {"action": "ui_accept"}
			"input.simulate_key":
				params = {"keycode": 65, "pressed": true}
			"input.simulate_mouse_button":
				params = {"button": 1, "pressed": true}
			"input.simulate_mouse_motion":
				params = {"position": [0.0, 0.0]}
			_:
				params = {}
		var response: Dictionary = dispatcher.dispatch({
			"jsonrpc": "2.0",
			"method": method,
			"params": params,
			"id": 1,
		})
		assert_true(response.has("result"), "%s must be reachable via dispatcher" % method)
		assert_false(response.has("error"), "%s must not produce a dispatcher error" % method)
