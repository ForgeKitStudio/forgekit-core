extends "res://addons/gut/hook_script.gd"
## GUT post-run hook that emits a TestReport JSON line on stdout.
##
## The MCP server's `tests.run_unit` tool spawns Godot headless with
## `gut_cmdln.gd` and parses the last JSON line of stdout into the
## canonical TestReport schema (`addons/forgekit_core/testing/test_report.gd`).
## Stock GUT does not emit such a line, so this hook is wired in via
## `-gpost_run_script=res://addons/forgekit_core/testing/gut_to_test_report_hook.gd`
## and prints the report after every test finishes.
##
## The TestReport JSON line is wrapped between two sentinel markers so
## the extractor can find it even when GUT prints other JSON-shaped
## diagnostics earlier in the run.

const TEST_REPORT_SCRIPT: GDScript = preload("res://addons/forgekit_core/testing/test_report.gd")

const REPORT_BEGIN: String = "##FORGEKIT_TEST_REPORT_BEGIN##"
const REPORT_END: String = "##FORGEKIT_TEST_REPORT_END##"


func run() -> void:
	var report := _build_report()
	print("\n%s" % REPORT_BEGIN)
	print(report.to_json())
	print(REPORT_END)


## Walks the live `gut.get_test_collector()` and produces a TestReport
## value object whose `total / passed / failed` counts reflect the
## per-test status (not the per-assertion totals).
func _build_report() -> TestReport:
	var report: TestReport = TEST_REPORT_SCRIPT.new()
	report.run_id = _generate_run_id()
	report.timestamp = Time.get_datetime_string_from_system(true)

	var collector: Variant = gut.get_test_collector()
	var total: int = 0
	var passed: int = 0
	var failed: int = 0
	var test_cases: Array = []

	if collector != null:
		for collected_script in collector.scripts:
			if not collected_script.was_run:
				continue
			for test in collected_script.tests:
				if not test.was_run:
					continue
				total += 1
				var status: String = _classify_test(test)
				if status == "passed":
					passed += 1
				elif status == "failed":
					failed += 1
				test_cases.append(_build_test_case(collected_script, test, status))

	report.total = total
	report.passed = passed
	report.failed = failed
	report.tests = test_cases
	report.suggested_action = "" if failed == 0 else "rerun_test"
	return report


func _classify_test(test: Variant) -> String:
	if test.is_failing():
		return "failed"
	if test.is_pending():
		return "pending"
	if test.is_passing():
		return "passed"
	return "skipped"


## Returns a `TestReport.TestCase` instance (not a plain Dictionary) so
## `TestReport.to_dict()` keeps the entry; the parent class filters out
## anything that does not pass `is TestCase`.
func _build_test_case(collected_script: Variant, test: Variant, status: String) -> TestReport.TestCase:
	var case: TestReport.TestCase = TEST_REPORT_SCRIPT.TestCase.new()
	case.name = "%s::%s" % [collected_script.get_full_name(), test.name]
	case.status = status
	case.duration_ms = int(round(test.time_taken * 1000.0))

	var assertions: Array = []
	for pass_text in test.pass_texts:
		assertions.append(_build_assertion(String(pass_text), true))
	for fail_text in test.fail_texts:
		assertions.append(_build_assertion(String(fail_text), false))
	case.assertions = assertions

	if test.fail_texts.size() > 0:
		case.failure_message = "\n".join(test.fail_texts)
	else:
		case.failure_message = ""
	case.stack_trace = ""
	return case


func _build_assertion(description: String, did_pass: bool) -> TestReport.Assertion:
	var a: TestReport.Assertion = TEST_REPORT_SCRIPT.Assertion.new()
	a.description = description
	a.passed = did_pass
	a.expected = ""
	a.actual = ""
	return a


func _generate_run_id() -> String:
	var bytes: PackedByteArray = Crypto.new().generate_random_bytes(8)
	return bytes.hex_encode()
