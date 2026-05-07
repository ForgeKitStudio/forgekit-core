extends GutTest
## Unit tests for McpTransactionTools: the JSON-RPC handler adapter that
## exposes `transaction.begin / commit / rollback` on top of the
## TransactionManager backend.
##
## The adapter wires three MCP methods onto a McpJsonRpcDispatcher. Each
## handler extracts its arguments from the JSON-RPC `params` payload, calls
## the corresponding TransactionManager method, and returns either a
## success dict (`{transaction_id}`, `{committed: true, transaction_id}`,
## `{rolled_back: true, transaction_id}`) or the TRANSACTION_NOT_OPEN
## error envelope bubbled up from the manager.


const TRANSACTION_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/transaction_tools.gd")
const TRANSACTION_MANAGER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/transaction_manager.gd")
const DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")
const MCP_ERROR_CODES_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/mcp_error_codes.gd")


# ---------------------------------------------------------------------------
# FakeUndoRedo — duck-typed stand-in reused by the TransactionManager tests.
# ---------------------------------------------------------------------------

class FakeUndoRedo:
	extends RefCounted

	var calls: Array = []

	func create_action(name: String, merge_mode: int = 0) -> void:
		calls.append({"op": "create_action", "name": name, "merge_mode": merge_mode})

	func add_do_method(_callable: Callable) -> void:
		calls.append({"op": "add_do_method"})

	func add_undo_method(_callable: Callable) -> void:
		calls.append({"op": "add_undo_method"})

	func commit_action(execute: bool = true) -> void:
		calls.append({"op": "commit_action", "execute": execute})

	func find_first(op_name: String) -> Dictionary:
		for c in calls:
			if (c as Dictionary).get("op", "") == op_name:
				return c
		return {}


func _new_env() -> Dictionary:
	var mgr: Object = TRANSACTION_MANAGER_SCRIPT.new()
	var fake: FakeUndoRedo = FakeUndoRedo.new()
	mgr.set_undo_redo(fake)
	var tools: Object = TRANSACTION_TOOLS_SCRIPT.new(mgr)
	return {"mgr": mgr, "fake": fake, "tools": tools}


# ---------------------------------------------------------------------------
# 1) begin handler — no params → returns {transaction_id: <32-hex>}
# ---------------------------------------------------------------------------

func test_begin_handler_returns_transaction_id_on_empty_params() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]

	var result: Variant = tools.begin({})

	assert_true(result is Dictionary, "begin() must return a Dictionary")
	var dict: Dictionary = result as Dictionary
	assert_true(dict.has("transaction_id"), "begin() result must include transaction_id")
	var tx_id: String = dict.get("transaction_id", "")
	assert_false(tx_id.is_empty(), "transaction_id must be a non-empty String")
	assert_eq(tx_id.length(), 32, "transaction_id must be 32 hex characters (16 random bytes)")


# ---------------------------------------------------------------------------
# 2) begin handler — {name: "..."} forwards the name to TransactionManager
# ---------------------------------------------------------------------------

func test_begin_handler_forwards_name_to_manager() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var mgr: Object = env["mgr"]
	var fake: FakeUndoRedo = env["fake"]

	var result: Variant = tools.begin({"name": "custom action"})
	var tx_id: String = (result as Dictionary).get("transaction_id", "")

	var commit_result: Variant = tools.commit({"transaction_id": tx_id})
	assert_true((commit_result as Dictionary).get("committed", false), "commit must succeed")

	var create_call: Dictionary = fake.find_first("create_action")
	assert_eq(create_call.get("name", ""), "custom action", "UndoRedo action name must reflect the begin() name parameter")
	assert_false(mgr.is_open(tx_id), "Transaction must be closed after commit")


# ---------------------------------------------------------------------------
# 3) begin handler — missing/empty name uses TransactionManager default
# ---------------------------------------------------------------------------

func test_begin_handler_defaults_to_mcp_batch_when_name_empty() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var fake: FakeUndoRedo = env["fake"]

	var result: Variant = tools.begin({})
	var tx_id: String = (result as Dictionary).get("transaction_id", "")
	var _commit: Variant = tools.commit({"transaction_id": tx_id})

	var create_call: Dictionary = fake.find_first("create_action")
	assert_eq(create_call.get("name", ""), "MCP: batch", "Empty name must default to 'MCP: batch'")


# ---------------------------------------------------------------------------
# 4) commit handler — returns {committed: true, transaction_id} on known tx
# ---------------------------------------------------------------------------

