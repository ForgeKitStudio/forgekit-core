extends RefCounted
## TransactionManager — collapses a sequence of MCP mutating operations into a
## single EditorUndoRedoManager action.
##
## A transaction is started with `begin(name)` which returns a unique
## `transaction_id`. Subsequent mutating tools call `register_operation` with
## paired do/undo callables to enqueue work. `commit(tx_id)` opens a single
## UndoRedo action, replays all enqueued do-methods + undo-methods on it, and
## commits it as one entry on the Undo stack. `rollback(tx_id)` discards the
## transaction and invokes the registered undo callables in reverse insertion
## order to restore pre-transaction state.
##
## The EditorUndoRedoManager is dependency-injected via `set_undo_redo` so the
## class is testable in headless GUT without an editor instance. The injected
## object is duck-typed — it only needs `create_action(name, merge_mode)`,
## `add_do_method(callable)`, `add_undo_method(callable)`, and
## `commit_action()` (or a superset of these).
##
## TODO(task 2.3 / 2.4): wire TransactionManager into the JSON-RPC dispatcher
## and the Undo_Redo_Wrapper once those components exist. The dispatcher will
## translate `transaction.begin/commit/rollback` MCP calls into these methods
## and convert the returned `error` dict into a JSON-RPC error response.


const MCP_ERROR_CODES: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/mcp_error_codes.gd")

## Default action name used when `begin()` is called without an explicit name
## or with an empty string. Matches the design sequence diagram for Flow 1.
const DEFAULT_ACTION_NAME: String = "MCP: batch"

## MERGE_DISABLE in EditorUndoRedoManager.MergeMode (value 0). Hardcoded so the
## class does not require the editor API to be present at parse time in
## headless test runs.
const _MERGE_DISABLE: int = 0


# Keyed by transaction_id. Each value is a dictionary:
#   {
#     "name":       String,               # UndoRedo action name
#     "operations": Array[Dictionary],    # [{do: Callable, undo: Callable}, ...]
#   }
var _open: Dictionary = {}

# Injected EditorUndoRedoManager (or a duck-typed stand-in in tests). Kept as a
# generic Object so the class parses on headless builds without editor types.
var _undo_redo: Object = null


func set_undo_redo(undo_redo: Object) -> void:
	_undo_redo = undo_redo


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

func begin(name: String = "") -> String:
	var action_name: String = name if not name.is_empty() else DEFAULT_ACTION_NAME
	var tx_id: String = _generate_transaction_id()
	_open[tx_id] = {
		"name": action_name,
		"operations": [],
	}
	return tx_id


func commit(tx_id: String) -> Dictionary:
	if not _open.has(tx_id):
		return _not_open_error(tx_id)

	var entry: Dictionary = _open[tx_id]
	var action_name: String = entry.get("name", DEFAULT_ACTION_NAME)
	var operations: Array = entry.get("operations", [])

	if _undo_redo != null:
		_undo_redo.create_action(action_name, _MERGE_DISABLE)
		for op in operations:
			var op_dict: Dictionary = op
			_undo_redo.add_do_method(op_dict.get("do"))
			_undo_redo.add_undo_method(op_dict.get("undo"))
		_undo_redo.commit_action()
	else:
		push_warning("TransactionManager.commit(%s) has no EditorUndoRedoManager wired; running in degraded mode." % tx_id)

	_open.erase(tx_id)
	return {
		"committed": true,
		"transaction_id": tx_id,
	}


func rollback(tx_id: String) -> Dictionary:
	if not _open.has(tx_id):
		return _not_open_error(tx_id)

	var entry: Dictionary = _open[tx_id]
	var operations: Array = entry.get("operations", [])

	# Invoke undo callables in reverse insertion order so the world is restored
	# to its pre-transaction state in LIFO fashion.
	for i in range(operations.size() - 1, -1, -1):
		var op: Dictionary = operations[i]
		var undo_callable = op.get("undo")
		if undo_callable is Callable and (undo_callable as Callable).is_valid():
			(undo_callable as Callable).call()

	_open.erase(tx_id)
	return {
		"rolled_back": true,
		"transaction_id": tx_id,
	}


func register_operation(tx_id: String, do_callable: Callable, undo_callable: Callable) -> bool:
	if not _open.has(tx_id):
		return false
	var entry: Dictionary = _open[tx_id]
	var operations: Array = entry.get("operations", [])
	operations.append({
		"do": do_callable,
		"undo": undo_callable,
	})
	entry["operations"] = operations
	_open[tx_id] = entry
	return true


func is_open(tx_id: String) -> bool:
	return _open.has(tx_id)


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------

func _generate_transaction_id() -> String:
	# 16 random bytes -> 32 hex chars. Crypto.generate_random_bytes is available
	# on both editor and headless builds and gives enough entropy that the
	# 100-id uniqueness test cannot collide in practice.
	var crypto: Crypto = Crypto.new()
	var bytes: PackedByteArray = crypto.generate_random_bytes(16)
	return bytes.hex_encode()


func _not_open_error(tx_id: String) -> Dictionary:
	return {
		"error": {
			"code": MCP_ERROR_CODES.TRANSACTION_NOT_OPEN,
			"message": MCP_ERROR_CODES.TRANSACTION_NOT_OPEN_MESSAGE,
			"data": {"transaction_id": tx_id},
		},
	}
