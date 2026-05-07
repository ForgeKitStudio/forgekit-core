extends GutTest
## Unit tests for TransactionManager: begin/commit/rollback lifecycle, unique
## transaction ids, TRANSACTION_NOT_OPEN error shape, pending operation
## registration, reverse-order rollback, and single-action collapse onto the
## injected EditorUndoRedoManager stand-in.


const TRANSACTION_MANAGER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/transaction_manager.gd")
const MCP_ERROR_CODES_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/mcp_error_codes.gd")


# ---------------------------------------------------------------------------
# FakeUndoRedo — a minimal duck-typed stand-in for EditorUndoRedoManager that
# records the call sequence. Headless GUT cannot instantiate the real editor
# singleton, so the TransactionManager is written against a narrow interface
# that this fake satisfies.
# ---------------------------------------------------------------------------

class FakeUndoRedo:
	extends RefCounted

	var calls: Array = []
	var _current_action_open: bool = false

	func create_action(name: String, merge_mode: int = 0) -> void:
		calls.append({"op": "create_action", "name": name, "merge_mode": merge_mode})
		_current_action_open = true

	func add_do_method(callable: Callable) -> void:
		calls.append({"op": "add_do_method", "callable": callable})

	func add_undo_method(callable: Callable) -> void:
		calls.append({"op": "add_undo_method", "callable": callable})

	func commit_action(execute: bool = true) -> void:
		calls.append({"op": "commit_action", "execute": execute})
		_current_action_open = false

	func count_calls(op_name: String) -> int:
		var n: int = 0
		for c in calls:
			if (c as Dictionary).get("op", "") == op_name:
				n += 1
		return n

	func find_first(op_name: String) -> Dictionary:
		for c in calls:
			if (c as Dictionary).get("op", "") == op_name:
				return c
		return {}


func _new_manager() -> Object:
	var mgr: Object = TRANSACTION_MANAGER_SCRIPT.new()
	var fake: FakeUndoRedo = FakeUndoRedo.new()
	mgr.set_undo_redo(fake)
	return mgr


# A tiny mutable sink used to observe undo callable ordering during rollback.
class UndoSink:
	extends RefCounted

	var log: Array = []

	func record(tag: String) -> void:
		log.append(tag)


# ---------------------------------------------------------------------------
# 1) begin() — ids are unique and non-empty
# ---------------------------------------------------------------------------

func test_begin_returns_unique_transaction_id() -> void:
	var mgr: Object = _new_manager()
	var seen: Dictionary = {}
	for i in range(100):
		var tx_id: String = mgr.begin()
		assert_true(tx_id is String, "begin() must return a String id")
		assert_false(tx_id.is_empty(), "begin() must return a non-empty id")
		assert_false(seen.has(tx_id), "begin() must return a unique id; collision at iteration %d" % i)
		seen[tx_id] = true


# ---------------------------------------------------------------------------
# 2) begin("name") — custom name is forwarded as the EditorUndoRedoManager
#    action name on commit.
# ---------------------------------------------------------------------------

func test_begin_with_custom_name_uses_that_name_for_undo_action() -> void:
	var mgr: Object = TRANSACTION_MANAGER_SCRIPT.new()
	var fake: FakeUndoRedo = FakeUndoRedo.new()
	mgr.set_undo_redo(fake)

	var tx_id: String = mgr.begin("my op")
	var target: UndoSink = UndoSink.new()
	mgr.register_operation(tx_id, Callable(target, "record").bind("do"), Callable(target, "record").bind("undo"))
	var _result: Dictionary = mgr.commit(tx_id)

	var create_call: Dictionary = fake.find_first("create_action")
	assert_false(create_call.is_empty(), "FakeUndoRedo must receive a create_action call after commit")
	assert_eq(create_call.get("name", ""), "my op", "create_action must use the transaction name from begin()")


# ---------------------------------------------------------------------------
# 3) begin() with empty/missing name defaults to "MCP: batch".
# ---------------------------------------------------------------------------

