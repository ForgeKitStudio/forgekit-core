extends GutTest
## Unit tests for McpJsonlLogger — Godot-side structured logger.
##
## Line shape shared with `mcp-server/src/observability/jsonl_logger.ts`:
##   {ts, level, component, trace_id?, span_id?, method?, duration_ms?, data?}
##
## Files rotate by UTC date under `<baseDir>/<component>/<YYYY-MM-DD>.jsonl`.
## The tests inject a clock and write to a scratch directory under
## `user://` so production `$HOME/.forgekit/...` is never touched.


const JSONL_LOGGER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/observability/jsonl_logger.gd")


# Unique scratch base per test so runs are independent.
var _scratch_base: String = ""


func before_each() -> void:
	_scratch_base = "user://test_jsonl_logger_%d" % Time.get_ticks_usec()


func after_each() -> void:
	_remove_dir_recursive(_scratch_base)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

func _new_logger(level: StringName = &"info") -> Object:
	var logger: Object = JSONL_LOGGER_SCRIPT.new()
	logger.base_dir = _scratch_base
	logger.level = level
	return logger


func _set_clock(logger: Object, iso_timestamp: String) -> void:
	logger.clock = func() -> String:
		return iso_timestamp


func _read_lines(path: String) -> Array:
	var lines: Array = []
	if not FileAccess.file_exists(path):
		return lines
	var file: FileAccess = FileAccess.open(path, FileAccess.READ)
	if file == null:
		return lines
	var text: String = file.get_as_text()
	file.close()
	for raw in text.split("\n"):
		if raw.is_empty():
			continue
		var parser: JSON = JSON.new()
		if parser.parse(raw) != OK:
			continue
		lines.append(parser.data)
	return lines


func _remove_dir_recursive(path: String) -> void:
	if not DirAccess.dir_exists_absolute(path):
		return
	var dir: DirAccess = DirAccess.open(path)
	if dir == null:
		return
	dir.list_dir_begin()
	var entry: String = dir.get_next()
	while entry != "":
		if entry == "." or entry == "..":
			entry = dir.get_next()
			continue
		var full_path: String = path.path_join(entry)
		if dir.current_is_dir():
			_remove_dir_recursive(full_path)
		else:
			DirAccess.remove_absolute(full_path)
		entry = dir.get_next()
	dir.list_dir_end()
	DirAccess.remove_absolute(path)


# ---------------------------------------------------------------------------
# 1) Round-trip: write one line, read it back, verify the shape.
# ---------------------------------------------------------------------------

func test_writes_one_line_per_call_with_expected_fields() -> void:
	var logger: Object = _new_logger(&"info")
	_set_clock(logger, "2026-05-16T18:12:33.540Z")

	logger.log(&"info", &"editor_plugin", {"method": "tests.run_unit", "detail": {"name": "test_crafting"}})

	var file_path: String = _scratch_base.path_join("editor_plugin/2026-05-16.jsonl")
	var lines: Array = _read_lines(file_path)
	assert_eq(lines.size(), 1, "Expected exactly one JSONL line")
	var entry: Dictionary = lines[0] as Dictionary
	assert_eq(String(entry.get("ts", "")), "2026-05-16T18:12:33.540Z", "ts must echo the injected clock")
	assert_eq(String(entry.get("level", "")), "info", "level must match the call argument")
	assert_eq(String(entry.get("component", "")), "editor_plugin", "component must match the call argument")
	assert_eq(String(entry.get("method", "")), "tests.run_unit", "method must be hoisted to top-level")
	var data: Dictionary = entry.get("data", {}) as Dictionary
	assert_true(data.has("detail"), "Remaining data fields must travel under 'data'")


# ---------------------------------------------------------------------------
# 2) Level filter: drops lines below the configured threshold.
# ---------------------------------------------------------------------------

func test_level_filter_drops_below_threshold() -> void:
	var logger: Object = _new_logger(&"warn")
	_set_clock(logger, "2026-05-16T12:00:00.000Z")

	logger.log(&"debug", &"editor_plugin", {})
	logger.log(&"info", &"editor_plugin", {})
	logger.log(&"warn", &"editor_plugin", {"note": "kept"})
	logger.log(&"error", &"editor_plugin", {"note": "kept"})

	var file_path: String = _scratch_base.path_join("editor_plugin/2026-05-16.jsonl")
	var lines: Array = _read_lines(file_path)
	assert_eq(lines.size(), 2, "Only warn and error must be retained when threshold is warn")
	var first: Dictionary = lines[0] as Dictionary
	var second: Dictionary = lines[1] as Dictionary
	assert_eq(String(first.get("level", "")), "warn", "First retained line must be warn")
	assert_eq(String(second.get("level", "")), "error", "Second retained line must be error")


# ---------------------------------------------------------------------------
# 3) Date rotation: a new UTC day yields a new file.
# ---------------------------------------------------------------------------

func test_rotates_by_utc_date() -> void:
	var logger: Object = _new_logger(&"info")
	_set_clock(logger, "2026-05-16T23:59:58.000Z")

	logger.log(&"info", &"editor_plugin", {"n": 1})

	_set_clock(logger, "2026-05-17T00:00:02.000Z")
	logger.log(&"info", &"editor_plugin", {"n": 2})

	var before: Array = _read_lines(_scratch_base.path_join("editor_plugin/2026-05-16.jsonl"))
	var after: Array = _read_lines(_scratch_base.path_join("editor_plugin/2026-05-17.jsonl"))
	assert_eq(before.size(), 1, "First line must land in the 2026-05-16 file")
	assert_eq(after.size(), 1, "Second line must land in the 2026-05-17 file")


# ---------------------------------------------------------------------------
# 4) Missing directory: the logger creates the parent tree on first write.
# ---------------------------------------------------------------------------

func test_creates_component_dir_recursively_on_first_write() -> void:
	var logger: Object = _new_logger(&"info")
	_set_clock(logger, "2026-05-16T12:00:00.000Z")

	# Pre-condition: base_dir does not yet exist.
	assert_false(DirAccess.dir_exists_absolute(_scratch_base), "Precondition: scratch base must not exist yet")

	logger.log(&"info", &"runtime_bridge", {"hello": "world"})

	var file_path: String = _scratch_base.path_join("runtime_bridge/2026-05-16.jsonl")
	var lines: Array = _read_lines(file_path)
	assert_eq(lines.size(), 1, "Missing component directory must be created on first write")


# ---------------------------------------------------------------------------
# 5) trace_id and span_id are hoisted to the top level when provided.
# ---------------------------------------------------------------------------

func test_hoists_trace_id_and_span_id_to_top_level() -> void:
	var logger: Object = _new_logger(&"info")
	_set_clock(logger, "2026-05-16T12:00:00.000Z")

	logger.log(&"info", &"editor_plugin", {
		"trace_id": "abcd1234",
		"span_id": "0001",
		"method": "project.info",
		"duration_ms": 12,
	})

	var file_path: String = _scratch_base.path_join("editor_plugin/2026-05-16.jsonl")
	var lines: Array = _read_lines(file_path)
	assert_eq(lines.size(), 1, "One line expected")
	var entry: Dictionary = lines[0] as Dictionary
	assert_eq(String(entry.get("trace_id", "")), "abcd1234", "trace_id must be hoisted to top-level")
	assert_eq(String(entry.get("span_id", "")), "0001", "span_id must be hoisted to top-level")
	assert_eq(String(entry.get("method", "")), "project.info", "method must be hoisted to top-level")
	assert_eq(int(entry.get("duration_ms", 0)), 12, "duration_ms must be hoisted to top-level")
