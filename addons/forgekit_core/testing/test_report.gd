class_name TestReport
extends RefCounted
## JSON-serializable test report produced by GUT, property, and gameplay runs.
##
## Shape:
##   TestReport { run_id, timestamp, total, passed, failed, tests[], suggested_action }
##   TestCase   { name, status, duration_ms, assertions[], failure_message, stack_trace }
##   Assertion  { description, passed, expected, actual }
##
## Round-trip contract: from_json(to_json(r)) reproduces every field on r,
## including Unicode strings inside failure_message and stack_trace.


## The four canonical suggested_action values attached to a failed run.
##
## Typed as Array[String] so the literal is a compile-time constant and callers
## can access it via TestReport.ALLOWED_SUGGESTED_ACTIONS without parse errors.
const ALLOWED_SUGGESTED_ACTIONS: Array[String] = [
	"inspect_tres",
	"validate_gdscript",
	"rerun_test",
	"manual_review",
]


## Stable identifier for this run; opaque to the report consumer.
@export var run_id: String = ""

## ISO-8601 timestamp describing when the run started.
@export var timestamp: String = ""

## Total number of test cases executed in this run.
@export var total: int = 0

## Number of test cases whose status is "passed".
@export var passed: int = 0

## Number of test cases whose status is "failed".
@export var failed: int = 0

## Ordered list of TestCase instances produced by the run.
@export var tests: Array = []

## One of ALLOWED_SUGGESTED_ACTIONS when failed > 0; empty String otherwise.
@export var suggested_action: String = ""


## Nested TestCase — one entry per executed test function.
class TestCase extends RefCounted:
	@export var name: String = ""
	## One of "passed", "failed", "skipped"; the producer selects the vocabulary.
	@export var status: String = ""
	@export var duration_ms: int = 0
	## List of Assertion instances recorded during this test.
	@export var assertions: Array = []
	## Human-readable failure text; empty when status != "failed".
	@export var failure_message: String = ""
	## Engine or framework backtrace; empty when unavailable.
	@export var stack_trace: String = ""


## Nested Assertion — one entry per assert_* call inside a TestCase.
class Assertion extends RefCounted:
	@export var description: String = ""
	@export var passed: bool = false
	## Expected value — any JSON-serializable Variant.
	@export var expected: Variant = null
	## Actual observed value — any JSON-serializable Variant.
	@export var actual: Variant = null


## Returns true when suggested_action matches the bounded-value contract.
##
## An empty suggested_action is legal only when failed == 0 (clean runs need
## no action). A non-empty value must appear in ALLOWED_SUGGESTED_ACTIONS.
func is_suggested_action_valid() -> bool:
	if suggested_action.is_empty():
		return failed == 0
	return ALLOWED_SUGGESTED_ACTIONS.has(suggested_action)


## Serializes this report to a plain Dictionary; pairs with from_dict for round-trip.
func to_dict() -> Dictionary:
	var cases: Array = []
	for t in tests:
		if t is TestCase:
			cases.append(_test_case_to_dict(t))
	return {
		"run_id": run_id,
		"timestamp": timestamp,
		"total": total,
		"passed": passed,
		"failed": failed,
		"tests": cases,
		"suggested_action": suggested_action,
	}


## Serializes this report to a JSON string; pairs with from_json for round-trip.
func to_json() -> String:
	return JSON.stringify(to_dict())


## Rebuilds a TestReport from a Dictionary produced by to_dict.
##
## Missing keys fall back to documented defaults. Entries in "tests" that
## are not Dictionaries are skipped defensively.
static func from_dict(data: Dictionary) -> TestReport:
	var report: TestReport = TestReport.new()
	report.run_id = String(data.get("run_id", ""))
	report.timestamp = String(data.get("timestamp", ""))
	report.total = int(data.get("total", 0))
	report.passed = int(data.get("passed", 0))
	report.failed = int(data.get("failed", 0))
	report.suggested_action = String(data.get("suggested_action", ""))

	var raw_tests: Variant = data.get("tests", [])
	var cases: Array = []
	if raw_tests is Array:
		for entry in raw_tests:
			if entry is Dictionary:
				cases.append(_test_case_from_dict(entry))
	report.tests = cases
	return report


## Rebuilds a TestReport from a JSON string. Malformed input or a non-Dictionary
## root yields a default report rather than raising, so the self-healing loop
## can always inspect the result.
##
## Uses JSON.new().parse() (not JSON.parse_string) so invalid input returns an
## error code instead of pushing an engine-level error that would pollute logs.
static func from_json(json_text: String) -> TestReport:
	var parser: JSON = JSON.new()
	var err: int = parser.parse(json_text)
	if err != OK:
		return TestReport.new()
	var parsed: Variant = parser.data
	if parsed is Dictionary:
		return from_dict(parsed)
	return TestReport.new()


# ---------------------------------------------------------------------------
# Internal helpers: TestCase and Assertion conversion.
# ---------------------------------------------------------------------------

static func _test_case_to_dict(c: TestCase) -> Dictionary:
	var asserts: Array = []
	for a in c.assertions:
		if a is Assertion:
			asserts.append(_assertion_to_dict(a))
	return {
		"name": c.name,
		"status": c.status,
		"duration_ms": c.duration_ms,
		"assertions": asserts,
		"failure_message": c.failure_message,
		"stack_trace": c.stack_trace,
	}


static func _test_case_from_dict(data: Dictionary) -> TestCase:
	var c: TestCase = TestCase.new()
	c.name = String(data.get("name", ""))
	c.status = String(data.get("status", ""))
	c.duration_ms = int(data.get("duration_ms", 0))
	c.failure_message = String(data.get("failure_message", ""))
	c.stack_trace = String(data.get("stack_trace", ""))

	var raw_asserts: Variant = data.get("assertions", [])
	var asserts: Array = []
	if raw_asserts is Array:
		for entry in raw_asserts:
			if entry is Dictionary:
				asserts.append(_assertion_from_dict(entry))
	c.assertions = asserts
	return c


static func _assertion_to_dict(a: Assertion) -> Dictionary:
	return {
		"description": a.description,
		"passed": a.passed,
		"expected": a.expected,
		"actual": a.actual,
	}


static func _assertion_from_dict(data: Dictionary) -> Assertion:
	var a: Assertion = Assertion.new()
	a.description = String(data.get("description", ""))
	a.passed = bool(data.get("passed", false))
	a.expected = data.get("expected", null)
	a.actual = data.get("actual", null)
	return a
