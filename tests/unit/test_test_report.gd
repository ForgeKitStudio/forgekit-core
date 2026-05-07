extends GutTest
## Unit tests for TestReport: field definitions, nested TestCase/Assertion,
## to_dict/from_dict and to_json/from_json round-trip, suggested_action bounds,
## Unicode survival, and defensive handling of malformed input.


# ---------------------------------------------------------------------------
# Factories
# ---------------------------------------------------------------------------

func _make_assertion(description: String, passed: bool, expected: Variant, actual: Variant) -> TestReport.Assertion:
	var a: TestReport.Assertion = TestReport.Assertion.new()
	a.description = description
	a.passed = passed
	a.expected = expected
	a.actual = actual
	return a


func _make_passing_case(name: String) -> TestReport.TestCase:
	var c: TestReport.TestCase = TestReport.TestCase.new()
	c.name = name
	c.status = "passed"
	c.duration_ms = 12
	c.assertions = [_make_assertion("truthy", true, true, true)]
	c.failure_message = ""
	c.stack_trace = ""
	return c


func _make_failing_case(name: String, msg: String, trace: String) -> TestReport.TestCase:
	var c: TestReport.TestCase = TestReport.TestCase.new()
	c.name = name
	c.status = "failed"
	c.duration_ms = 45
	c.assertions = [_make_assertion("expected equal", false, 1, 2)]
	c.failure_message = msg
	c.stack_trace = trace
	return c


func _make_empty_report() -> TestReport:
	var r: TestReport = TestReport.new()
	r.run_id = "empty-run"
	r.timestamp = "2026-05-06T12:00:00Z"
	r.total = 0
	r.passed = 0
	r.failed = 0
	r.tests = []
	r.suggested_action = ""
	return r


func _make_valid_report() -> TestReport:
	var r: TestReport = TestReport.new()
	r.run_id = "run-abc123"
	r.timestamp = "2026-05-06T12:34:56Z"
	r.total = 2
	r.passed = 1
	r.failed = 1
	r.tests = [
		_make_passing_case("test_alpha"),
		_make_failing_case("test_beta", "expected 1 but was 2", "at line 42 in test_beta"),
	]
	r.suggested_action = "rerun_test"
	return r


# ---------------------------------------------------------------------------
# Construction and field defaults
# ---------------------------------------------------------------------------

func test_default_report_has_zero_counters_and_empty_tests() -> void:
	var r: TestReport = TestReport.new()
	assert_eq(r.run_id, "", "run_id default should be empty String")
	assert_eq(r.timestamp, "", "timestamp default should be empty String")
	assert_eq(r.total, 0, "total default should be 0")
	assert_eq(r.passed, 0, "passed default should be 0")
	assert_eq(r.failed, 0, "failed default should be 0")
	assert_eq(r.tests.size(), 0, "tests default should be empty Array")
	assert_eq(r.suggested_action, "", "suggested_action default should be empty String")


func test_default_test_case_has_empty_strings_and_arrays() -> void:
	var c: TestReport.TestCase = TestReport.TestCase.new()
	assert_eq(c.name, "", "TestCase.name default should be empty")
	assert_eq(c.status, "", "TestCase.status default should be empty")
	assert_eq(c.duration_ms, 0, "TestCase.duration_ms default should be 0")
	assert_eq((c.assertions as Array).size(), 0, "TestCase.assertions default should be empty Array")
	assert_eq(c.failure_message, "", "TestCase.failure_message default should be empty")
	assert_eq(c.stack_trace, "", "TestCase.stack_trace default should be empty")


func test_default_assertion_has_false_passed() -> void:
	var a: TestReport.Assertion = TestReport.Assertion.new()
	assert_eq(a.description, "", "Assertion.description default should be empty")
	assert_false(a.passed, "Assertion.passed default should be false")
	assert_eq(a.expected, null, "Assertion.expected default should be null")
	assert_eq(a.actual, null, "Assertion.actual default should be null")


# ---------------------------------------------------------------------------
# suggested_action bounds
# ---------------------------------------------------------------------------

func test_allowed_suggested_actions_contains_exactly_four_values() -> void:
	var allowed: Array[String] = TestReport.ALLOWED_SUGGESTED_ACTIONS
	assert_eq(allowed.size(), 4, "There should be exactly four allowed suggested_action values")
	assert_true(allowed.has("inspect_tres"), "inspect_tres should be allowed")
	assert_true(allowed.has("validate_gdscript"), "validate_gdscript should be allowed")
	assert_true(allowed.has("rerun_test"), "rerun_test should be allowed")
	assert_true(allowed.has("manual_review"), "manual_review should be allowed")


func test_is_suggested_action_valid_accepts_all_four_values() -> void:
	for action in ["inspect_tres", "validate_gdscript", "rerun_test", "manual_review"]:
		var r: TestReport = TestReport.new()
		r.suggested_action = action
		assert_true(r.is_suggested_action_valid(), "%s should be a valid suggested_action" % action)


