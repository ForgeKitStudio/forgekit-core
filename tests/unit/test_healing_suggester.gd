extends GutTest
## Unit tests for McpHealingSuggester: rule-based mapping from a failed
## TestReport (or raw message) to a suggested_action drawn from
## ALLOWED_SUGGESTED_ACTIONS. When the retry counter for the failing
## resource has exhausted its limit, the suggester must unconditionally
## return "manual_review" (Property 22).


const SUGGESTER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/healing/suggest_action.gd")
const RETRY_COUNTER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/healing/retry_counter.gd")


const ALLOWED: Array = ["inspect_tres", "validate_gdscript", "rerun_test", "manual_review"]


func test_tres_failure_suggests_inspect_tres() -> void:
	var suggester: Object = SUGGESTER_SCRIPT.new()
	var report: Dictionary = {
		"status": "failed",
		"failure_message": "Failed to load .tres file: ext_resource not found",
		"resource_path": "res://data/item.tres",
	}
	var result: Dictionary = suggester.suggest(report)
	assert_eq(String(result.get("suggested_action", "")), "inspect_tres")


func test_parse_error_suggests_validate_gdscript() -> void:
	var suggester: Object = SUGGESTER_SCRIPT.new()
	var report: Dictionary = {
		"status": "failed",
		"failure_message": "GDScript Parse error at line 42: unexpected token",
		"resource_path": "res://scripts/player.gd",
	}
	var result: Dictionary = suggester.suggest(report)
	assert_eq(String(result.get("suggested_action", "")), "validate_gdscript")


func test_timeout_failure_suggests_rerun_test() -> void:
	var suggester: Object = SUGGESTER_SCRIPT.new()
	var report: Dictionary = {
		"status": "failed",
		"failure_message": "Test timed out after 30 seconds (likely flaky)",
		"resource_path": "res://tests/flaky_test.gd",
	}
	var result: Dictionary = suggester.suggest(report)
	assert_eq(String(result.get("suggested_action", "")), "rerun_test")


func test_unknown_failure_suggests_manual_review() -> void:
	var suggester: Object = SUGGESTER_SCRIPT.new()
	var report: Dictionary = {
		"status": "failed",
		"failure_message": "Something unexpected went wrong",
		"resource_path": "res://unknown.gd",
	}
	var result: Dictionary = suggester.suggest(report)
	assert_eq(String(result.get("suggested_action", "")), "manual_review")


func test_suggested_action_is_always_in_allowed_set() -> void:
	var suggester: Object = SUGGESTER_SCRIPT.new()
	var messages: Array = [
		"weird unknown message",
		"item not found",
		"",
		"Another Random Message",
		".tres failure",
		"parse error",
		"timeout",
	]
	for m in messages:
		var result: Dictionary = suggester.suggest({
			"status": "failed",
			"failure_message": String(m),
			"resource_path": "res://some.gd",
		})
		var action: String = String(result.get("suggested_action", ""))
		assert_true(ALLOWED.has(action), "suggested_action must be in ALLOWED set (got '%s' for message '%s')" % [action, m])


func test_retry_exhaustion_forces_manual_review() -> void:
	# Property 22 in concrete form: with 3 prior failed attempts on a
	# resource, the next suggestion must be manual_review regardless of
	# what the failure_message would otherwise indicate.
	var counter: Object = RETRY_COUNTER_SCRIPT.new()
	counter.increment("res://a.tres")
	counter.increment("res://a.tres")
	counter.increment("res://a.tres")

	var suggester: Object = SUGGESTER_SCRIPT.new()
	suggester.set_retry_counter(counter)

	var result: Dictionary = suggester.suggest({
		"status": "failed",
		"failure_message": "ext_resource not found (would normally suggest inspect_tres)",
		"resource_path": "res://a.tres",
	})
	assert_eq(String(result.get("suggested_action", "")), "manual_review", "retry-exhausted path must return manual_review")


func test_missing_fields_default_to_manual_review() -> void:
	var suggester: Object = SUGGESTER_SCRIPT.new()
	var result: Dictionary = suggester.suggest({})
	assert_eq(String(result.get("suggested_action", "")), "manual_review", "empty report must default to manual_review")
