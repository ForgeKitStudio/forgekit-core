extends RefCounted
## McpEditorBatchTools — JSON-RPC handler adapter for the two editor-channel
## Batch MCP tools.
##
##   batch.execute(ops, transactional?)  → {results, committed}
##   batch.dry_run(ops)                   → {would_apply}
##
## The adapter is intentionally thin. It translates by-name (Dictionary) and
## by-position (Array) JSON-RPC params into calls on an injected
## EditorBatchBackend. The backend wraps the production TransactionManager
## (for `transactional = true`) and the existing MCP tool handlers (so each
## op is dispatched through the same code path a single-tool call would
## take), and is duck-typed so the adapter runs headlessly against a fake
## in tests.
##
## Transactional semantics (Requirement 35.1):
##
## When `transactional = true` the backend opens a TransactionManager
## transaction before running any op, registers every mutation's do/undo
## pair with that transaction, and calls `commit()` exactly once after the
## final op succeeds. If any op returns an `{"error": {...}}` envelope the
## backend calls `rollback()` and surfaces the failure so the caller sees
## the original envelope plus `committed = false`. A single Ctrl+Z in the
## editor therefore undoes the entire batch as one UndoRedo action.
##
## Dry-run semantics (Requirement 35.2):
##
## `batch.dry_run` never mutates state on disk. The backend simulates each
## op through its validation path (for example the GDScript_Validator for
## `script.create`) and returns a `would_apply` list describing the
## predicted outcome for each op without touching the filesystem.
##
## Backends signal business-level failures (TRANSACTION_NOT_OPEN,
## CORE_BOUNDARY_VIOLATION, FILE_NOT_FOUND, ...) by returning a Dictionary
## shaped `{"error": {...}}`. This adapter returns that envelope verbatim
## so the JSON-RPC dispatcher can hoist it into a top-level JSON-RPC error
## response.


class_name McpEditorBatchTools


# Injected EditorBatchBackend (duck-typed). Only invoked through its public
# methods so the adapter parses cleanly on headless builds without editor
# types being available.
var _backend: Object = null


func _init(backend: Object = null) -> void:
	_backend = backend


func set_backend(backend: Object) -> void:
	_backend = backend


# ---------------------------------------------------------------------------
# MCP tool handlers.
# ---------------------------------------------------------------------------

func execute(params: Variant) -> Variant:
	var ops: Array = _get_array_param(params, "ops", 0, [])
	var transactional: bool = _get_bool_param(params, "transactional", 1, false)
	return _backend.execute(ops, transactional)


func dry_run(params: Variant) -> Variant:
	var ops: Array = _get_array_param(params, "ops", 0, [])
	return _backend.dry_run(ops)


## Bulk-register both Batch MCP methods on the supplied dispatcher. Returns
## `self` so the caller can chain. Duck-types against
## `McpJsonRpcDispatcher.register_handler`.
func register_on(dispatcher: Object) -> Object:
	dispatcher.register_handler("batch.execute", Callable(self, "execute"))
	dispatcher.register_handler("batch.dry_run", Callable(self, "dry_run"))
	return self


# ---------------------------------------------------------------------------
# Internals. Accept both by-name (Dictionary) and by-position (Array)
# JSON-RPC params conventions.
# ---------------------------------------------------------------------------

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