func test_is_suggested_action_valid_rejects_unknown_value() -> void:
	var r: TestReport = TestReport.new()
	r.suggested_action = "nuke_repo"
	assert_false(r.is_suggested_action_valid(), "Unknown suggested_action should be rejected")


func test_is_suggested_action_valid_rejects_empty_when_failures_present() -> void:
	# When failed > 0, an empty suggested_action is not a legal state because
	# the bounded-value contract requires one of the four canonical actions.
	var r: TestReport = TestReport.new()
	r.total = 1
	r.failed = 1
	r.suggested_action = ""
	assert_false(r.is_suggested_action_valid(), "Empty suggested_action should be invalid when failed > 0")


func test_is_suggested_action_valid_accepts_empty_when_no_failures() -> void:
	# A clean all-green run does not need a suggested_action, so empty is legal.
	var r: TestReport = TestReport.new()
	r.total = 3
	r.passed = 3
	r.failed = 0
	r.suggested_action = ""
	assert_true(r.is_suggested_action_valid(), "Empty suggested_action should be legal when failed == 0")


# ---------------------------------------------------------------------------
# to_dict / from_dict round-trip
# ---------------------------------------------------------------------------

func test_to_dict_preserves_top_level_scalars() -> void:
	var r: TestReport = _make_valid_report()
	var d: Dictionary = r.to_dict()
	assert_eq(d.get("run_id"), r.run_id, "run_id should survive to_dict")
	assert_eq(d.get("timestamp"), r.timestamp, "timestamp should survive to_dict")
	assert_eq(d.get("total"), r.total, "total should survive to_dict")
	assert_eq(d.get("passed"), r.passed, "passed should survive to_dict")
	assert_eq(d.get("failed"), r.failed, "failed should survive to_dict")
	assert_eq(d.get("suggested_action"), r.suggested_action, "suggested_action should survive to_dict")
	assert_eq(typeof(d.get("tests")), TYPE_ARRAY, "tests should serialize as an Array")
	assert_eq((d.get("tests") as Array).size(), r.tests.size(), "tests array length should match")


func test_from_dict_reconstructs_nested_tests_and_assertions() -> void:
	var original: TestReport = _make_valid_report()
	var restored: TestReport = TestReport.from_dict(original.to_dict())

	assert_eq(restored.run_id, original.run_id, "run_id should survive round-trip")
	assert_eq(restored.total, original.total, "total should survive round-trip")
	assert_eq(restored.passed, original.passed, "passed should survive round-trip")
	assert_eq(restored.failed, original.failed, "failed should survive round-trip")
	assert_eq(restored.suggested_action, original.suggested_action, "suggested_action should survive round-trip")
	assert_eq(restored.tests.size(), original.tests.size(), "tests length should match")

	var passing_case: TestReport.TestCase = restored.tests[0]
	assert_eq(passing_case.name, "test_alpha", "first case name should round-trip")
	assert_eq(passing_case.status, "passed", "first case status should round-trip")
	assert_eq((passing_case.assertions as Array).size(), 1, "first case should have one assertion")

	var failing_case: TestReport.TestCase = restored.tests[1]
	assert_eq(failing_case.name, "test_beta", "second case name should round-trip")
	assert_eq(failing_case.status, "failed", "second case status should round-trip")
	assert_eq(failing_case.failure_message, "expected 1 but was 2", "failure_message should round-trip")
	assert_eq(failing_case.stack_trace, "at line 42 in test_beta", "stack_trace should round-trip")
	var asserts: Array = failing_case.assertions
	assert_eq(asserts.size(), 1, "failing case should have one assertion")
	var first_assert: TestReport.Assertion = asserts[0]
	assert_false(first_assert.passed, "failing assertion should not be marked as passed")
	assert_eq(first_assert.expected, 1, "expected value should round-trip")
	assert_eq(first_assert.actual, 2, "actual value should round-trip")


func test_from_dict_with_empty_dictionary_produces_safe_defaults() -> void:
	var restored: TestReport = TestReport.from_dict({})
	assert_eq(restored.run_id, "", "Missing run_id should default to empty String")
	assert_eq(restored.total, 0, "Missing total should default to 0")
	assert_eq(restored.tests.size(), 0, "Missing tests should default to empty Array")
	assert_eq(restored.suggested_action, "", "Missing suggested_action should default to empty String")


func test_from_dict_skips_malformed_test_entries() -> void:
	# A malformed (non-Dictionary) entry must be skipped rather than crash the loader.
	var restored: TestReport = TestReport.from_dict({
		"run_id": "defensive",
		"total": 1,
		"passed": 1,
		"failed": 0,
		"tests": [42, "stray_string", {"name": "t_ok", "status": "passed", "duration_ms": 1}],
	})
	assert_eq(restored.tests.size(), 1, "Only the valid dictionary entry should survive from_dict")
	var surviving: TestReport.TestCase = restored.tests[0]
	assert_eq(surviving.name, "t_ok", "Surviving test case name should be preserved")


