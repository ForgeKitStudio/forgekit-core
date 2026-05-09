extends RefCounted
## McpBlendTreeTools — JSON-RPC handler adapter for the one editor-channel
## Blend Tree MCP tool on top of a duck-typed BlendTreeBackend.
##
##   blend_tree.configure_node(tree_path, node_id, type, params?)  (UndoRedo)
##
## `type` is a `AnimationNode` subclass name (e.g. `Blend2`, `Blend3`,
## `BlendSpace1D`, `Animation`). The mutation flows through
## `McpUndoRedoWrapper` inside the backend so a single Ctrl+Z reverts the
## configuration.


class_name McpBlendTreeTools


var _backend: Object = null


func _init(backend: Object = null) -> void:
	_backend = backend


func set_backend(backend: Object) -> void:
	_backend = backend


# ---------------------------------------------------------------------------
# MCP tool handlers.
# ---------------------------------------------------------------------------

func configure_node(params: Variant) -> Variant:
	var tree_path: String = _get_string_param(params, "tree_path", 0, "")
	var node_id: String = _get_string_param(params, "node_id", 1, "")
	var type: String = _get_string_param(params, "type", 2, "")
	var p: Dictionary = _get_dict_param(params, "params", 3, {})
	return _backend.configure_node(tree_path, node_id, type, p)


## Register the one editor-channel Blend Tree MCP method on the supplied
## dispatcher. Returns `self` so the caller can chain.
func register_on(dispatcher: Object) -> Object:
	dispatcher.register_handler("blend_tree.configure_node", Callable(self, "configure_node"))
	return self


# ---------------------------------------------------------------------------
# Internals.
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


static func _get_dict_param(params: Variant, key: String, index: int, default_value: Dictionary) -> Dictionary:
	if params is Dictionary:
		var dict: Dictionary = params as Dictionary
		if dict.has(key):
			var v: Variant = dict[key]
			if v is Dictionary:
				return v as Dictionary
	elif params is Array:
		var arr: Array = params as Array
		if index >= 0 and index < arr.size():
			var v: Variant = arr[index]
			if v is Dictionary:
				return v as Dictionary
	return default_value
