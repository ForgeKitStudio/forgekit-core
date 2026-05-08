extends GutTest
## Unit tests for McpRuntimeInputBackend — the production backend that
## the runtime-channel McpRuntimeInputTools adapter delegates to.
##
## The backend is the Input_Simulator from Requirement 13.4: it drives
## `Input.parse_input_event` for the four canonical actions `ui_accept`,
## `ui_cancel`, `attack`, `interact` and honours the contract stated by
## Property 30 (design §10.2) — after `simulate_action(a, pressed=true)`,
## `Input.is_action_pressed(a) == true`.
##
## The tests run headless against the engine-managed `Input` singleton;
## `InputMap` is primed in `before_each` so the tests are stable even on
## a host project whose `project.godot` declares a different set of
## actions.


const BACKEND_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/runtime_bridge/runtime_input_backend.gd")


## The four actions named in Requirement 13.4. Any project shipping the
## runtime bridge is expected to have these bound to real keys, but for
## unit-test purposes we only need them registered in `InputMap` so the
## backend has a valid target.
const CANONICAL_ACTIONS: Array[StringName] = [
	&"ui_accept",
	&"ui_cancel",
	&"attack",
	&"interact",
]


func before_each() -> void:
	for action_name in CANONICAL_ACTIONS:
		if not InputMap.has_action(action_name):
			InputMap.add_action(action_name)
	# Reset action state so tests do not leak press state from the
	# previous case. `Input.action_release` clears the action machinery.
	for action_name in CANONICAL_ACTIONS:
		Input.action_release(action_name)


# ---------------------------------------------------------------------------
# 1) simulate_action(pressed=true) → Input.is_action_pressed becomes true
# ---------------------------------------------------------------------------

func test_simulate_action_pressed_true_sets_is_action_pressed_true() -> void:
	var backend: Object = BACKEND_SCRIPT.new()

	var result: Variant = backend.simulate_action("ui_accept", 1.0, true)

	assert_true(
		Input.is_action_pressed(&"ui_accept"),
		"Input.is_action_pressed('ui_accept') must be true after simulate_action(pressed=true)",
	)
	var dict: Dictionary = result as Dictionary
	assert_eq(dict.get("action", ""), "ui_accept", "result echoes action")
	assert_almost_eq(float(dict.get("strength", 0.0)), 1.0, 0.0001, "result echoes strength")
	assert_true(bool(dict.get("pressed", false)), "result echoes pressed=true")


# ---------------------------------------------------------------------------
# 2) simulate_action(pressed=false) releases the action
# ---------------------------------------------------------------------------

func test_simulate_action_pressed_false_releases_action() -> void:
	var backend: Object = BACKEND_SCRIPT.new()

	var _press: Variant = backend.simulate_action("attack", 1.0, true)
	assert_true(Input.is_action_pressed(&"attack"), "precondition: attack is pressed")

	var _release: Variant = backend.simulate_action("attack", 0.0, false)

	assert_false(
		Input.is_action_pressed(&"attack"),
		"Input.is_action_pressed('attack') must be false after simulate_action(pressed=false)",
	)


# ---------------------------------------------------------------------------
# 3) All four canonical actions (Requirement 13.4) round-trip correctly
# ---------------------------------------------------------------------------

func test_simulate_action_handles_all_four_canonical_actions() -> void:
	var backend: Object = BACKEND_SCRIPT.new()

	for action_name in CANONICAL_ACTIONS:
		var _press: Variant = backend.simulate_action(String(action_name), 1.0, true)
		assert_true(
			Input.is_action_pressed(action_name),
			"%s must be pressed after simulate_action(pressed=true)" % action_name,
		)
		var _release: Variant = backend.simulate_action(String(action_name), 0.0, false)
		assert_false(
			Input.is_action_pressed(action_name),
			"%s must be released after simulate_action(pressed=false)" % action_name,
		)


# ---------------------------------------------------------------------------
# 4) Strength is forwarded to the engine's action-state machinery
# ---------------------------------------------------------------------------

func test_simulate_action_forwards_strength_to_input_singleton() -> void:
	var backend: Object = BACKEND_SCRIPT.new()

	var _result: Variant = backend.simulate_action("interact", 0.7, true)

	assert_almost_eq(
		Input.get_action_strength(&"interact"),
		0.7,
		0.0001,
		"Input.get_action_strength must reflect the strength passed to simulate_action",
	)


# ---------------------------------------------------------------------------
# 5) Result envelope echoes the inputs for JSON-RPC clients
# ---------------------------------------------------------------------------

func test_simulate_action_result_envelope_shape() -> void:
	var backend: Object = BACKEND_SCRIPT.new()

	var result: Variant = backend.simulate_action("ui_cancel", 0.25, true)

	assert_true(result is Dictionary, "result must be a Dictionary")
	var dict: Dictionary = result as Dictionary
	assert_eq(dict.get("action", ""), "ui_cancel", "action echoed")
	assert_almost_eq(float(dict.get("strength", 0.0)), 0.25, 0.0001, "strength echoed")
	assert_true(bool(dict.get("pressed", false)), "pressed echoed")
	assert_false(dict.has("error"), "success result must not carry an error envelope")
