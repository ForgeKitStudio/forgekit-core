extends RefCounted
## McpEditorNodeTools — JSON-RPC handler adapter for the editor-channel Node
## MCP tools.
##
## Exposes 13 handlers that translate JSON-RPC calls into calls on an
## injected EditorNodeBackend. The backend is duck-typed so the adapter
## can run headlessly against a fake in unit tests while the production
## backend wraps `EditorInterface`, `EditorUndoRedoManager`, and the
## UndoRedoWrapper used by other mutating MCP tools.
##
##   node.add(scene_path, parent_path, type, name, properties?) → {node_path}
##   node.remove(scene_path, node_path)                          → {removed_path}
##   node.set_property(scene_path, node_path, property, value)   → {property, previous_value, new_value}
##   node.get_property(scene_path, node_path, property)          → {property, value}
##   node.get_properties(scene_path, node_path)                  → {properties}
##   node.rename(scene_path, node_path, new_name)                → {previous_path, new_path}
##   node.reparent(scene_path, node_path, new_parent_path)       → {previous_path, new_path}
##   node.duplicate(scene_path, node_path, new_name)             → {source_path, duplicated_path}
##   node.find_by_type(scene_path, type, root_path?)             → {matches}
##   node.find_by_name(scene_path, pattern, root_path?, regex?)  → {matches}
##   node.get_signals(scene_path, node_path)                     → {signals}
##   node.connect_signal(scene_path, source_path, signal_name, target_path, method)    → {connected: true}
##   node.disconnect_signal(scene_path, source_path, signal_name, target_path, method) → {disconnected: true}
##
## Smart_Type_Parser contract for `node.set_property`:
##
## When `value` is supplied as a String (e.g. `"Vector3(12.5, 0, -4)"`),
## this adapter forwards it verbatim to the backend. The backend is
## required to resolve string values exclusively through Smart_Type_Parser
## — the closed-grammar literal reader — and never through `eval` or any
## dynamic code path. If the string is outside the grammar, the backend
## returns an `INVALID_LITERAL` error envelope which this adapter passes
## through unchanged so the dispatcher can hoist it into a JSON-RPC error
## response. Non-String values (numbers, bools, arrays, dictionaries,
## null) are already parsed by the JSON-RPC transport and are forwarded
## verbatim without any additional processing.
##
## Backends signal business-level failures (FILE_NOT_FOUND,
## CORE_BOUNDARY_VIOLATION, INVALID_LITERAL, ...) by returning a
## Dictionary shaped `{"error": {...}}`. This adapter returns that
## envelope verbatim so the JSON-RPC dispatcher can hoist it into a
## top-level JSON-RPC error response.


class_name McpEditorNodeTools


# Injected EditorNodeBackend (duck-typed). The adapter parses headless
# without the editor types being available; the backend is only invoked
# via its public methods.
var _backend: Object = null


func _init(backend: Object = null) -> void:
	_backend = backend


func set_backend(backend: Object) -> void:
	_backend = backend


# ---------------------------------------------------------------------------
# MCP tool handlers.
# ---------------------------------------------------------------------------

func add(params: Variant) -> Variant:
	var scene_path: String = _get_string_param(params, "scene_path", 0, "")
	var parent_path: String = _get_string_param(params, "parent_path", 1, "")
	var type: String = _get_string_param(params, "type", 2, "")
	var name: String = _get_string_param(params, "name", 3, "")
	var properties: Variant = _get_variant_param(params, "properties", 4, null)
	if not (properties is Dictionary):
		properties = {}
	return _backend.add_node(scene_path, parent_path, type, name, properties)


func remove(params: Variant) -> Variant:
	var scene_path: String = _get_string_param(params, "scene_path", 0, "")
	var node_path: String = _get_string_param(params, "node_path", 1, "")
	return _backend.remove_node(scene_path, node_path)


func set_property(params: Variant) -> Variant:
	var scene_path: String = _get_string_param(params, "scene_path", 0, "")
	var node_path: String = _get_string_param(params, "node_path", 1, "")
	var property: String = _get_string_param(params, "property", 2, "")
	# `value` is forwarded VERBATIM. String values are routed through
	# Smart_Type_Parser by the backend (closed grammar, no eval).
	var value: Variant = _get_variant_param(params, "value", 3, null)
	return _backend.set_node_property(scene_path, node_path, property, value)


func get_property(params: Variant) -> Variant:
	var scene_path: String = _get_string_param(params, "scene_path", 0, "")
	var node_path: String = _get_string_param(params, "node_path", 1, "")
	var property: String = _get_string_param(params, "property", 2, "")
	return _backend.get_node_property(scene_path, node_path, property)