# ---------------------------------------------------------------------------
# to_json / from_json round-trip
# ---------------------------------------------------------------------------

func test_to_json_returns_parseable_json() -> void:
	var r: TestReport = _make_valid_report()
	var json_str: String = r.to_json()
	var parsed: Variant = JSON.parse_string(json_str)
	assert_eq(typeof(parsed), TYPE_DICTIONARY, "to_json output must parse back to a Dictionary")
	assert_eq((parsed as Dictionary).get("run_id"), r.run_id, "parsed JSON should contain run_id")


func test_empty_report_survives_json_round_trip() -> void:
	var original: TestReport = _make_empty_report()
	var restored: TestReport = TestReport.from_json(original.to_json())
	assert_eq(restored.run_id, original.run_id, "run_id should survive empty-report round-trip")
	assert_eq(restored.total, 0, "total should round-trip as 0")
	assert_eq(restored.tests.size(), 0, "tests should round-trip as empty")
	assert_eq(restored.suggested_action, "", "suggested_action should round-trip as empty")


func test_unicode_fields_survive_json_round_trip() -> void:
	var r: TestReport = TestReport.new()
	r.run_id = "run-\u2694-unicode"
	r.timestamp = "2026-05-06T12:34:56Z"
	r.total = 1
	r.passed = 0
	r.failed = 1
	r.suggested_action = "inspect_tres"
	var c: TestReport.TestCase = TestReport.TestCase.new()
	c.name = "test_unicode_héroïque_\u5263"
	c.status = "failed"
	c.duration_ms = 7
	c.failure_message = "échec: attendu 1 mais était 2 \u2764"
	c.stack_trace = "à la ligne 99 \u26A0"
	c.assertions = [_make_assertion("comparaison", false, "héro", "roi")]
	r.tests = [c]

	var restored: TestReport = TestReport.from_json(r.to_json())
	assert_eq(restored.run_id, r.run_id, "Unicode run_id should round-trip")
	assert_eq(restored.tests.size(), 1, "tests length should round-trip")
	var rc: TestReport.TestCase = restored.tests[0]
	assert_eq(rc.name, c.name, "Unicode TestCase.name should round-trip")
	assert_eq(rc.failure_message, c.failure_message, "Unicode failure_message should round-trip")
	assert_eq(rc.stack_trace, c.stack_trace, "Unicode stack_trace should round-trip")
	var ra: TestReport.Assertion = (rc.assertions as Array)[0]
	assert_eq(ra.description, "comparaison", "Unicode assertion description should round-trip")
	assert_eq(ra.expected, "héro", "Unicode assertion expected should round-trip")
	assert_eq(ra.actual, "roi", "Unicode assertion actual should round-trip")


func test_failed_report_with_suggested_action_survives_round_trip() -> void:
	for action in ["inspect_tres", "validate_gdscript", "rerun_test", "manual_review"]:
		var r: TestReport = TestReport.new()
		r.run_id = "run-%s" % action
		r.timestamp = "2026-05-06T00:00:00Z"
		r.total = 1
		r.passed = 0
		r.failed = 1
		r.suggested_action = action
		r.tests = [_make_failing_case("t_fail", "boom", "trace")]
		var restored: TestReport = TestReport.from_json(r.to_json())
		assert_eq(restored.suggested_action, action, "suggested_action '%s' should round-trip" % action)
		assert_true(restored.is_suggested_action_valid(), "suggested_action '%s' should validate after round-trip" % action)


func test_from_json_with_malformed_input_returns_empty_report() -> void:
	# Defensive: malformed JSON should not crash the parser.
	var restored: TestReport = TestReport.from_json("{not valid json}")
	assert_eq(restored.run_id, "", "Malformed JSON should produce a default report")
	assert_eq(restored.total, 0, "Malformed JSON total should default to 0")
	assert_eq(restored.tests.size(), 0, "Malformed JSON tests should default to empty Array")


func test_from_json_with_non_dictionary_root_returns_empty_report() -> void:
	# A JSON array at root must be rejected because TestReport is a Dictionary shape.
	var restored: TestReport = TestReport.from_json("[1, 2, 3]")
	assert_eq(restored.run_id, "", "Array-root JSON should produce a default report")
	assert_eq(restored.tests.size(), 0, "Array-root JSON should produce no tests")


func test_json_round_trip_preserves_numeric_counter_types() -> void:
	var r: TestReport = _make_valid_report()
	var restored: TestReport = TestReport.from_json(r.to_json())
	assert_eq(typeof(restored.total), TYPE_INT, "total must remain int after JSON round-trip")
	assert_eq(typeof(restored.passed), TYPE_INT, "passed must remain int after JSON round-trip")
	assert_eq(typeof(restored.failed), TYPE_INT, "failed must remain int after JSON round-trip")
	var first_case: TestReport.TestCase = restored.tests[0]
	assert_eq(typeof(first_case.duration_ms), TYPE_INT, "TestCase.duration_ms must remain int after JSON round-trip")
