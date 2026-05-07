extends RefCounted
## McpRuntimeInputTools — JSON-RPC handler adapter for the runtime-channel
## Input MCP tools.
##
## Exposes five handlers that translate JSON-RPC calls into calls on an
## injected RuntimeInputBackend. The backend is duck-typed so the adapter
## can run headlessly against a fake in unit tests while the production
## backend emits events through `Input.parse_input_event` and queries
## `InputMap.get_actions()` against the live running game.
##
##   input.simulate_action(action, strength?, pressed?)      → {action, strength, pressed}
##   input.simulate_key(keycode, pressed, echo?)             → {keycode, pressed, echo}
##   input.simulate_mouse_button(button, pressed, position?) → {button, pressed, position}
##   input.simulate_mouse_motion(position, relative?)        → {position, relative}
##   input.list_actions()                                    → {actions: [{name, events}]}
##
## Parameter shapes accepted by both the by-name (Dictionary) and
## by-position (Array) JSON-RPC conventions:
##
##   - `strength` is a number in [0.0, 1.0]; the adapter does NOT clamp —
##     the backend is the source of truth.
##   - `pressed` and `echo` are booleans, defaulting to `true` and `false`
##     respectively (matching `InputEventKey.echo` semantics).
##   - `position` and `relative` are two-element numeric arrays
##     (`[x, y]`); the adapter converts them to `Vector2` before calling
##     the backend so the backend signature is strongly typed.
##
## Backends signal business-level failures (for example an unknown action
## name) by returning a Dictionary shaped `{"error": {...}}`. The adapter
## returns that envelope verbatim so the JSON-RPC dispatcher can hoist it
## into a top-level JSON-RPC error response.


class_name McpRuntimeInputTools


# Injected RuntimeInputBackend (duck-typed). The production backend lives
# in the runtime bridge and is only reachable when the game was launched
# with `--mcp-bridge`; tests inject a fake.
var _backend: Object = null


func _init(backend: Object = null) -> void:
	_backend = backend


func set_backend(backend: Object) -> void:
	_backend = backend


# ---------------------------------------------------------------------------
# MCP tool handlers.
# ---------------------------------------------------------------------------

func simulate_action(params: Variant) -> Variant:
	var action: String = _get_string_param(params, "action", 0, "")
	var strength: float = _get_float_param(params, "strength", 1, 1.0)
	var pressed: bool = _get_bool_param(params, "pressed", 2, true)
	return _backend.simulate_action(action, strength, pressed)


func simulate_key(params: Variant) -> Variant:
	var keycode: int = _get_int_param(params, "keycode", 0, 0)
	var pressed: bool = _get_bool_param(params, "pressed", 1, true)
	var echo: bool = _get_bool_param(params, "echo", 2, false)
	return _backend.simulate_key(keycode, pressed, echo)


func simulate_mouse_button(params: Variant) -> Variant:
	var button: int = _get_int_param(params, "button", 0, 0)
	var pressed: bool = _get_bool_param(params, "pressed", 1, true)
	var position: Vector2 = _get_vector2_param(params, "position", 2, Vector2.ZERO)
	return _backend.simulate_mouse_button(button, pressed, position)


func simulate_mouse_motion(params: Variant) -> Variant:
	var position: Vector2 = _get_vector2_param(params, "position", 0, Vector2.ZERO)
	var relative: Vector2 = _get_vector2_param(params, "relative", 1, Vector2.ZERO)
	return _backend.simulate_mouse_motion(position, relative)


func list_actions(_params: Variant) -> Variant:
	return _backend.list_actions()


