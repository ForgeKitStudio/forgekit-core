extends RefCounted
## McpUndoRedoWrapper — funnels every mutating MCP tool invocation through the
## `EditorUndoRedoManager` so the user can undo any AI-driven change with a
## single Ctrl+Z.
##
## Two flavours of wrap are exposed:
## - `wrap()` for method-level mutations (paired do/undo Callables)
## - `wrap_property()` for property-level mutations (object + property + values)
##
## When an optional `transaction_id` is supplied and is currently open on the
## injected `TransactionManager`, the wrapper enqueues the operation on that
## transaction instead of opening its own standalone action. The transaction
## then collapses N enqueued operations into a single Undo entry on commit.
## An unknown/empty `transaction_id` falls back to standalone wrapping so a
## single-op mutation is still undoable.
##
## `make_non_undoable_warning()` builds the warning envelope (code -32004,
## message "NON_UNDOABLE_OPERATION") that tools attach to successful responses
## when the underlying change happens outside the editor UndoRedo system —
## e.g. writing a file on disk that is not an editor resource. This is a
## warning, not an error: the tool still returns a normal result.
##
## The `EditorUndoRedoManager` is dependency-injected via `set_undo_redo()` so
## the wrapper is headless-testable. The injected object only needs
## `create_action(name, merge_mode)`, `add_do_method(callable)`,
## `add_undo_method(callable)`, `add_do_property(object, property, value)`,
## `add_undo_property(object, property, value)`, and `commit_action()`.


class_name McpUndoRedoWrapper


const MCP_ERROR_CODES: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/mcp_error_codes.gd")


## Matches `TransactionManager.DEFAULT_ACTION_NAME` — used when both
## `tool_name` and `target` are empty.
const DEFAULT_ACTION_NAME: String = "MCP: batch"

## MERGE_DISABLE in EditorUndoRedoManager.MergeMode (value 0). Hardcoded so the
## class parses on headless builds without the editor API loaded.
const _MERGE_DISABLE: int = 0


# Injected EditorUndoRedoManager (or a duck-typed stand-in). Kept as a generic
# Object so the class parses headless.
var _undo_redo: Object = null

# Injected TransactionManager. Optional — when null, every wrap() opens a
# standalone single-op action.
var _transaction_manager: Object = null


func set_undo_redo(undo_redo: Object) -> void:
	_undo_redo = undo_redo


func set_transaction_manager(mgr: Object) -> void:
	_transaction_manager = mgr


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

## Wrap a single method-level mutation. If `transaction_id` is non-empty and
## known to the TransactionManager, enqueue the op on that transaction;
## otherwise open + commit a standalone single-op UndoRedo action.
func wrap(
	tool_name: String,
	target: String,
	do_callable: Callable,
	undo_callable: Callable,
	transaction_id: String = ""
) -> Dictionary:
	if _should_delegate_to_transaction(transaction_id):
		_transaction_manager.register_operation(transaction_id, do_callable, undo_callable)
		return {"wrapped": true, "transaction_id": transaction_id}

	if _undo_redo == null:
		push_warning("McpUndoRedoWrapper.wrap: no EditorUndoRedoManager wired; running in degraded mode.")
		return {"wrapped": true}

	_undo_redo.create_action(format_action_name(tool_name, target), _MERGE_DISABLE)
	_undo_redo.add_do_method(do_callable)
	_undo_redo.add_undo_method(undo_callable)
	_undo_redo.commit_action()
	return {"wrapped": true}


## Wrap a property-level mutation. Same transaction semantics as `wrap()`.
## Inside a transaction the op is enqueued as a method pair that applies the
## new value on redo and the old value on undo; outside a transaction the
## wrapper uses `add_do_property` / `add_undo_property` for native property
## diffing in the UndoRedo stack.
func wrap_property(
	tool_name: String,
	target: String,
	object: Object,
	property: String,
	new_value: Variant,
	old_value: Variant,
	transaction_id: String = ""
) -> Dictionary:
	if _should_delegate_to_transaction(transaction_id):
		var do_c: Callable = Callable(object, "set").bind(property, new_value)
		var undo_c: Callable = Callable(object, "set").bind(property, old_value)
		_transaction_manager.register_operation(transaction_id, do_c, undo_c)
		return {"wrapped": true, "transaction_id": transaction_id}

	if _undo_redo == null:
		push_warning("McpUndoRedoWrapper.wrap_property: no EditorUndoRedoManager wired; running in degraded mode.")
		return {"wrapped": true}

	_undo_redo.create_action(format_action_name(tool_name, target), _MERGE_DISABLE)
	_undo_redo.add_do_property(object, property, new_value)
	_undo_redo.add_undo_property(object, property, old_value)
	_undo_redo.commit_action()
	return {"wrapped": true}


## Build the NON_UNDOABLE_OPERATION warning envelope. Tools attach this to
## successful responses when their mutation lives outside the UndoRedo system.
static func make_non_undoable_warning(tool_name: String, target: String, reason: String) -> Dictionary:
	var suggestion: String = _default_non_undoable_suggestion()
	return {
		"code": MCP_ERROR_CODES.NON_UNDOABLE_OPERATION,
		"message": MCP_ERROR_CODES.NON_UNDOABLE_OPERATION_MESSAGE,
		"data": {
			"tool_name": tool_name,
			"target": target,
			"reason": reason,
			"suggestion": suggestion,
		},
	}


## Format an UndoRedo action name as `"MCP: <tool_name> <target>"`. Falls back
## to `"MCP: <tool_name>"` when target is empty and to `"MCP: batch"` when
## both are empty (matches TransactionManager convention).
static func format_action_name(tool_name: String, target: String) -> String:
	var tool_trimmed: String = tool_name.strip_edges()
	var target_trimmed: String = target.strip_edges()
	if tool_trimmed.is_empty() and target_trimmed.is_empty():
		return DEFAULT_ACTION_NAME
	if target_trimmed.is_empty():
		return "MCP: %s" % tool_trimmed
	return "MCP: %s %s" % [tool_trimmed, target_trimmed]


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------

func _should_delegate_to_transaction(transaction_id: String) -> bool:
	if transaction_id.is_empty():
		return false
	if _transaction_manager == null:
		return false
	return _transaction_manager.is_open(transaction_id)


static func _default_non_undoable_suggestion() -> String:
	# Pulled from mcp_error_codes.gd so the suggestion text stays in sync
	# across the rest of the MCP surface. Using make_error() here would drag
	# an extra "code" nesting into data; we only need the suggestion string.
	return MCP_ERROR_CODES.make_error(MCP_ERROR_CODES.NON_UNDOABLE_OPERATION).get("data", {}).get("suggestion", "")
