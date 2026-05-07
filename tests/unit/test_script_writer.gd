extends GutTest
## Unit tests for McpScriptWriter: atomically writes a GDScript source to
## disk iff the source parses cleanly and the target path is writable per
## Core_Boundary. On success the writer also invokes an injected reload
## callback so the editor can refresh the script resource.
##
## The writer is the headless-testable half of `gdscript.save_with_validation`.
## Editor-specific wiring (EditorInterface.reload_scripts, ResourceLoader
## cache invalidation) lives in the production backend and is not exercised
## here.


const SCRIPT_WRITER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/script_writer.gd")
const MCP_ERROR_CODES_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/mcp_error_codes.gd")


const _VALID_SOURCE: String = "extends RefCounted\nfunc answer() -> int:\n\treturn 42\n"
const _INVALID_SOURCE: String = "extends RefCounted\nfunc broken(\n\treturn 42\n"


# ---------------------------------------------------------------------------
# Reload callback sink — records every reload the writer triggers.
# ---------------------------------------------------------------------------

class ReloadSink:
	extends RefCounted

	var paths: Array = []

	func on_reload(path: String) -> void:
		paths.append(path)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

func _temp_base_dir() -> String:
	# `user://` is a writable scratch tree in both editor and headless runs.
	return "user://forgekit_script_writer_tests"


func _unique_path(suffix: String = "") -> String:
	var ts: int = Time.get_ticks_usec()
	return "%s/fixture_%d%s.gd" % [_temp_base_dir(), ts, suffix]


func before_each() -> void:
	DirAccess.make_dir_recursive_absolute(_temp_base_dir())


func after_each() -> void:
	# Best-effort cleanup. Leftover `.tmp` sidecars are expected when a test
	# deliberately simulates a rename failure.
	var dir: DirAccess = DirAccess.open(_temp_base_dir())
	if dir == null:
		return
	dir.list_dir_begin()
	var entry: String = dir.get_next()
	while entry != "":
		if not dir.current_is_dir():
			DirAccess.remove_absolute("%s/%s" % [_temp_base_dir(), entry])
		entry = dir.get_next()
	dir.list_dir_end()


func _new_writer() -> Object:
	return SCRIPT_WRITER_SCRIPT.new()


func _mark_expected_parse_errors_handled() -> void:
	# GDScript.reload() inside the validator pushes an engine-level parse
	# error when the source is invalid. Mark them handled so GUT does not
	# flag them as unexpected.
	for err in get_errors():
		err.handled = true


# ---------------------------------------------------------------------------
# 1) Valid source — writes file atomically and returns {written, path}.
# ---------------------------------------------------------------------------

func test_valid_source_writes_file_to_target_path() -> void:
	var writer: Object = _new_writer()
	var path: String = _unique_path("_ok")

	var result: Dictionary = writer.write(path, _VALID_SOURCE)

	assert_true(result.get("written", false), "Valid source must be reported as written")
	assert_eq(result.get("path", ""), path, "Result must echo the target path")
	assert_true(FileAccess.file_exists(path), "Target file must exist on disk after a successful write")

	var f: FileAccess = FileAccess.open(path, FileAccess.READ)
	assert_ne(f, null, "Target file must be readable after a successful write")
	var contents: String = f.get_as_text()
	f.close()
	assert_eq(contents, _VALID_SOURCE, "Target file contents must match the supplied source byte-for-byte")


# ---------------------------------------------------------------------------
# 2) Valid source — invokes the reload callback exactly once with the path.
# ---------------------------------------------------------------------------

func test_valid_source_triggers_reload_callback_once() -> void:
	var writer: Object = _new_writer()
	var sink: ReloadSink = ReloadSink.new()
	writer.set_reload_callable(Callable(sink, "on_reload"))
	var path: String = _unique_path("_reload")

	var _result: Dictionary = writer.write(path, _VALID_SOURCE)

	assert_eq(sink.paths.size(), 1, "Successful write must invoke the reload callback exactly once")
	assert_eq(sink.paths[0], path, "Reload callback must receive the written path")


# ---------------------------------------------------------------------------
# 3) Invalid source — returns GDSCRIPT_SYNTAX_ERROR envelope, file untouched.
# ---------------------------------------------------------------------------

func test_invalid_source_returns_gdscript_syntax_error() -> void:
	var writer: Object = _new_writer()
	var path: String = _unique_path("_bad")

	var result: Dictionary = writer.write(path, _INVALID_SOURCE)

	assert_false(result.get("written", true), "Invalid source must not report written == true")
	assert_true(result.has("error"), "Invalid source must return an error envelope")
	var err: Dictionary = result["error"]
	assert_eq(
		err.get("code", 0),
		MCP_ERROR_CODES_SCRIPT.GDSCRIPT_SYNTAX_ERROR,
		"Error code must be GDSCRIPT_SYNTAX_ERROR"
	)
	assert_eq(err.get("message", ""), "GDSCRIPT_SYNTAX_ERROR", "Error message must be GDSCRIPT_SYNTAX_ERROR")
	var data: Dictionary = err.get("data", {})
	assert_true(data.has("errors"), "Error data must include the validator errors list")
	assert_true((data["errors"] as Array).size() >= 1, "At least one parse diagnostic must be attached")
	assert_false(FileAccess.file_exists(path), "Target file must NOT be created when validation fails")
	_mark_expected_parse_errors_handled()