func get_properties(params: Variant) -> Variant:
	var scene_path: String = _get_string_param(params, "scene_path", 0, "")
	var node_path: String = _get_string_param(params, "node_path", 1, "")
	return _backend.get_node_properties(scene_path, node_path)


func rename(params: Variant) -> Variant:
	var scene_path: String = _get_string_param(params, "scene_path", 0, "")
	var node_path: String = _get_string_param(params, "node_path", 1, "")
	var new_name: String = _get_string_param(params, "new_name", 2, "")
	return _backend.rename_node(scene_path, node_path, new_name)


func reparent(params: Variant) -> Variant:
	var scene_path: String = _get_string_param(params, "scene_path", 0, "")
	var node_path: String = _get_string_param(params, "node_path", 1, "")
	var new_parent_path: String = _get_string_param(params, "new_parent_path", 2, "")
	return _backend.reparent_node(scene_path, node_path, new_parent_path)


func duplicate(params: Variant) -> Variant:
	var scene_path: String = _get_string_param(params, "scene_path", 0, "")
	var node_path: String = _get_string_param(params, "node_path", 1, "")
	var new_name: String = _get_string_param(params, "new_name", 2, "")
	return _backend.duplicate_node(scene_path, node_path, new_name)


func find_by_type(params: Variant) -> Variant:
	var scene_path: String = _get_string_param(params, "scene_path", 0, "")
	var type: String = _get_string_param(params, "type", 1, "")
	var root_path: String = _get_string_param(params, "root_path", 2, "")
	return _backend.find_by_type(scene_path, type, root_path)


func find_by_name(params: Variant) -> Variant:
	var scene_path: String = _get_string_param(params, "scene_path", 0, "")
	var pattern: String = _get_string_param(params, "pattern", 1, "")
	var root_path: String = _get_string_param(params, "root_path", 2, "")
	var regex: bool = _get_bool_param(params, "regex", 3, false)
	return _backend.find_by_name(scene_path, pattern, root_path, regex)


func get_signals(params: Variant) -> Variant:
	var scene_path: String = _get_string_param(params, "scene_path", 0, "")
	var node_path: String = _get_string_param(params, "node_path", 1, "")
	return _backend.get_node_signals(scene_path, node_path)


func connect_signal(params: Variant) -> Variant:
	var scene_path: String = _get_string_param(params, "scene_path", 0, "")
	var source_path: String = _get_string_param(params, "source_path", 1, "")
	var signal_name: String = _get_string_param(params, "signal_name", 2, "")
	var target_path: String = _get_string_param(params, "target_path", 3, "")
	var method: String = _get_string_param(params, "method", 4, "")
	return _backend.connect_node_signal(scene_path, source_path, signal_name, target_path, method)


func disconnect_signal(params: Variant) -> Variant:
	var scene_path: String = _get_string_param(params, "scene_path", 0, "")
	var source_path: String = _get_string_param(params, "source_path", 1, "")
	var signal_name: String = _get_string_param(params, "signal_name", 2, "")
	var target_path: String = _get_string_param(params, "target_path", 3, "")
	var method: String = _get_string_param(params, "method", 4, "")
	return _backend.disconnect_node_signal(scene_path, source_path, signal_name, target_path, method)


## Bulk-register all 13 editor-channel Node MCP methods on the supplied
## dispatcher. Returns `self` so the caller can chain.
func register_on(dispatcher: Object) -> Object:
	dispatcher.register_handler("node.add", Callable(self, "add"))
	dispatcher.register_handler("node.remove", Callable(self, "remove"))
	dispatcher.register_handler("node.set_property", Callable(self, "set_property"))
	dispatcher.register_handler("node.get_property", Callable(self, "get_property"))
	dispatcher.register_handler("node.get_properties", Callable(self, "get_properties"))
	dispatcher.register_handler("node.rename", Callable(self, "rename"))
	dispatcher.register_handler("node.reparent", Callable(self, "reparent"))
	dispatcher.register_handler("node.duplicate", Callable(self, "duplicate"))
	dispatcher.register_handler("node.find_by_type", Callable(self, "find_by_type"))
	dispatcher.register_handler("node.find_by_name", Callable(self, "find_by_name"))
	dispatcher.register_handler("node.get_signals", Callable(self, "get_signals"))
	dispatcher.register_handler("node.connect_signal", Callable(self, "connect_signal"))
	dispatcher.register_handler("node.disconnect_signal", Callable(self, "disconnect_signal"))
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


static func _get_variant_param(params: Variant, key: String, index: int, default_value: Variant) -> Variant:
	if params is Dictionary:
		var dict: Dictionary = params as Dictionary
		if dict.has(key):
			return dict[key]
	elif params is Array:
		var arr: Array = params as Array
		if index >= 0 and index < arr.size():
			return arr[index]
	return default_value
