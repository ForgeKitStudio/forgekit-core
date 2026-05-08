extends SceneTree
## Headless driver for the Input_Simulator property test.
##
## Reads a JSON payload `{"samples": [{"action": "...", "strength": f,
## "pressed": b}]}` from stdin, simulates each action by delegating to
## the production `McpRuntimeInputBackend.simulate_action`, queries
## `Input.is_action_pressed` and `Input.get_action_strength` for the same
## action, and emits a single JSON envelope on stdout fenced by
## `<<<FORGEKIT_INPUT_BEGIN>>>` / `<<<FORGEKIT_INPUT_END>>>` markers.
##
## Delegating to the production backend (rather than re-implementing the
## event-emission idiom here) keeps the property test tied to the real
## Input_Simulator — if the backend regresses, this driver regresses
## with it. The backend emits an `InputEventAction` through
## `Input.parse_input_event` and also drives
## `Input.action_press` / `Input.action_release` synchronously, which is
## what makes Property 30's single-frame invariant observable.
##
## The four canonical action names from Requirement 13.4 (`ui_accept`,
## `ui_cancel`, `attack`, `interact`) are registered in `InputMap` at init
## time so the property test does not depend on the host project's current
## input map contents. Pre-existing actions are left untouched.
##
## Driver is batched — one spawn per fast-check sweep — because a fresh
## Godot launch per sample would dwarf the 100 iterations in wall-clock time.


const TEST_ACTIONS: Array[StringName] = [
	&"ui_accept",
	&"ui_cancel",
	&"attack",
	&"interact",
]


const RuntimeInputBackend: GDScript = preload(
	"res://addons/forgekit_core/mcp/runtime_bridge/runtime_input_backend.gd"
)


func _init() -> void:
	var raw: String = _read_all_stdin()
	var parsed: Variant = JSON.parse_string(raw)
	if typeof(parsed) != TYPE_DICTIONARY:
		_emit_envelope({"error": "invalid_payload", "results": []})
		quit(0)
		return

	# Ensure the four canonical Requirement 13.4 actions exist so the
	# property test has a stable input map to draw from, regardless of
	# what `project.godot` in the host checkout declares.
	for action_name in TEST_ACTIONS:
		if not InputMap.has_action(action_name):
			InputMap.add_action(action_name)

	var backend: RefCounted = RuntimeInputBackend.new()
	var samples: Array = (parsed as Dictionary).get("samples", [])
	var results: Array = []

	for i in range(samples.size()):
		var sample: Dictionary = samples[i] as Dictionary
		var action_str: String = String(sample.get("action", ""))
		var strength: float = float(sample.get("strength", 1.0))
		var pressed: bool = bool(sample.get("pressed", true))

		# Delegate to the production Input_Simulator so the property
		# test validates the real backend rather than a hand-rolled
		# copy. The backend drives `Input.action_press` /
		# `Input.action_release` synchronously so the following
		# queries observe the new action state without waiting for a
		# `_process` tick.
		backend.simulate_action(action_str, strength, pressed)

		results.append({
			"is_action_pressed": Input.is_action_pressed(StringName(action_str)),
			"strength": Input.get_action_strength(StringName(action_str)),
		})

	_emit_envelope({"results": results})
	quit(0)


func _read_all_stdin() -> String:
	# `read_string_from_stdin` returns an empty string once the pipe
	# closes; keep pulling until EOF so payloads larger than a single
	# buffer are handled.
	var buf: String = ""
	while true:
		var chunk: String = OS.read_string_from_stdin(65_536)
		if chunk == "":
			break
		buf += chunk
	return buf


func _emit_envelope(envelope: Dictionary) -> void:
	print("<<<FORGEKIT_INPUT_BEGIN>>>")
	print(JSON.stringify(envelope))
	print("<<<FORGEKIT_INPUT_END>>>")