func test_begin_with_empty_name_defaults_to_mcp_batch() -> void:
	var mgr: Object = TRANSACTION_MANAGER_SCRIPT.new()
	var fake: FakeUndoRedo = FakeUndoRedo.new()
	mgr.set_undo_redo(fake)

	var tx_id: String = mgr.begin()
	var target: UndoSink = UndoSink.new()
	mgr.register_operation(tx_id, Callable(target, "record").bind("do"), Callable(target, "record").bind("undo"))
	var _result: Dictionary = mgr.commit(tx_id)

	var create_call: Dictionary = fake.find_first("create_action")
	assert_false(create_call.is_empty(), "FakeUndoRedo must receive a create_action call after commit")
	assert_eq(create_call.get("name", ""), "MCP: batch", "Empty name must default to 'MCP: batch'")


# ---------------------------------------------------------------------------
# 4) commit() on a known transaction returns {committed: true, transaction_id}.
# ---------------------------------------------------------------------------

func test_commit_returns_committed_true_on_known_tx() -> void:
	var mgr: Object = _new_manager()
	var tx_id: String = mgr.begin()

	var result: Dictionary = mgr.commit(tx_id)

	assert_true(result.get("committed", false), "commit() on a known tx must return committed=true")
	assert_eq(result.get("transaction_id", ""), tx_id, "commit() result must echo the transaction_id")
	assert_false(result.has("error"), "Successful commit must not include an 'error' field")


# ---------------------------------------------------------------------------
# 5) commit() with an unknown tx_id returns TRANSACTION_NOT_OPEN (-32009).
# ---------------------------------------------------------------------------

func test_commit_with_unknown_tx_returns_transaction_not_open_error() -> void:
	var mgr: Object = _new_manager()

	var result: Dictionary = mgr.commit("does-not-exist")

	assert_true(result.has("error"), "Unknown tx commit must return an 'error' dict")
	var err: Dictionary = result.get("error", {})
	assert_eq(err.get("code", 0), MCP_ERROR_CODES_SCRIPT.TRANSACTION_NOT_OPEN, "Error code must be TRANSACTION_NOT_OPEN (-32009)")
	assert_eq(err.get("message", ""), "TRANSACTION_NOT_OPEN", "Error message must be the literal 'TRANSACTION_NOT_OPEN'")
	var data: Dictionary = err.get("data", {})
	assert_eq(data.get("transaction_id", ""), "does-not-exist", "Error data must echo the offending transaction_id")


# ---------------------------------------------------------------------------
# 6) Second commit on the same tx must fail: the transaction is closed after
#    the first successful commit.
# ---------------------------------------------------------------------------

func test_commit_twice_on_same_tx_returns_error_on_second_call() -> void:
	var mgr: Object = _new_manager()
	var tx_id: String = mgr.begin()

	var first: Dictionary = mgr.commit(tx_id)
	assert_true(first.get("committed", false), "First commit must succeed")

	var second: Dictionary = mgr.commit(tx_id)
	assert_true(second.has("error"), "Second commit on the same tx must return an error")
	var err: Dictionary = second.get("error", {})
	assert_eq(err.get("code", 0), MCP_ERROR_CODES_SCRIPT.TRANSACTION_NOT_OPEN, "Second commit must raise TRANSACTION_NOT_OPEN")


# ---------------------------------------------------------------------------
# 7) rollback() on a known transaction returns {rolled_back: true, transaction_id}.
# ---------------------------------------------------------------------------

func test_rollback_returns_rolled_back_true_on_known_tx() -> void:
	var mgr: Object = _new_manager()
	var tx_id: String = mgr.begin()

	var result: Dictionary = mgr.rollback(tx_id)

	assert_true(result.get("rolled_back", false), "rollback() on a known tx must return rolled_back=true")
	assert_eq(result.get("transaction_id", ""), tx_id, "rollback() result must echo the transaction_id")
	assert_false(result.has("error"), "Successful rollback must not include an 'error' field")


# ---------------------------------------------------------------------------
# 8) rollback() with an unknown tx_id returns TRANSACTION_NOT_OPEN.
# ---------------------------------------------------------------------------

func test_rollback_with_unknown_tx_returns_transaction_not_open_error() -> void:
	var mgr: Object = _new_manager()

	var result: Dictionary = mgr.rollback("missing-tx")

	assert_true(result.has("error"), "Unknown tx rollback must return an 'error' dict")
	var err: Dictionary = result.get("error", {})
	assert_eq(err.get("code", 0), MCP_ERROR_CODES_SCRIPT.TRANSACTION_NOT_OPEN, "Error code must be TRANSACTION_NOT_OPEN")
	assert_eq(err.get("message", ""), "TRANSACTION_NOT_OPEN", "Error message must be the literal 'TRANSACTION_NOT_OPEN'")
	var data: Dictionary = err.get("data", {})
	assert_eq(data.get("transaction_id", ""), "missing-tx", "Error data must echo the offending transaction_id")


