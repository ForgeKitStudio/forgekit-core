extends RefCounted
## McpRuntimeNodeTools — JSON-RPC handler adapter for the runtime-channel
## Node MCP tool.
##
## Exposes a single handler that translates JSON-RPC calls into calls on
## an injected RuntimeNodeBackend. The backend is duck-typed so the
## adapter can run headlessly against a fake in unit tests while the
## production backend resolves a node by its absolute path in the live
## SceneTree and invokes the requested method with the supplied args.
##
##   node.call_method(node_path, method, args?) → {returned}
##
## Safety: the backend is expected to gate reachable methods — direct
## invocation of arbitrary GDScript on a live SceneTree is only valid
## when the MCP runtime bridge was started with the `--mcp-bridge` flag
## and the caller supplied a matching `auth_token`. This adapter is the
## parameter-forwarding layer; the enforcement lives in the backend.


class_name McpRuntimeNodeTools


# Injected RuntimeNodeBackend (duck-typed).
var _backend: Object = null


func _init(backend: Object = null) -> void:
	_backend = backend


func set_backend(backend: Object) -> void:
	_backend = backend


# ---------------------------------------------------------------------------
# MCP tool handlers.
# ---------------------------------------------------------------------------

func call_method(params: Variant) -> Variant:
	var node_path: String = _get_string_param(params, "node_path", 0, "")
	var method: String = _get_string_param(params, "method", 1, "")
	var args: Variant = _get_variant_param(params, "args", 2, null)
	if not (args is Array):
		args = []
	return _backend.call_node_method(node_path, method, args)


## Register the runtime Node MCP method on the supplied dispatcher.
## Returns `self` so the caller can chain.
func register_on(dispatcher: Object) -> Object:
	dispatcher.register_handler("node.call_method", Callable(self, "call_method"))
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
