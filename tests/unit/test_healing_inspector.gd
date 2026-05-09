extends GutTest
## Unit tests for McpHealingInspector: classifies a failure report or
## message into a {root_cause, candidates: [{category, suggestion, confidence}]}
## envelope.


const INSPECTOR_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/healing/inspect_failure.gd")


func test_inspect_string_failure_returns_envelope() -> void:
	var inspector: Object = INSPECTOR_SCRIPT.new()
	var result: Dictionary = inspector.inspect("ext_resource not found: res://missing.tres")
	assert_true(result.has("root_cause"), "envelope must contain root_cause")
	assert_true(result.has("candidates"), "envelope must contain candidates array")
	var candidates: Array = result.get("candidates", []) as Array
	assert_true(candidates.size() >= 1, "at least one candidate must be returned")


func test_inspect_identifies_missing_ext_resource() -> void:
	var inspector: Object = INSPECTOR_SCRIPT.new()
	var result: Dictionary = inspector.inspect("ext_resource not found: res://missing.tres")
	assert_eq(String(result.get("root_cause", "")), "missing_ext_resource", "root cause must identify missing ext_resource")
	var categories: Array = []
	for c_raw in (result.get("candidates", []) as Array):
		categories.append(String((c_raw as Dictionary).get("category", "")))
	assert_true(categories.has("missing_ext_resource"), "candidates must include missing_ext_resource")


func test_inspect_identifies_gdscript_parse_error() -> void:
	var inspector: Object = INSPECTOR_SCRIPT.new()
	var result: Dictionary = inspector.inspect("GDScript Parse error: unexpected token at line 12")
	assert_eq(String(result.get("root_cause", "")), "gdscript_parse_error")
	var categories: Array = []
	for c_raw in (result.get("candidates", []) as Array):
		categories.append(String((c_raw as Dictionary).get("category", "")))
	assert_true(categories.has("gdscript_parse_error"))


func test_inspect_identifies_timeout() -> void:
	var inspector: Object = INSPECTOR_SCRIPT.new()
	var result: Dictionary = inspector.inspect("Test timed out after 30 seconds")
	assert_eq(String(result.get("root_cause", "")), "timeout")


func test_inspect_on_dictionary_extracts_failure_message() -> void:
	var inspector: Object = INSPECTOR_SCRIPT.new()
	var result: Dictionary = inspector.inspect({
		"status": "failed",
		"failure_message": "Parse error on line 3",
	})
	assert_eq(String(result.get("root_cause", "")), "gdscript_parse_error", "dict input must pull failure_message")


func test_inspect_unknown_returns_unknown_root_cause() -> void:
	var inspector: Object = INSPECTOR_SCRIPT.new()
	var result: Dictionary = inspector.inspect("a vague unexplained failure")
	assert_eq(String(result.get("root_cause", "")), "unknown", "no pattern match must yield unknown root_cause")
	var candidates: Array = result.get("candidates", []) as Array
	# Even for unknown failures, an "investigate" candidate must be
	# emitted so the agent sees some guidance.
	assert_true(candidates.size() >= 1, "unknown failures still carry at least one generic candidate")


func test_candidate_confidence_is_numeric_and_bounded() -> void:
	var inspector: Object = INSPECTOR_SCRIPT.new()
	var result: Dictionary = inspector.inspect("ext_resource not found")
	for c_raw in (result.get("candidates", []) as Array):
		var c: Dictionary = c_raw as Dictionary
		var conf: float = float(c.get("confidence", -1.0))
		assert_true(conf >= 0.0 and conf <= 1.0, "confidence must be in [0.0, 1.0]; got %f" % conf)