# ---------------------------------------------------------------------------
# 4) Invalid source — does not invoke the reload callback.
# ---------------------------------------------------------------------------

func test_invalid_source_does_not_trigger_reload_callback() -> void:
	var writer: Object = _new_writer()
	var sink: ReloadSink = ReloadSink.new()
	writer.set_reload_callable(Callable(sink, "on_reload"))
	var path: String = _unique_path("_bad_no_reload")

	var _result: Dictionary = writer.write(path, _INVALID_SOURCE)

	assert_eq(sink.paths.size(), 0, "Reload callback must NOT run on validation failure")
	_mark_expected_parse_errors_handled()


# ---------------------------------------------------------------------------
# 5) Invalid source — leaves pre-existing file byte-identical.
# ---------------------------------------------------------------------------

func test_invalid_source_leaves_existing_file_unchanged() -> void:
	var writer: Object = _new_writer()
	var path: String = _unique_path("_preserve")
	# Seed the target with known contents.
	var f: FileAccess = FileAccess.open(path, FileAccess.WRITE)
	f.store_string(_VALID_SOURCE)
	f.close()

	var _result: Dictionary = writer.write(path, _INVALID_SOURCE)

	var after: FileAccess = FileAccess.open(path, FileAccess.READ)
	var contents: String = after.get_as_text()
	after.close()
	assert_eq(contents, _VALID_SOURCE, "Pre-existing contents must survive a rejected write")
	_mark_expected_parse_errors_handled()


# ---------------------------------------------------------------------------
# 6) Core_Boundary violation — returns CORE_BOUNDARY_VIOLATION, no write.
# ---------------------------------------------------------------------------

func test_core_boundary_path_returns_core_boundary_violation() -> void:
	var writer: Object = _new_writer()
	var path: String = "res://addons/forgekit_core/mcp/tools/blocked_write.gd"

	var result: Dictionary = writer.write(path, _VALID_SOURCE)

	assert_false(result.get("written", true), "Core-boundary path must not report written == true")
	var err: Dictionary = result.get("error", {})
	assert_eq(
		err.get("code", 0),
		MCP_ERROR_CODES_SCRIPT.CORE_BOUNDARY_VIOLATION,
		"Error code must be CORE_BOUNDARY_VIOLATION"
	)
	assert_eq(err.get("message", ""), "CORE_BOUNDARY_VIOLATION", "Error message must match")
	var data: Dictionary = err.get("data", {})
	assert_eq(data.get("path", ""), path, "Error data must echo the rejected path")


# ---------------------------------------------------------------------------
# 7) Rename failure — writer returns ATOMIC_WRITE_FAILED and cleans the temp
#    sidecar. The existing target file stays intact.
# ---------------------------------------------------------------------------

func test_rename_failure_returns_atomic_write_failed_and_cleans_temp() -> void:
	var writer: Object = _new_writer()
	# Force the rename step to fail. Godot uses FAILED == 1 for generic I/O
	# failure; the writer only checks for non-OK.
	writer.set_renamer(func(_from: String, _to: String) -> int: return FAILED)

	var path: String = _unique_path("_rename_fail")
	# Seed a baseline target so we can assert it survives the failed write.
	var f: FileAccess = FileAccess.open(path, FileAccess.WRITE)
	f.store_string("# baseline\n")
	f.close()

	var result: Dictionary = writer.write(path, _VALID_SOURCE)

	assert_false(result.get("written", true), "Failed rename must not report written == true")
	var err: Dictionary = result.get("error", {})
	assert_eq(
		err.get("code", 0),
		MCP_ERROR_CODES_SCRIPT.ATOMIC_WRITE_FAILED,
		"Error code must be ATOMIC_WRITE_FAILED"
	)

	var tmp_path: String = path + ".tmp"
	assert_false(FileAccess.file_exists(tmp_path), "Temp sidecar must be removed after a failed rename")

	var after: FileAccess = FileAccess.open(path, FileAccess.READ)
	var contents: String = after.get_as_text()
	after.close()
	assert_eq(contents, "# baseline\n", "Original target must remain byte-identical after a failed rename")


# ---------------------------------------------------------------------------
# 8) validate() delegates to GDScriptValidator and returns its dictionary.
# ---------------------------------------------------------------------------

func test_validate_returns_validator_dictionary_for_valid_source() -> void:
	var writer: Object = _new_writer()

	var result: Dictionary = writer.validate(_VALID_SOURCE)

	assert_true(result.has("ok"), "validate() result must include 'ok'")
	assert_true(result.has("errors"), "validate() result must include 'errors'")
	assert_true(result.has("duration_ms"), "validate() result must include 'duration_ms'")
	assert_true(result["ok"], "Valid source must report ok == true")
	assert_eq((result["errors"] as Array).size(), 0, "Valid source must report zero errors")


func test_validate_returns_errors_for_invalid_source() -> void:
	var writer: Object = _new_writer()

	var result: Dictionary = writer.validate(_INVALID_SOURCE)

	assert_false(result["ok"], "Invalid source must report ok == false")
	assert_true((result["errors"] as Array).size() >= 1, "Invalid source must report at least one error")
	_mark_expected_parse_errors_handled()
