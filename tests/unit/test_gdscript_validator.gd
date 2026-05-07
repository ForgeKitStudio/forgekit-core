extends GutTest
## Unit tests for GDScriptValidator: shape of the return dictionary, syntax error
## detection, duration measurement, and the 200 KB performance budget.


const GDSCRIPT_VALIDATOR_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/gdscript_validator.gd")


func _make_validator() -> GDScriptValidator:
	return GDSCRIPT_VALIDATOR_SCRIPT.new()


func _assert_result_shape(result: Dictionary) -> void:
	assert_true(result.has("ok"), "Result must contain the 'ok' key")
	assert_true(result.has("errors"), "Result must contain the 'errors' key")
	assert_true(result.has("duration_ms"), "Result must contain the 'duration_ms' key")
	assert_eq(typeof(result["ok"]), TYPE_BOOL, "'ok' must be a bool")
	assert_eq(typeof(result["errors"]), TYPE_ARRAY, "'errors' must be an Array")
	assert_eq(typeof(result["duration_ms"]), TYPE_INT, "'duration_ms' must be an int")


func test_valid_script_returns_ok_true() -> void:
	var validator: GDScriptValidator = _make_validator()
	var source: String = "extends RefCounted\nfunc foo() -> int:\n\treturn 42\n"

	var result: Dictionary = validator.validate(source)

	_assert_result_shape(result)
	assert_true(result["ok"], "Valid source must yield ok == true")


func test_valid_script_returns_empty_errors_array() -> void:
	var validator: GDScriptValidator = _make_validator()
	var source: String = "extends RefCounted\nfunc foo() -> int:\n\treturn 42\n"

	var result: Dictionary = validator.validate(source)

	var errors: Array = result["errors"]
	assert_eq(errors.size(), 0, "Valid source must yield an empty errors array")


func test_empty_source_returns_ok_true() -> void:
	var validator: GDScriptValidator = _make_validator()

	var result: Dictionary = validator.validate("")

	_assert_result_shape(result)
	assert_true(result["ok"], "Empty source is legal GDScript and must yield ok == true")
	assert_eq((result["errors"] as Array).size(), 0, "Empty source must yield no errors")


func _mark_expected_parse_errors_handled() -> void:
	# GDScript.reload() pushes an engine-level parse error when the source has a
	# syntax error. That is expected behaviour in these tests, so we mark every
	# tracked error as handled to keep GUT from flagging them as unexpected.
	for err in get_errors():
		err.handled = true


func test_syntax_error_returns_ok_false() -> void:
	var validator: GDScriptValidator = _make_validator()
	# Unterminated parameter list — a definite parse error.
	var source: String = "extends RefCounted\nfunc foo(\n\treturn 42\n"

	var result: Dictionary = validator.validate(source)

	_assert_result_shape(result)
	assert_false(result["ok"], "Source with a syntax error must yield ok == false")
	_mark_expected_parse_errors_handled()


func test_syntax_error_errors_array_non_empty() -> void:
	var validator: GDScriptValidator = _make_validator()
	var source: String = "extends RefCounted\nfunc foo(\n\treturn 42\n"

	var result: Dictionary = validator.validate(source)

	var errors: Array = result["errors"]
	assert_true(errors.size() >= 1, "Source with a syntax error must yield at least one error entry")
	_mark_expected_parse_errors_handled()


func test_error_entry_has_line_col_msg_fields() -> void:
	var validator: GDScriptValidator = _make_validator()
	var source: String = "extends RefCounted\nfunc foo(\n\treturn 42\n"

	var result: Dictionary = validator.validate(source)

	var errors: Array = result["errors"]
	assert_true(errors.size() >= 1, "Precondition: at least one error is expected")
	for entry in errors:
		assert_eq(typeof(entry), TYPE_DICTIONARY, "Each error entry must be a Dictionary")
		var dict: Dictionary = entry
		assert_true(dict.has("line"), "Error entry must contain the 'line' key")
		assert_true(dict.has("col"), "Error entry must contain the 'col' key")
		assert_true(dict.has("msg"), "Error entry must contain the 'msg' key")
		assert_eq(typeof(dict["line"]), TYPE_INT, "'line' must be an int")
		assert_eq(typeof(dict["col"]), TYPE_INT, "'col' must be an int")
		assert_eq(typeof(dict["msg"]), TYPE_STRING, "'msg' must be a String")
		assert_true((dict["msg"] as String).length() > 0, "'msg' must not be an empty string")
	_mark_expected_parse_errors_handled()


func test_duration_ms_is_present_and_non_negative() -> void:
	var validator: GDScriptValidator = _make_validator()

	var result: Dictionary = validator.validate("extends RefCounted\n")

	_assert_result_shape(result)
	assert_true(result["duration_ms"] >= 0, "'duration_ms' must be >= 0")


func test_unicode_in_comments_validates_ok() -> void:
	var validator: GDScriptValidator = _make_validator()
	var source: String = "extends RefCounted\n# Unicode: \u2694 \u5263 héroïque\nvar label: String = \"\u5263\"\n"

	var result: Dictionary = validator.validate(source)

	assert_true(result["ok"], "Unicode inside comments and string literals must parse cleanly")
	assert_eq((result["errors"] as Array).size(), 0, "Unicode source must yield no errors")


func test_large_200kb_valid_script_validates_under_500ms() -> void:
	var validator: GDScriptValidator = _make_validator()
	# Build a synthetic, valid GDScript source of ~200 KB. Each function block below
	# is roughly 60 bytes; 4000 repetitions gives ~240 KB, comfortably above the
	# 200 KB threshold so we exercise the upper bound of the performance budget.
	var block: String = "func fn_%d(x: int) -> int:\n\tvar y: int = x + %d\n\treturn y\n"
	var parts: PackedStringArray = PackedStringArray()
	parts.append("extends RefCounted\n")
	for i in range(4000):
		parts.append(block % [i, i])
	var source: String = "".join(parts)

	# Sanity check that we are actually exercising the 200 KB case.
	assert_true(source.length() >= 200 * 1024, "Generated script must be at least 200 KB")

	var result: Dictionary = validator.validate(source)

	assert_true(result["ok"], "Generated 200 KB script must be syntactically valid")
	assert_true(
		result["duration_ms"] < 500,
		"200 KB script must validate in under 500 ms (got %d ms)" % result["duration_ms"]
	)
