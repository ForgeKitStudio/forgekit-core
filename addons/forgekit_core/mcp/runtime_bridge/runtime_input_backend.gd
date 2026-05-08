extends RefCounted
## McpRuntimeInputBackend — production Input_Simulator for the runtime
## channel.
##
## Drives the engine-managed `Input` singleton via `Input.parse_input_event`
## so that MCP clients can simulate gameplay actions from outside the
## running process. The four canonical actions named in Requirement 13.4
## are `ui_accept`, `ui_cancel`, `attack`, and `interact`; any action
## registered in `InputMap` is accepted, the four above are the ones the
## spec guarantees.
##
## Contract (Property 30, design §10.2):
##
##   For any action `a` declared in `InputMap` and any `(strength, pressed)`
##   pair, calling `simulate_action(a, strength, pressed)` SHALL cause
##   `Input.is_action_pressed(a) === pressed` observable in the next frame.
##
## Implementation note: the backend emits an `InputEventAction` through
## `Input.parse_input_event` so that `_input()` / `_unhandled_input()`
## handlers in the live SceneTree observe the event, and also calls the
## synchronous `Input.action_press` / `Input.action_release` primitives
## (the "or equivalent" clause in Requirement 13.4) so the action state
## machinery is updated immediately. Without the synchronous call the
## action state would only advance on the next `_process` iteration,
## which is fine for gameplay but not observable from unit tests that
## drive the backend directly.
##
## The backend is intentionally tool-agnostic: it exposes the five methods
## that `McpRuntimeInputTools` delegates to, but is agnostic of JSON-RPC
## and is safe to reuse from other runtime integrations (e.g., a scripted
## test harness attached directly to the SceneTree).


class_name McpRuntimeInputBackend


# ---------------------------------------------------------------------------
# Public API — invoked by McpRuntimeInputTools adapter.
# ---------------------------------------------------------------------------

## Emit an `InputEventAction` so that `Input.is_action_pressed(action)`
## reflects `pressed` on the next query. Returns a JSON-serialisable
## envelope echoing the inputs for the MCP client.
func simulate_action(action: String, strength: float, pressed: bool) -> Variant:
	var action_name: StringName = StringName(action)
	# Emit through `Input.parse_input_event` so input handlers wired to
	# `_input` / `_unhandled_input` in the live SceneTree observe the
	# simulated event — this is the "using Input.parse_input_event"
	# clause in Requirement 13.4.
	var event: InputEventAction = InputEventAction.new()
	event.action = action_name
	event.strength = strength
	event.pressed = pressed
	Input.parse_input_event(event)
	# Drive the action-state machinery synchronously so
	# `Input.is_action_pressed(action)` returns the expected value
	# without waiting for a `_process` iteration. This is the "or
	# equivalent" clause in Requirement 13.4 and is what makes Property
	# 30's invariant observable from single-frame test harnesses.
	if pressed:
		Input.action_press(action_name, strength)
	else:
		Input.action_release(action_name)
	return {
		"action": action,
		"strength": strength,
		"pressed": pressed,
	}


## Emit an `InputEventKey`. The keycode is the Godot `Key` enum value
## (e.g. `KEY_SPACE`); `echo` follows `InputEventKey.echo` semantics.
func simulate_key(keycode: int, pressed: bool, echo: bool) -> Variant:
	var event: InputEventKey = InputEventKey.new()
	event.keycode = keycode
	event.pressed = pressed
	event.echo = echo
	Input.parse_input_event(event)
	return {
		"keycode": keycode,
		"pressed": pressed,
		"echo": echo,
	}


## Emit an `InputEventMouseButton` at `position` in screen-space.
func simulate_mouse_button(button: int, pressed: bool, position: Vector2) -> Variant:
	var event: InputEventMouseButton = InputEventMouseButton.new()
	event.button_index = button
	event.pressed = pressed
	event.position = position
	Input.parse_input_event(event)
	return {
		"button": button,
		"pressed": pressed,
		"position": [position.x, position.y],
	}


## Emit an `InputEventMouseMotion` moving the cursor to `position` with
## the supplied `relative` delta.
func simulate_mouse_motion(position: Vector2, relative: Vector2) -> Variant:
	var event: InputEventMouseMotion = InputEventMouseMotion.new()
	event.position = position
	event.relative = relative
	Input.parse_input_event(event)
	return {
		"position": [position.x, position.y],
		"relative": [relative.x, relative.y],
	}


## Enumerate the actions registered in `InputMap` and the events bound
## to each. Returned shape matches the MCP contract consumed by the
## `input.list_actions` handler.
func list_actions() -> Variant:
	var actions: Array = []
	for action_name in InputMap.get_actions():
		var events_out: Array = []
		for event in InputMap.action_get_events(action_name):
			events_out.append(_serialize_input_event(event))
		actions.append({
			"name": String(action_name),
			"deadzone": InputMap.action_get_deadzone(action_name),
			"events": events_out,
		})
	return {"actions": actions}


# ---------------------------------------------------------------------------
# Internals.
# ---------------------------------------------------------------------------

## Best-effort JSON-serialisable summary of an `InputEvent`. We keep the
## shape narrow — `type` + a handful of per-subtype fields — so clients
## do not have to dispatch on every concrete engine class.
static func _serialize_input_event(event: InputEvent) -> Dictionary:
	if event is InputEventKey:
		var k: InputEventKey = event as InputEventKey
		return {
			"type": "key",
			"keycode": k.keycode,
			"physical_keycode": k.physical_keycode,
		}
	if event is InputEventMouseButton:
		var m: InputEventMouseButton = event as InputEventMouseButton
		return {
			"type": "mouse_button",
			"button_index": m.button_index,
		}
	if event is InputEventJoypadButton:
		var j: InputEventJoypadButton = event as InputEventJoypadButton
		return {
			"type": "joypad_button",
			"button_index": j.button_index,
			"device": j.device,
		}
	if event is InputEventJoypadMotion:
		var a: InputEventJoypadMotion = event as InputEventJoypadMotion
		return {
			"type": "joypad_motion",
			"axis": a.axis,
			"device": a.device,
		}
	if event is InputEventAction:
		var ea: InputEventAction = event as InputEventAction
		return {
			"type": "action",
			"action": String(ea.action),
		}
	return {"type": "unknown"}