func test_commit_handler_returns_committed_true_on_known_tx() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]

	var tx_id: String = (tools.begin({}) as Dictionary).get("transaction_id", "")
	var commit_result: Variant = tools.commit({"transaction_id": tx_id})

	assert_true(commit_result is Dictionary, "commit() must return a Dictionary")
	var dict: Dictionary = commit_result as Dictionary
	assert_true(dict.get("committed", false), "Known tx commit must return committed=true")
	assert_eq(dict.get("transaction_id", ""), tx_id, "Result must echo the transaction_id")
	assert_false(dict.has("error"), "Successful commit must not include an 'error' field")


# ---------------------------------------------------------------------------
# 5) commit handler — returns TRANSACTION_NOT_OPEN envelope on unknown tx
# ---------------------------------------------------------------------------

func test_commit_handler_returns_transaction_not_open_on_unknown_tx() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]

	var result: Variant = tools.commit({"transaction_id": "does-not-exist"})

	assert_true(result is Dictionary, "commit() must return a Dictionary")
	var dict: Dictionary = result as Dictionary
	assert_true(dict.has("error"), "Unknown tx commit must return an 'error' envelope")
	var err: Dictionary = dict.get("error", {})
	assert_eq(err.get("code", 0), MCP_ERROR_CODES_SCRIPT.TRANSACTION_NOT_OPEN, "Error code must be -32009 TRANSACTION_NOT_OPEN")
	assert_eq(err.get("message", ""), "TRANSACTION_NOT_OPEN", "Error message must be the literal 'TRANSACTION_NOT_OPEN'")
	var data: Dictionary = err.get("data", {})
	assert_eq(data.get("transaction_id", ""), "does-not-exist", "Error data must echo the offending transaction_id")


# ---------------------------------------------------------------------------
# 6) commit handler — missing transaction_id param → TRANSACTION_NOT_OPEN
# ---------------------------------------------------------------------------

func test_commit_handler_returns_transaction_not_open_on_missing_tx_id() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]

	var result: Variant = tools.commit({})

	var err: Dictionary = (result as Dictionary).get("error", {})
	assert_eq(err.get("code", 0), MCP_ERROR_CODES_SCRIPT.TRANSACTION_NOT_OPEN, "Missing transaction_id must yield TRANSACTION_NOT_OPEN")


# ---------------------------------------------------------------------------
# 7) rollback handler — returns {rolled_back: true, transaction_id} on known tx
# ---------------------------------------------------------------------------

func test_rollback_handler_returns_rolled_back_true_on_known_tx() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]

	var tx_id: String = (tools.begin({}) as Dictionary).get("transaction_id", "")
	var result: Variant = tools.rollback({"transaction_id": tx_id})

	var dict: Dictionary = result as Dictionary
	assert_true(dict.get("rolled_back", false), "Known tx rollback must return rolled_back=true")
	assert_eq(dict.get("transaction_id", ""), tx_id, "Result must echo the transaction_id")
	assert_false(dict.has("error"), "Successful rollback must not include an 'error' field")


# ---------------------------------------------------------------------------
# 8) rollback handler — returns TRANSACTION_NOT_OPEN on unknown tx
# ---------------------------------------------------------------------------

func test_rollback_handler_returns_transaction_not_open_on_unknown_tx() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]

	var result: Variant = tools.rollback({"transaction_id": "missing"})

	var err: Dictionary = (result as Dictionary).get("error", {})
	assert_eq(err.get("code", 0), MCP_ERROR_CODES_SCRIPT.TRANSACTION_NOT_OPEN, "Unknown tx rollback must yield TRANSACTION_NOT_OPEN")
	var data: Dictionary = err.get("data", {})
	assert_eq(data.get("transaction_id", ""), "missing", "Error data must echo the offending transaction_id")


# ---------------------------------------------------------------------------
# 9) register_on() — wires all three MCP method names on the dispatcher
# ---------------------------------------------------------------------------

