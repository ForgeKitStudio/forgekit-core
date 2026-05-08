extends GutTest
## Unit tests for McpRuntimeEvalTools: JSON-RPC handler adapter for the
## runtime-channel `runtime.eval_safe` MCP tool.
##
## Per Requirements 8.10 and 26.5, `runtime.eval_safe` MUST route the
## `expr` parameter exclusively through Smart_Type_Parser (closed grammar,
## no `eval`). The adapter forwards the String `expr` verbatim to the
## backend; the backend is the single source of truth for parsing. When
## the backend rejects an expression as outside the grammar, it returns
## an `{"error": {"code": -32XXX, "message": "INVALID_LITERAL", ...}}`
## envelope that the adapter passes through unchanged so the JSON-RPC
## dispatcher can hoist it into a standards-compliant error response.
##
## Covered handlers:
##   runtime.eval_safe(expr) → {value} | {"error": {...}}


const EVAL_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/runtime_bridge/tools/eval_tools.gd")
const DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")


class FakeRuntimeEvalBackend:
	extends RefCounted

	var calls: Array = []
	var overrides: Dictionary = {}

	func eval_safe(expr: String) -> Variant:
		calls.append({"op": "eval_safe", "expr": expr})
		if overrides.has("eval_safe"):
			return overrides["eval_safe"]
		return {"value": {"kind": "number", "value": 42}}

	func find_calls(op: String) -> Array:
		var out: Array = []
		for c in calls:
			if (c as Dictionary).get("op", "") == op:
				out.append(c)
		return out


func _new_env() -> Dictionary:
	var backend: FakeRuntimeEvalBackend = FakeRuntimeEvalBackend.new()
	var tools: Object = EVAL_TOOLS_SCRIPT.new(backend)
	return {"backend": backend, "tools": tools}


# ---------------------------------------------------------------------------
# 1) runtime.eval_safe — forwards expr VERBATIM to backend
# ---------------------------------------------------------------------------

func test_eval_safe_forwards_expr_verbatim() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeEvalBackend = env["backend"]

	var _result: Variant = tools.eval_safe({"expr": "Vector2(1.5, -2)"})

	var call: Dictionary = backend.find_calls("eval_safe")[0]
	assert_eq(String(call.get("expr", "")), "Vector2(1.5, -2)", "expr forwarded verbatim")


func test_eval_safe_accepts_positional_params() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeEvalBackend = env["backend"]

	var _result: Variant = tools.eval_safe(["Color(1, 0, 0, 1)"])

	var call: Dictionary = backend.find_calls("eval_safe")[0]
	assert_eq(String(call.get("expr", "")), "Color(1, 0, 0, 1)", "positional expr forwarded")


func test_eval_safe_defaults_expr_to_empty_string_when_absent() -> void:
	# Missing expr is forwarded as an empty string so the backend — which owns
	# the grammar — can surface the canonical INVALID_LITERAL error itself
	# rather than having the adapter pre-empt it with a custom message.
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeEvalBackend = env["backend"]

	var _result: Variant = tools.eval_safe({})

	var call: Dictionary = backend.find_calls("eval_safe")[0]
	assert_eq(String(call.get("expr", "X")), "", "Missing expr forwards as empty string")


# ---------------------------------------------------------------------------
# 2) runtime.eval_safe — returns backend payload for valid literals
# ---------------------------------------------------------------------------

func test_eval_safe_returns_backend_payload() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]

	var result: Variant = tools.eval_safe({"expr": "42"})

	assert_true(result is Dictionary, "Result must be a Dictionary")
	var dict: Dictionary = result as Dictionary
	assert_true(dict.has("value"), "Result must contain 'value'")


# ---------------------------------------------------------------------------
# 3) runtime.eval_safe — passes through INVALID_LITERAL error envelope
# ---------------------------------------------------------------------------

func test_eval_safe_passes_through_invalid_literal_error_envelope() -> void:
	# When the backend's Smart_Type_Parser rejects a construct outside the
	# closed grammar (e.g. arbitrary GDScript like `OS.execute(...)`), it
	# returns an `{"error": {...}}` envelope that the adapter must pass
	# through unchanged. The dispatcher is responsible for hoisting the
	# envelope into a top-level JSON-RPC error response.
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeEvalBackend = env["backend"]

	backend.overrides["eval_safe"] = {
		"error": {
			"code": -32010,
			"message": "INVALID_LITERAL",
			"data": {
				"position": 0,
				"fragment": "OS.execute",
				"suggestion": "Only closed-grammar literals are accepted; see Requirement 26.5.",
			},
		},
	}

	var result: Variant = tools.eval_safe({"expr": "OS.execute('rm', ['-rf', '/'])"})

	assert_true(result is Dictionary, "Result must be a Dictionary")
	var dict: Dictionary = result as Dictionary
	assert_true(dict.has("error"), "Adapter must pass through the error envelope unchanged")
	var err: Dictionary = dict.get("error") as Dictionary
	assert_eq(String(err.get("message", "")), "INVALID_LITERAL", "INVALID_LITERAL message preserved")


# ---------------------------------------------------------------------------
# 4) register_on — wires runtime.eval_safe on the dispatcher
# ---------------------------------------------------------------------------

func test_register_on_wires_eval_safe_method_on_dispatcher() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var dispatcher: Object = DISPATCHER_SCRIPT.new()

	tools.register_on(dispatcher)

	var response: Dictionary = dispatcher.dispatch({
		"jsonrpc": "2.0",
		"method": "runtime.eval_safe",
		"params": {"expr": "123"},
		"id": 1,
	})
	assert_true(response.has("result"), "runtime.eval_safe must be reachable via dispatcher")
	assert_false(response.has("error"), "runtime.eval_safe must not produce a dispatcher error for valid grammar")


# ---------------------------------------------------------------------------
# 5) register_on — dispatcher hoists INVALID_LITERAL to top-level error
# ---------------------------------------------------------------------------

func test_dispatcher_hoists_invalid_literal_to_top_level_error() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeEvalBackend = env["backend"]
	var dispatcher: Object = DISPATCHER_SCRIPT.new()

	tools.register_on(dispatcher)

	backend.overrides["eval_safe"] = {
		"error": {
			"code": -32010,
			"message": "INVALID_LITERAL",
			"data": {"position": 4, "fragment": "exec"},
		},
	}

	var response: Dictionary = dispatcher.dispatch({
		"jsonrpc": "2.0",
		"method": "runtime.eval_safe",
		"params": {"expr": "load('res://evil.gd').exec()"},
		"id": 2,
	})
	assert_true(response.has("error"), "Dispatcher must hoist error envelope to top level")
	assert_false(response.has("result"), "Dispatcher must not return a result when the handler signals an error")
	var err: Dictionary = response.get("error") as Dictionary
	assert_eq(String(err.get("message", "")), "INVALID_LITERAL", "INVALID_LITERAL surfaces via dispatcher")
