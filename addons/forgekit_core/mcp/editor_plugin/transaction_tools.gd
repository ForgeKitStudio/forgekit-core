extends RefCounted
## McpTransactionTools — JSON-RPC handler adapter for the `transaction.*`
## MCP tools.
##
## Exposes three methods that translate JSON-RPC calls into calls on an
## injected TransactionManager:
##
##   transaction.begin(name?)          → {"transaction_id": String}
##   transaction.commit(transaction_id)  → {"committed": true, "transaction_id": String}
##   transaction.rollback(transaction_id)→ {"rolled_back": true, "transaction_id": String}
##
## When the underlying manager rejects commit/rollback for an unknown
## `transaction_id`, the handler returns the TRANSACTION_NOT_OPEN error
## envelope unchanged. The JSON-RPC dispatcher hoists any handler return
## value shaped `{"error": {...}}` into a top-level JSON-RPC error
## response so callers see a standards-compliant error envelope rather
## than a `result` that happens to contain an `error` field.
##
## The handler can be attached to a dispatcher in two ways:
##   1. Explicit per-method wiring by the caller, using
##      `dispatcher.register_handler("transaction.begin", Callable(tools, "begin"))`
##      etc.
##   2. Convenience bulk wiring via `tools.register_on(dispatcher)` which
##      registers all three methods at once.


class_name McpTransactionTools


const MCP_ERROR_CODES: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/mcp_error_codes.gd")


# Injected TransactionManager. Kept as a generic Object so the adapter
# parses headless — the manager only needs `begin(name)`, `commit(tx_id)`,
# and `rollback(tx_id)`.
var _manager: Object = null


func _init(manager: Object = null) -> void:
	_manager = manager


func set_manager(manager: Object) -> void:
	_manager = manager


# ---------------------------------------------------------------------------
# MCP tool handlers. Each accepts the JSON-RPC `params` payload (Dictionary
# for by-name, Array for by-position) and returns either the tool result or
# a `{"error": {...}}` envelope for business-level failures.
# ---------------------------------------------------------------------------

func begin(params: Variant) -> Variant:
	var name: String = _get_string_param(params, "name", 0, "")
	var tx_id: String = _manager.begin(name)
	return {"transaction_id": tx_id}


func commit(params: Variant) -> Variant:
	var tx_id: String = _get_string_param(params, "transaction_id", 0, "")
	return _manager.commit(tx_id)


func rollback(params: Variant) -> Variant:
	var tx_id: String = _get_string_param(params, "transaction_id", 0, "")
	return _manager.rollback(tx_id)


## Bulk-register `transaction.begin`, `transaction.commit` and
## `transaction.rollback` on the supplied dispatcher. Returns `self` so the
## caller can chain. Duck-types against `McpJsonRpcDispatcher.register_handler`.
func register_on(dispatcher: Object) -> Object:
	dispatcher.register_handler("transaction.begin", Callable(self, "begin"))
	dispatcher.register_handler("transaction.commit", Callable(self, "commit"))
	dispatcher.register_handler("transaction.rollback", Callable(self, "rollback"))
	return self


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------

## Pull a String from `params`. Supports both Dictionary (by-name) and Array
## (by-position) JSON-RPC conventions. Returns `default_value` when the field
## is absent or not a String.
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