func test_register_on_wires_all_three_mcp_methods() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var dispatcher: Object = DISPATCHER_SCRIPT.new()

	tools.register_on(dispatcher)

	# transaction.begin is reachable
	var begin_response: Dictionary = dispatcher.dispatch({
		"jsonrpc": "2.0",
		"method": "transaction.begin",
		"params": {},
		"id": 1,
	})
	assert_true(begin_response.has("result"), "transaction.begin must be reachable after register_on()")
	var tx_id: String = (begin_response.get("result", {}) as Dictionary).get("transaction_id", "")
	assert_false(tx_id.is_empty(), "transaction.begin must return a non-empty transaction_id")

	# transaction.commit is reachable and succeeds
	var commit_response: Dictionary = dispatcher.dispatch({
		"jsonrpc": "2.0",
		"method": "transaction.commit",
		"params": {"transaction_id": tx_id},
		"id": 2,
	})
	assert_true(commit_response.has("result"), "transaction.commit must be reachable after register_on()")
	assert_true((commit_response.get("result", {}) as Dictionary).get("committed", false), "transaction.commit must return committed=true")

	# transaction.rollback is reachable
	var rb_begin: Dictionary = dispatcher.dispatch({
		"jsonrpc": "2.0",
		"method": "transaction.begin",
		"params": {"name": "rb"},
		"id": 3,
	})
	var rb_tx_id: String = (rb_begin.get("result", {}) as Dictionary).get("transaction_id", "")
	var rollback_response: Dictionary = dispatcher.dispatch({
		"jsonrpc": "2.0",
		"method": "transaction.rollback",
		"params": {"transaction_id": rb_tx_id},
		"id": 4,
	})
	assert_true(rollback_response.has("result"), "transaction.rollback must be reachable after register_on()")
	assert_true((rollback_response.get("result", {}) as Dictionary).get("rolled_back", false), "transaction.rollback must return rolled_back=true")


# ---------------------------------------------------------------------------
# 10) End-to-end: TRANSACTION_NOT_OPEN returned by the handler is hoisted to
#     a JSON-RPC error envelope by the dispatcher, not wrapped in 'result'.
# ---------------------------------------------------------------------------

func test_dispatcher_hoists_transaction_not_open_to_error_envelope() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var dispatcher: Object = DISPATCHER_SCRIPT.new()
	tools.register_on(dispatcher)

	var response: Dictionary = dispatcher.dispatch({
		"jsonrpc": "2.0",
		"method": "transaction.commit",
		"params": {"transaction_id": "no-such-tx"},
		"id": 42,
	})

	assert_false(response.has("result"), "Business-error response must not carry a 'result' field")
	assert_true(response.has("error"), "Business-error response must carry a top-level 'error' envelope")
	var err: Dictionary = response.get("error", {})
	assert_eq(err.get("code", 0), MCP_ERROR_CODES_SCRIPT.TRANSACTION_NOT_OPEN, "Error code must be -32009 TRANSACTION_NOT_OPEN")
	assert_eq(err.get("message", ""), "TRANSACTION_NOT_OPEN", "Error message must be the literal 'TRANSACTION_NOT_OPEN'")
	var data: Dictionary = err.get("data", {})
	assert_eq(data.get("transaction_id", ""), "no-such-tx", "Error data must echo the offending transaction_id")
	assert_eq(response.get("id", null), 42, "Error envelope must echo the request id")
	assert_eq(response.get("jsonrpc", ""), "2.0", "Error envelope must declare jsonrpc 2.0")


# ---------------------------------------------------------------------------
# 11) begin/commit sequence through the dispatcher builds one UndoRedo action
#     for N registered operations (foundation for Property 13).
# ---------------------------------------------------------------------------

func test_dispatch_begin_commit_collapses_operations_into_single_undo_action() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var mgr: Object = env["mgr"]
	var fake: FakeUndoRedo = env["fake"]
	var dispatcher: Object = DISPATCHER_SCRIPT.new()
	tools.register_on(dispatcher)

	var begin_response: Dictionary = dispatcher.dispatch({
		"jsonrpc": "2.0",
		"method": "transaction.begin",
		"params": {"name": "multi-op"},
		"id": 1,
	})
	var tx_id: String = (begin_response.get("result", {}) as Dictionary).get("transaction_id", "")

	# Register 3 ops directly on the manager to simulate other MCP tools
	# enqueueing work inside the open transaction.
	var sink: RefCounted = RefCounted.new()
	for i in range(3):
		mgr.register_operation(tx_id, Callable(sink, "reference"), Callable(sink, "reference"))

	var _commit_response: Dictionary = dispatcher.dispatch({
		"jsonrpc": "2.0",
		"method": "transaction.commit",
		"params": {"transaction_id": tx_id},
		"id": 2,
	})

	var create_calls: int = 0
	var commit_calls: int = 0
	for c in fake.calls:
		if (c as Dictionary).get("op", "") == "create_action":
			create_calls += 1
		if (c as Dictionary).get("op", "") == "commit_action":
			commit_calls += 1
	assert_eq(create_calls, 1, "Exactly one create_action must be opened for the whole transaction")
	assert_eq(commit_calls, 1, "Exactly one commit_action must close the transaction")
