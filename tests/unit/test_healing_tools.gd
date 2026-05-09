extends GutTest
## Unit tests for McpHealingTools: JSON-RPC handler adapter for the five
## Self-Healing MCP tools.
##
##   healing.suggest_action(report)
##   healing.inspect_failure(report_or_message)
##   healing.get_retry_count(resource_path)
##   healing.reset_retry_count(resource_path)
##   healing.apply_and_retest(fix, test_command)


const TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/healing/healing_tools.gd")
const RETRY_COUNTER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/healing/retry_counter.gd")
const DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")


# ---------------------------------------------------------------------------
# Fakes.
# ---------------------------------------------------------------------------

class FakeResourceBackend:
	extends RefCounted

	var apply_fix_calls: Array = []
	var next_apply_result: Dictionary = {"applied": true, "path": ""}

	func apply_fix(path: String, fix: Dictionary) -> Dictionary:
		apply_fix_calls.append({"path": path, "fix": fix.duplicate(true)})
		var out: Dictionary = next_apply_result.duplicate(true)
		out["path"] = path
		return out


class FakeTestRunner:
	extends RefCounted

	var calls: Array = []
	var next_status: String = "passed"
	var next_failure_message: String = ""

	func run(command: String) -> Dictionary:
		calls.append({"command": command})
		return {
			"status": next_status,
			"failure_message": next_failure_message,
		}


func _new_env() -> Dictionary:
	var counter: Object = RETRY_COUNTER_SCRIPT.new()
	var backend: FakeResourceBackend = FakeResourceBackend.new()
	var runner: FakeTestRunner = FakeTestRunner.new()
	var tools: Object = TOOLS_SCRIPT.new()
	tools.set_retry_counter(counter)
	tools.set_resource_backend(backend)
	tools.set_test_runner(runner)
	return {
		"counter": counter,
		"backend": backend,
		"runner": runner,
		"tools": tools,
	}


# ---------------------------------------------------------------------------
# healing.suggest_action
# ---------------------------------------------------------------------------

func test_suggest_action_forwards_to_suggester() -> void:
	var env: Dictionary = _new_env()
	var result: Variant = env["tools"].suggest_action({
		"report": {
			"status": "failed",
			"failure_message": "ext_resource missing",
			"resource_path": "res://a.tres",
		},
	})
	var dict: Dictionary = result as Dictionary
	assert_eq(String(dict.get("suggested_action", "")), "inspect_tres")


# ---------------------------------------------------------------------------
# healing.inspect_failure
# ---------------------------------------------------------------------------

func test_inspect_failure_returns_envelope() -> void:
	var env: Dictionary = _new_env()
	var result: Variant = env["tools"].inspect_failure({
		"report": "ext_resource not found",
	})
	var dict: Dictionary = result as Dictionary
	assert_true(dict.has("root_cause"), "inspect_failure must return root_cause")
	assert_true(dict.has("candidates"), "inspect_failure must return candidates")


# ---------------------------------------------------------------------------
# healing.get_retry_count / healing.reset_retry_count
# ---------------------------------------------------------------------------

func test_get_retry_count_returns_attempts_and_limit() -> void:
	var env: Dictionary = _new_env()
	var counter: Object = env["counter"]
	counter.increment("res://a.tres")
	counter.increment("res://a.tres")
	var result: Variant = env["tools"].get_retry_count({"resource_path": "res://a.tres"})
	var dict: Dictionary = result as Dictionary
	assert_eq(int(dict.get("attempts", -1)), 2, "attempts must reflect counter state")
	assert_eq(int(dict.get("limit", -1)), 3, "limit must be 3")


func test_reset_retry_count_clears_counter() -> void:
	var env: Dictionary = _new_env()
	var counter: Object = env["counter"]
	counter.increment("res://a.tres")
	counter.increment("res://a.tres")
	var result: Variant = env["tools"].reset_retry_count({"resource_path": "res://a.tres"})
	var dict: Dictionary = result as Dictionary
	assert_true(dict.get("ok", false), "reset must return ok=true")
	assert_eq(int(counter.get_attempts("res://a.tres")), 0, "counter must be zeroed")


# ---------------------------------------------------------------------------
# healing.apply_and_retest
# ---------------------------------------------------------------------------

func test_apply_and_retest_passes_through_on_success() -> void:
	var env: Dictionary = _new_env()
	env["runner"].next_status = "passed"
	var result: Variant = env["tools"].apply_and_retest({
		"fix": {"path": "res://a.tres", "field": "display_name", "value": "Fixed"},
		"test_command": "gut -gdir=res://tests/",
	})
	var dict: Dictionary = result as Dictionary
	assert_true(dict.get("applied", false), "applied must echo backend result")
	assert_eq(String(dict.get("test_status", "")), "passed", "test_status must echo runner output")
	var counter: Object = env["counter"]
	assert_eq(int(counter.get_attempts("res://a.tres")), 0, "successful run must not advance retry counter")


func test_apply_and_retest_increments_counter_on_failure() -> void:
	var env: Dictionary = _new_env()
	env["runner"].next_status = "failed"
	env["runner"].next_failure_message = "still broken"
	var result: Variant = env["tools"].apply_and_retest({
		"fix": {"path": "res://a.tres", "field": "display_name", "value": "Fixed"},
		"test_command": "gut -gdir=res://tests/",
	})
	var dict: Dictionary = result as Dictionary
	assert_eq(String(dict.get("test_status", "")), "failed", "test_status must reflect runner failure")
	assert_eq(int(dict.get("retries_remaining", -1)), 2, "after first failure, retries_remaining = 3 - 1 = 2")
	var counter: Object = env["counter"]
	assert_eq(int(counter.get_attempts("res://a.tres")), 1, "failed run must advance retry counter")


func test_apply_and_retest_reports_zero_retries_at_limit() -> void:
	var env: Dictionary = _new_env()
	env["runner"].next_status = "failed"
	var counter: Object = env["counter"]
	counter.increment("res://a.tres")
	counter.increment("res://a.tres")
	var result: Variant = env["tools"].apply_and_retest({
		"fix": {"path": "res://a.tres", "field": "display_name", "value": "Fixed"},
		"test_command": "gut -gdir=res://tests/",
	})
	var dict: Dictionary = result as Dictionary
	assert_eq(int(dict.get("retries_remaining", -1)), 0, "third failure leaves zero retries")


# ---------------------------------------------------------------------------
# register_on — wires all five healing methods on the dispatcher.
# ---------------------------------------------------------------------------

func test_register_on_wires_all_five_healing_methods() -> void:
	var env: Dictionary = _new_env()
	var dispatcher: Object = DISPATCHER_SCRIPT.new()
	env["tools"].register_on(dispatcher)
	var methods: Array = [
		"healing.suggest_action",
		"healing.inspect_failure",
		"healing.get_retry_count",
		"healing.reset_retry_count",
		"healing.apply_and_retest",
	]
	for method in methods:
		var response: Dictionary = dispatcher.dispatch({
			"jsonrpc": "2.0",
			"method": method,
			"params": {},
			"id": 1,
		})
		assert_true(response.has("result") or response.has("error"), "method %s must be reachable" % method)
