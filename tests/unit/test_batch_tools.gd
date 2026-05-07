extends GutTest
## Unit tests for McpEditorBatchTools: JSON-RPC handler adapter that exposes
## the editor-channel `batch.execute` and `batch.dry_run` MCP tools on top
## of a duck-typed EditorBatchBackend.
##
## The adapter extracts parameters from each JSON-RPC `params` payload,
## calls the matching backend method, and returns the backend's result
## verbatim. Business-level errors surface as `{"error": {...}}` envelopes
## that the dispatcher hoists to JSON-RPC error responses.


const BATCH_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/tools/batch_tools.gd")
const DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")
const MCP_ERROR_CODES_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/mcp_error_codes.gd")


# ---------------------------------------------------------------------------
# FakeEditorBatchBackend — records every call and returns either a canned
# success payload or an injected override.
# ---------------------------------------------------------------------------

class FakeEditorBatchBackend:
	extends RefCounted

	var calls: Array = []
	var overrides: Dictionary = {}

	func execute(ops: Array, transactional: bool) -> Variant:
		calls.append({"op": "execute", "ops": ops, "transactional": transactional})
		if overrides.has("execute"):
			return overrides["execute"]
		return {"results": [], "committed": transactional}

	func dry_run(ops: Array) -> Variant:
		calls.append({"op": "dry_run", "ops": ops})
		if overrides.has("dry_run"):
			return overrides["dry_run"]
		return {"would_apply": []}

	func find_calls(op: String) -> Array:
		var out: Array = []
		for c in calls:
			if (c as Dictionary).get("op", "") == op:
				out.append(c)
		return out


func _new_env() -> Dictionary:
	var backend: FakeEditorBatchBackend = FakeEditorBatchBackend.new()
	var tools: Object = BATCH_TOOLS_SCRIPT.new(backend)
	return {"backend": backend, "tools": tools}


# ---------------------------------------------------------------------------
# 1) batch.execute — forwards ops list and transactional flag
# ---------------------------------------------------------------------------

func test_execute_forwards_ops_and_transactional_true() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorBatchBackend = env["backend"]

	var ops: Array = [
		{"tool": "node.add", "params": {"scene_path": "res://a.tscn", "parent_path": "/root/A", "type": "Node", "name": "n"}},
		{"tool": "node.remove", "params": {"scene_path": "res://a.tscn", "node_path": "/root/A/Old"}},
	]
	var result: Variant = tools.execute({"ops": ops, "transactional": true})

	var executes: Array = backend.find_calls("execute")
	assert_eq(executes.size(), 1, "Backend.execute must be called once")
	var call: Dictionary = executes[0]
	assert_eq(call.get("ops", []), ops, "ops list must be forwarded verbatim")
	assert_eq(call.get("transactional", false), true, "transactional flag must be forwarded")
	assert_true(result is Dictionary, "execute() must return a Dictionary")
	assert_eq((result as Dictionary).get("committed", null), true, "Result must carry backend committed flag")


# ---------------------------------------------------------------------------
# 2) batch.execute — defaults transactional to false when absent
# ---------------------------------------------------------------------------

func test_execute_defaults_transactional_to_false_when_absent() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorBatchBackend = env["backend"]

	var _result: Variant = tools.execute({"ops": []})

	var executes: Array = backend.find_calls("execute")
	assert_eq(executes.size(), 1, "Backend.execute must be called once")
	assert_eq((executes[0] as Dictionary).get("transactional", true), false, "Missing transactional must default to false")


# ---------------------------------------------------------------------------
# 3) batch.execute — defaults ops to empty array when absent
# ---------------------------------------------------------------------------

func test_execute_defaults_ops_to_empty_array_when_absent() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorBatchBackend = env["backend"]

	var _result: Variant = tools.execute({})

	var executes: Array = backend.find_calls("execute")
	assert_eq(executes.size(), 1, "Backend.execute must be called once")
	assert_eq((executes[0] as Dictionary).get("ops", [1]), [], "Missing ops must default to empty Array")


# ---------------------------------------------------------------------------
# 4) batch.execute — passes through an error envelope from the backend
# ---------------------------------------------------------------------------

