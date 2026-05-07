extends RefCounted
## McpEditorInputTools — JSON-RPC handler adapter for the editor-channel
## Input MCP tools.
##
## Exposes three handlers that translate JSON-RPC calls into calls on an
## injected EditorInputBackend. The backend is duck-typed so the adapter
## can run headlessly against a fake in unit tests while the production
## backend reads `InputMap.get_actions()` from the live project and writes
## `input/<action>` entries in `project.godot` through
## `McpProjectSettingsAtomicWriter`.
##
##   input.list_actions()                               → {actions: [{name, deadzone, events}]}
##   input.configure_action(action, events, deadzone?)  → {applied, previous}
##   input.remove_action(action)                        → {removed: true}
##
## `input.configure_action` intentionally fixes the tomyud1/godot-mcp bug
## where `deadzone` was silently dropped on action updates. The backend
## writes `events` and `deadzone` together through the atomic writer so
## every sibling action in `[input]` remains byte-exact.
##
## The adapter distinguishes "deadzone omitted" from "deadzone set to 0.0"
## by forwarding an explicit `deadzone_supplied: bool` flag to the backend.
## Omitting the field preserves whatever deadzone the action already had;
## passing it (even `0.0`) overwrites it.
##
## Backends signal business-level failures (FILE_NOT_FOUND,
## CORE_BOUNDARY_VIOLATION, ATOMIC_WRITE_FAILED, ...) by returning a
## Dictionary shaped `{"error": {...}}`. This adapter returns that envelope
## verbatim so the JSON-RPC dispatcher can hoist it into a top-level
## JSON-RPC error response.


class_name McpEditorInputTools


# Injected EditorInputBackend (duck-typed).
var _backend: Object = null


func _init(backend: Object = null) -> void:
	_backend = backend


func set_backend(backend: Object) -> void:
	_backend = backend


# ---------------------------------------------------------------------------
# MCP tool handlers.
# ---------------------------------------------------------------------------

func list_actions(_params: Variant) -> Variant:
	return _backend.list_actions()


func configure_action(params: Variant) -> Variant:
	var action: String = _get_string_param(params, "action", 0, "")
	var events: Array = _get_array_param(params, "events", 1, [])
	var deadzone_supplied: bool = _has_param(params, "deadzone", 2)
	var deadzone: float = _get_float_param(params, "deadzone", 2, 0.0)
	return _backend.configure_action(action, events, deadzone, deadzone_supplied)


func remove_action(params: Variant) -> Variant:
	var action: String = _get_string_param(params, "action", 0, "")
	return _backend.remove_action(action)


## Bulk-register all three editor-channel Input MCP methods on the supplied
## dispatcher. Returns `self` so the caller can chain.
func register_on(dispatcher: Object) -> Object:
	dispatcher.register_handler("input.list_actions", Callable(self, "list_actions"))
	dispatcher.register_handler("input.configure_action", Callable(self, "configure_action"))
	dispatcher.register_handler("input.remove_action", Callable(self, "remove_action"))
	return self


# ---------------------------------------------------------------------------
# Internals. Accept both by-name (Dictionary) and by-position (Array)
# JSON-RPC params conventions.
# ---------------------------------------------------------------------------

static func _has_param(params: Variant, key: String, index: int) -> bool:
	if params is Dictionary:
		return (params as Dictionary).has(key)
	if params is Array:
		var arr: Array = params as Array
		return index >= 0 and index < arr.size()
	return false


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


static func _get_array_param(params: Variant, key: String, index: int, default_value: Array) -> Array:
	if params is Dictionary:
		var dict: Dictionary = params as Dictionary
		if dict.has(key):
			var v: Variant = dict[key]
			if v is Array:
				return v as Array
	elif params is Array:
		var arr: Array = params as Array
		if index >= 0 and index < arr.size():
			var v: Variant = arr[index]
			if v is Array:
				return v as Array
	return default_value
