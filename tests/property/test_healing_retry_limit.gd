extends GutTest
## Feature: forgekit, Property 22: Self-healing — after 3 failed repair attempts suggest_action returns manual_review
##
## For any randomly-generated resource path `p`, calling
## `healing.apply_and_retest(p, _)` three times where the injected test
## runner returns `"failed"` must leave the retry counter exhausted.
## A subsequent `healing.suggest_action(...)` for that path must return
## `"manual_review"` regardless of what the failure_message would
## otherwise imply. 100 iterations.

const CoreFuzzScript: GDScript = preload("res://addons/forgekit_core/mcp/testing/core_fuzz.gd")
const HEALING_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/healing/healing_tools.gd")
const RETRY_COUNTER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/healing/retry_counter.gd")
const SUGGESTER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/healing/suggest_action.gd")

const ITERATIONS: int = 100


class AlwaysFailingTestRunner:
	extends RefCounted

	func run(_command: String) -> Dictionary:
		return {"status": "failed", "failure_message": "ext_resource not found"}


class NullApplyResourceBackend:
	extends RefCounted

	func apply_fix(_path: String, _fix: Dictionary) -> Dictionary:
		return {"applied": true, "path": _path}


func _random_resource_path(rng: RandomNumberGenerator) -> String:
	# Build a plausible res:// path made of identifier characters.
	var segment_count: int = rng.randi_range(1, 4)
	var parts: Array = []
	for _i in range(segment_count):
		var len: int = rng.randi_range(1, 12)
		parts.append(CoreFuzzScript.random_string(rng, len, "abcdefghijklmnopqrstuvwxyz_"))
	return "res://%s.tres" % "/".join(parts)


func _driver(path: String) -> bool:
	# Create a fresh healing stack per iteration so counters do not leak.
	var tools: Object = HEALING_TOOLS_SCRIPT.new()
	var counter: Object = RETRY_COUNTER_SCRIPT.new()
	var suggester: Object = SUGGESTER_SCRIPT.new()
	suggester.set_retry_counter(counter)
	tools.set_retry_counter(counter)
	tools.set_suggester(suggester)
	tools.set_test_runner(AlwaysFailingTestRunner.new())
	tools.set_resource_backend(NullApplyResourceBackend.new())

	var fix: Dictionary = {"path": path, "field": "display_name", "value": "attempt"}
	for _attempt in range(3):
		var result: Dictionary = tools.apply_and_retest({
			"fix": fix,
			"test_command": "gut",
		}) as Dictionary
		if String(result.get("test_status", "")) != "failed":
			return false
	# 4th call: suggest_action must return manual_review regardless of
	# what the failure_message would imply in isolation.
	var suggestion: Dictionary = tools.suggest_action({
		"report": {
			"status": "failed",
			"failure_message": "ext_resource not found",
			"resource_path": path,
		},
	}) as Dictionary
	return String(suggestion.get("suggested_action", "")) == "manual_review"


func test_property_22_retry_limit_escalates_to_manual_review() -> void:
	var rng: RandomNumberGenerator = CoreFuzzScript.seeded(22)
	var generator: Callable = func() -> String:
		return _random_resource_path(rng)
	var predicate: Callable = func(path: String) -> bool:
		return _driver(path)

	var result: Dictionary = CoreFuzzScript.for_all(generator, predicate, ITERATIONS)
	var counterexample_repr: String = str(result.get("counterexample", ""))
	assert_true(
		result["ok"],
		"Property 22 failed after %d iterations with counterexample path=%s" % [
			int(result.get("iterations", -1)),
			counterexample_repr,
		]
	)
	assert_gte(int(result.get("iterations", 0)), ITERATIONS, "Property 22 must run at least %d iterations" % ITERATIONS)