## Bulk-register all five runtime Input MCP methods on the supplied
## dispatcher. Returns `self` so the caller can chain.
func register_on(dispatcher: Object) -> Object:
	dispatcher.register_handler("input.simulate_action", Callable(self, "simulate_action"))
	dispatcher.register_handler("input.simulate_key", Callable(self, "simulate_key"))
	dispatcher.register_handler("input.simulate_mouse_button", Callable(self, "simulate_mouse_button"))
	dispatcher.register_handler("input.simulate_mouse_motion", Callable(self, "simulate_mouse_motion"))
	dispatcher.register_handler("input.list_actions", Callable(self, "list_actions"))
	return self


# ---------------------------------------------------------------------------
# Internals. Accept both by-name (Dictionary) and by-position (Array)
# JSON-RPC params conventions.
# ---------------------------------------------------------------------------

static func _get_string_param(params: Variant, key: String, index: int, default_value: String) -> String:
	if params is Dictionary:
		var dict: Dictionary = params as Dictionary
		if dict.has(key):
			var v: Variant = dict[key]
			if v is String:
				return String(v)
	elif params is Array:
		var arr: Array = params as Array
		if index >= 0 and index < arr.size():
			var v: Variant = arr[index]
			if v is String:
				return String(v)
	return default_value


static func _get_int_param(params: Variant, key: String, index: int, default_value: int) -> int:
	if params is Dictionary:
		var dict: Dictionary = params as Dictionary
		if dict.has(key):
			var v: Variant = dict[key]
			if typeof(v) == TYPE_INT:
				return int(v)
			if typeof(v) == TYPE_FLOAT:
				return int(v)
	elif params is Array:
		var arr: Array = params as Array
		if index >= 0 and index < arr.size():
			var v: Variant = arr[index]
			if typeof(v) == TYPE_INT:
				return int(v)
			if typeof(v) == TYPE_FLOAT:
				return int(v)
	return default_value


static func _get_float_param(params: Variant, key: String, index: int, default_value: float) -> float:
	if params is Dictionary:
		var dict: Dictionary = params as Dictionary
		if dict.has(key):
			var v: Variant = dict[key]
			if typeof(v) == TYPE_FLOAT:
				return float(v)
			if typeof(v) == TYPE_INT:
				return float(v)
	elif params is Array:
		var arr: Array = params as Array
		if index >= 0 and index < arr.size():
			var v: Variant = arr[index]
			if typeof(v) == TYPE_FLOAT:
				return float(v)
			if typeof(v) == TYPE_INT:
				return float(v)
	return default_value


static func _get_bool_param(params: Variant, key: String, index: int, default_value: bool) -> bool:
	if params is Dictionary:
		var dict: Dictionary = params as Dictionary
		if dict.has(key):
			var v: Variant = dict[key]
			if typeof(v) == TYPE_BOOL:
				return bool(v)
	elif params is Array:
		var arr: Array = params as Array
		if index >= 0 and index < arr.size():
			var v: Variant = arr[index]
			if typeof(v) == TYPE_BOOL:
				return bool(v)
	return default_value


## Extract a Vector2 from either a two-element numeric array (JSON-RPC
## wire format) or a Vector2 value (GDScript in-process calls). Returns
## `default_value` when the field is missing or malformed.
static func _get_vector2_param(params: Variant, key: String, index: int, default_value: Vector2) -> Vector2:
	var raw: Variant = null
	if params is Dictionary:
		var dict: Dictionary = params as Dictionary
		if dict.has(key):
			raw = dict[key]
	elif params is Array:
		var arr: Array = params as Array
		if index >= 0 and index < arr.size():
			raw = arr[index]
	if raw == null:
		return default_value
	if raw is Vector2:
		return raw as Vector2
	if raw is Array:
		var parts: Array = raw as Array
		if parts.size() >= 2:
			var x: float = _coerce_float(parts[0])
			var y: float = _coerce_float(parts[1])
			return Vector2(x, y)
	return default_value


static func _coerce_float(v: Variant) -> float:
	if typeof(v) == TYPE_FLOAT:
		return float(v)
	if typeof(v) == TYPE_INT:
		return float(v)
	return 0.0