func test_execute_passes_through_transaction_not_open_envelope() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorBatchBackend = env["backend"]

	backend.overrides["execute"] = {
		"error": MCP_ERROR_CODES_SCRIPT.make_error(
			MCP_ERROR_CODES_SCRIPT.TRANSACTION_NOT_OPEN,
			{"transaction_id": "tx-abc"}
		),
	}

	var result: Variant = tools.execute({"ops": [], "transactional": true})

	assert_true(result is Dictionary, "execute() must return a Dictionary")
	var dict: Dictionary = result as Dictionary
	assert_true(dict.has("error"), "Result must carry an 'error' envelope when backend returns one")
	var err: Dictionary = dict.get("error", {})
	assert_eq(err.get("code", 0), MCP_ERROR_CODES_SCRIPT.TRANSACTION_NOT_OPEN, "Envelope must carry TRANSACTION_NOT_OPEN code")


# ---------------------------------------------------------------------------
# 5) batch.dry_run — forwards ops and returns would_apply result
# ---------------------------------------------------------------------------

func test_dry_run_forwards_ops_and_returns_would_apply() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorBatchBackend = env["backend"]

	var ops: Array = [{"tool": "node.add", "params": {}}]
	backend.overrides["dry_run"] = {"would_apply": [{"tool": "node.add", "would_succeed": true}]}

	var result: Variant = tools.dry_run({"ops": ops})

	var dry_runs: Array = backend.find_calls("dry_run")
	assert_eq(dry_runs.size(), 1, "Backend.dry_run must be called once")
	assert_eq((dry_runs[0] as Dictionary).get("ops", []), ops, "ops list must be forwarded verbatim")
	assert_true(result is Dictionary and (result as Dictionary).has("would_apply"), "Result must include would_apply from backend")


# ---------------------------------------------------------------------------
# 6) batch.dry_run — accepts by-position params (Array)
# ---------------------------------------------------------------------------

func test_dry_run_accepts_by_position_params() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorBatchBackend = env["backend"]

	var ops: Array = [{"tool": "script.load", "params": {"path": "res://a.gd"}}]
	var _result: Variant = tools.dry_run([ops])

	var dry_runs: Array = backend.find_calls("dry_run")
	assert_eq(dry_runs.size(), 1, "Backend.dry_run must be called once")
	assert_eq((dry_runs[0] as Dictionary).get("ops", []), ops, "By-position ops must be forwarded verbatim")


# ---------------------------------------------------------------------------
# 7) register_on — wires both MCP method names on the dispatcher
# ---------------------------------------------------------------------------

func test_register_on_wires_both_mcp_methods() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var dispatcher: Object = DISPATCHER_SCRIPT.new()

	tools.register_on(dispatcher)

	var execute_response: Dictionary = dispatcher.dispatch({
		"jsonrpc": "2.0",
		"method": "batch.execute",
		"params": {"ops": [], "transactional": false},
		"id": 1,
	})
	assert_true(execute_response.has("result"), "batch.execute must be reachable after register_on()")

	var dry_run_response: Dictionary = dispatcher.dispatch({
		"jsonrpc": "2.0",
		"method": "batch.dry_run",
		"params": {"ops": []},
		"id": 2,
	})
	assert_true(dry_run_response.has("result"), "batch.dry_run must be reachable after register_on()")


# ---------------------------------------------------------------------------
# 8) Dispatcher hoists an error envelope from the backend into a top-level
#    JSON-RPC error response.
# ---------------------------------------------------------------------------

func test_dispatcher_hoists_error_envelope_from_backend() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeEditorBatchBackend = env["backend"]
	var dispatcher: Object = DISPATCHER_SCRIPT.new()
	tools.register_on(dispatcher)

	backend.overrides["execute"] = {
		"error": MCP_ERROR_CODES_SCRIPT.make_error(
			MCP_ERROR_CODES_SCRIPT.TRANSACTION_NOT_OPEN,
			{"transaction_id": "tx-missing"}
		),
	}

	var response: Dictionary = dispatcher.dispatch({
		"jsonrpc": "2.0",
		"method": "batch.execute",
		"params": {"ops": [], "transactional": true},
		"id": 99,
	})

	assert_false(response.has("result"), "Business-error response must not carry 'result'")
	assert_true(response.has("error"), "Business-error response must carry 'error'")
	var err: Dictionary = response["error"]
	assert_eq(err.get("code", 0), MCP_ERROR_CODES_SCRIPT.TRANSACTION_NOT_OPEN, "Error code must be -32009 TRANSACTION_NOT_OPEN")
	assert_eq(response.get("id", null), 99, "Error envelope must echo the request id")