# ---------------------------------------------------------------------------
# 9) rollback() invokes undo callables in reverse insertion order.
# ---------------------------------------------------------------------------

func test_rollback_executes_undo_callables_in_reverse_order() -> void:
	var mgr: Object = _new_manager()
	var sink: UndoSink = UndoSink.new()

	var tx_id: String = mgr.begin()
	mgr.register_operation(tx_id, Callable(sink, "record").bind("do_a"), Callable(sink, "record").bind("undo_a"))
	mgr.register_operation(tx_id, Callable(sink, "record").bind("do_b"), Callable(sink, "record").bind("undo_b"))
	mgr.register_operation(tx_id, Callable(sink, "record").bind("do_c"), Callable(sink, "record").bind("undo_c"))

	var _result: Dictionary = mgr.rollback(tx_id)

	assert_eq(sink.log, ["undo_c", "undo_b", "undo_a"], "Rollback must invoke undo callables in reverse insertion order")


# ---------------------------------------------------------------------------
# 10) commit() finalizes N registered operations as a single UndoRedo action.
#     (Foundation for Property 13 from the design.)
# ---------------------------------------------------------------------------

func test_commit_finalizes_single_undo_action_for_n_operations() -> void:
	var mgr: Object = TRANSACTION_MANAGER_SCRIPT.new()
	var fake: FakeUndoRedo = FakeUndoRedo.new()
	mgr.set_undo_redo(fake)

	var tx_id: String = mgr.begin("batch")
	var sink: UndoSink = UndoSink.new()
	for i in range(5):
		mgr.register_operation(
			tx_id,
			Callable(sink, "record").bind("do_%d" % i),
			Callable(sink, "record").bind("undo_%d" % i)
		)

	var result: Dictionary = mgr.commit(tx_id)

	assert_true(result.get("committed", false), "Commit of 5 operations must succeed")
	assert_eq(fake.count_calls("create_action"), 1, "FakeUndoRedo must receive exactly one create_action call")
	assert_eq(fake.count_calls("commit_action"), 1, "FakeUndoRedo must receive exactly one commit_action call")
	assert_eq(fake.count_calls("add_do_method"), 5, "All 5 do-callables must be registered on the single action")
	assert_eq(fake.count_calls("add_undo_method"), 5, "All 5 undo-callables must be registered on the single action")


# ---------------------------------------------------------------------------
# 11) is_open() reflects the transaction lifecycle.
# ---------------------------------------------------------------------------

func test_is_open_reflects_transaction_lifecycle() -> void:
	var mgr: Object = _new_manager()

	assert_false(mgr.is_open("never-existed"), "Unknown id must not be reported as open")

	var tx_id: String = mgr.begin()
	assert_true(mgr.is_open(tx_id), "Transaction must be open after begin()")

	var _c: Dictionary = mgr.commit(tx_id)
	assert_false(mgr.is_open(tx_id), "Transaction must not be open after commit()")

	var tx_id2: String = mgr.begin()
	assert_true(mgr.is_open(tx_id2), "Second transaction must be open after begin()")
	var _r: Dictionary = mgr.rollback(tx_id2)
	assert_false(mgr.is_open(tx_id2), "Transaction must not be open after rollback()")


# ---------------------------------------------------------------------------
# 12) register_operation() with unknown tx_id returns false (no push_error).
# ---------------------------------------------------------------------------

func test_register_operation_with_unknown_tx_returns_false() -> void:
	var mgr: Object = _new_manager()
	var sink: UndoSink = UndoSink.new()

	var ok: bool = mgr.register_operation(
		"unknown-tx",
		Callable(sink, "record").bind("do"),
		Callable(sink, "record").bind("undo")
	)

	assert_false(ok, "register_operation with unknown tx_id must return false")
	assert_eq(get_errors().size(), 0, "register_operation must not emit push_error for unknown tx_id")
