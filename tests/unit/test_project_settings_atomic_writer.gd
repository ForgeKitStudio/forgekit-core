extends GutTest
## Unit tests for McpProjectSettingsAtomicWriter: atomic read → parse → modify
## → write-temp → fsync → rename sequence, per-key merge semantics, preservation
## of other input actions, independent `deadzone` / `events` writes, and
## original-file integrity on rename failure.


const WRITER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/project_settings_atomic_writer.gd")
const MCP_ERROR_CODES_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/mcp_error_codes.gd")


const _SCRATCH_DIR: String = "user://test_scratch_project_settings_atomic_writer"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

func _ensure_scratch_dir() -> void:
	if not DirAccess.dir_exists_absolute(_SCRATCH_DIR):
		DirAccess.make_dir_recursive_absolute(_SCRATCH_DIR)


func _remove_scratch_dir() -> void:
	if not DirAccess.dir_exists_absolute(_SCRATCH_DIR):
		return
	var dir: DirAccess = DirAccess.open(_SCRATCH_DIR)
	if dir == null:
		return
	dir.list_dir_begin()
	var entry: String = dir.get_next()
	while entry != "":
		if entry != "." and entry != "..":
			DirAccess.remove_absolute(_SCRATCH_DIR.path_join(entry))
		entry = dir.get_next()
	dir.list_dir_end()
	DirAccess.remove_absolute(_SCRATCH_DIR)


func _write_file(path: String, text: String) -> void:
	var f: FileAccess = FileAccess.open(path, FileAccess.WRITE)
	assert_not_null(f, "FileAccess.open must succeed for write at %s" % path)
	f.store_string(text)
	f.close()


func _read_file(path: String) -> String:
	var f: FileAccess = FileAccess.open(path, FileAccess.READ)
	if f == null:
		return ""
	var text: String = f.get_as_text()
	f.close()
	return text


func _sample_project_godot_body() -> String:
	# Minimal project.godot-like content with an [input] section containing
	# three actions. Each action value is a Dictionary with deadzone + events,
	# matching the Godot 4.x input-map layout that tomyud1/godot-mcp used to
	# clobber when naively replacing the whole action entry.
	return """config_version=5

[application]

config/name="Test Project"
config/description="Fixture for atomic writer tests"

[input]

ui_accept={
"deadzone": 0.5,
"events": [{"type": "key", "keycode": 4194309}]
}
move_left={
"deadzone": 0.2,
"events": [{"type": "key", "keycode": 65}]
}
move_right={
"deadzone": 0.2,
"events": [{"type": "key", "keycode": 68}]
}
"""


func before_each() -> void:
	_ensure_scratch_dir()


func after_each() -> void:
	_remove_scratch_dir()


func _scratch_path(name: String) -> String:
	return _SCRATCH_DIR.path_join(name)


func _load_cfg(path: String) -> ConfigFile:
	var cfg: ConfigFile = ConfigFile.new()
	var err: int = cfg.load(path)
	assert_eq(err, OK, "ConfigFile.load must succeed at %s" % path)
	return cfg


# ---------------------------------------------------------------------------
# 1) Parser extracts input actions as Dictionaries with deadzone + events.
# ---------------------------------------------------------------------------

func test_parse_extracts_input_action_dict_with_deadzone_and_events() -> void:
	var path: String = _scratch_path("project_parse.godot")
	_write_file(path, _sample_project_godot_body())

	var settings: Dictionary = WRITER_SCRIPT.parse(path)
	assert_true(settings.has("input"), "Parsed settings must contain 'input' section")

	var input_section: Dictionary = settings["input"]
	assert_true(input_section.has("ui_accept"), "input section must contain ui_accept")
	var ui_accept: Dictionary = input_section["ui_accept"]
	assert_eq(ui_accept.get("deadzone", -1.0), 0.5, "ui_accept.deadzone must parse to 0.5")
	var events: Array = ui_accept.get("events", [])
	assert_eq(events.size(), 1, "ui_accept.events must contain exactly one event")


# ---------------------------------------------------------------------------
# 2) update() applies a single-key patch and preserves untouched top-level keys.
# ---------------------------------------------------------------------------

func test_update_replaces_only_patched_key_and_preserves_others() -> void:
	var path: String = _scratch_path("project_single_patch.godot")
	_write_file(path, _sample_project_godot_body())

	var writer: Object = WRITER_SCRIPT.new()
	var result: Dictionary = writer.update(path, {"application/config/name": "Renamed"})

	assert_true(result.get("applied", false), "update() must return applied: true on success")
	assert_true(result.has("keys_changed"), "Result must expose keys_changed array")
	assert_eq((result["keys_changed"] as Array).size(), 1, "Exactly one key must be reported as changed")

	var cfg: ConfigFile = _load_cfg(path)
	assert_eq(cfg.get_value("application", "config/name", ""), "Renamed", "Patched value must be persisted")
	assert_eq(
		cfg.get_value("application", "config/description", ""),
		"Fixture for atomic writer tests",
		"Sibling key in same section must be preserved byte-for-byte"
	)
	assert_true(cfg.has_section_key("input", "ui_accept"), "Other sections must be preserved")


# ---------------------------------------------------------------------------
# 3) Modifying input/<action_a>/events preserves input/<action_b>/events and
#    input/<action_b>/deadzone for at least two other actions.
#    This is the specific tomyud1 bug: naïve update_project_settings used to
#    overwrite the entire [input] block, flattening sibling actions.
# ---------------------------------------------------------------------------

func test_update_preserves_other_input_actions_when_patching_events() -> void:
	var path: String = _scratch_path("project_preserve_others.godot")
	_write_file(path, _sample_project_godot_body())

	var new_events: Array = [{"type": "key", "keycode": 32}]  # Space
	var writer: Object = WRITER_SCRIPT.new()
	var result: Dictionary = writer.update(path, {"input/ui_accept/events": new_events})

	assert_true(result.get("applied", false), "update() must return applied: true")

	var cfg: ConfigFile = _load_cfg(path)

	# Patched action got the new events.
	var ui_accept: Dictionary = cfg.get_value("input", "ui_accept", {})
	assert_eq(
		(ui_accept.get("events", []) as Array).size(),
		1,
		"ui_accept.events must contain the single new event"
	)
	assert_eq(
		(ui_accept.get("events", [])[0] as Dictionary).get("keycode", -1),
		32,
		"ui_accept.events[0].keycode must be the new value"
	)

	# Other actions untouched.
	var move_left: Dictionary = cfg.get_value("input", "move_left", {})
	assert_eq(move_left.get("deadzone", -1.0), 0.2, "move_left.deadzone must be preserved")
	assert_eq(
		(move_left.get("events", [])[0] as Dictionary).get("keycode", -1),
		65,
		"move_left.events must be preserved"
	)

	var move_right: Dictionary = cfg.get_value("input", "move_right", {})
	assert_eq(move_right.get("deadzone", -1.0), 0.2, "move_right.deadzone must be preserved")
	assert_eq(
		(move_right.get("events", [])[0] as Dictionary).get("keycode", -1),
		68,
		"move_right.events must be preserved"
	)


# ---------------------------------------------------------------------------
# 4) Patching only `deadzone` for an action keeps the existing events intact.
# ---------------------------------------------------------------------------

func test_update_deadzone_only_preserves_existing_events() -> void:
	var path: String = _scratch_path("project_deadzone_only.godot")
	_write_file(path, _sample_project_godot_body())

	var writer: Object = WRITER_SCRIPT.new()
	var result: Dictionary = writer.update(path, {"input/ui_accept/deadzone": 0.25})

	assert_true(result.get("applied", false), "update() must return applied: true")

	var cfg: ConfigFile = _load_cfg(path)
	var ui_accept: Dictionary = cfg.get_value("input", "ui_accept", {})
	assert_eq(ui_accept.get("deadzone", -1.0), 0.25, "deadzone must be the patched value")

	var events: Array = ui_accept.get("events", [])
	assert_eq(events.size(), 1, "events array must be preserved")
	assert_eq(
		(events[0] as Dictionary).get("keycode", -1),
		4194309,
		"events[0].keycode must be the original value"
	)


# ---------------------------------------------------------------------------
# 5) Patching only `events` for an action keeps the existing deadzone intact.
# ---------------------------------------------------------------------------

func test_update_events_only_preserves_existing_deadzone() -> void:
	var path: String = _scratch_path("project_events_only.godot")
	_write_file(path, _sample_project_godot_body())

	var new_events: Array = [{"type": "key", "keycode": 32}]
	var writer: Object = WRITER_SCRIPT.new()
	var result: Dictionary = writer.update(path, {"input/ui_accept/events": new_events})

	assert_true(result.get("applied", false), "update() must return applied: true")

	var cfg: ConfigFile = _load_cfg(path)
	var ui_accept: Dictionary = cfg.get_value("input", "ui_accept", {})
	assert_eq(
		ui_accept.get("deadzone", -1.0),
		0.5,
		"deadzone must be preserved when only events are patched"
	)


# ---------------------------------------------------------------------------
# 6) Success leaves no .tmp sidecar on disk.
# ---------------------------------------------------------------------------

func test_update_leaves_no_tmp_file_on_success() -> void:
	var path: String = _scratch_path("project_no_tmp.godot")
	_write_file(path, _sample_project_godot_body())

	var writer: Object = WRITER_SCRIPT.new()
	var _r: Dictionary = writer.update(path, {"application/config/name": "Renamed"})

	var tmp_path: String = path + ".tmp"
	assert_false(
		FileAccess.file_exists(tmp_path),
		"Temp sidecar must be removed after a successful atomic write"
	)


# ---------------------------------------------------------------------------
# 7) On rename failure the original file is unchanged and the error envelope
#    reports ATOMIC_WRITE_FAILED. Simulated via the injectable renamer.
# ---------------------------------------------------------------------------

class FailingRenamer:
	extends RefCounted

	var attempts: int = 0

	func rename(_from_path: String, _to_path: String) -> int:
		attempts += 1
		# FAILED == 1 in @GlobalScope.Error; any non-zero value represents an
		# OS-level rename failure.
		return FAILED


func test_update_with_rename_failure_leaves_original_file_untouched() -> void:
	var path: String = _scratch_path("project_rename_fail.godot")
	var original_body: String = _sample_project_godot_body()
	_write_file(path, original_body)

	var renamer: FailingRenamer = FailingRenamer.new()
	var writer: Object = WRITER_SCRIPT.new()
	writer.set_renamer(Callable(renamer, "rename"))

	var result: Dictionary = writer.update(path, {"application/config/name": "ShouldNotLand"})

	assert_false(result.get("applied", true), "Failed update must not report applied: true")
	assert_true(result.has("error"), "Failed update must return an error envelope")
	var err: Dictionary = result.get("error", {})
	assert_eq(
		err.get("code", 0),
		MCP_ERROR_CODES_SCRIPT.ATOMIC_WRITE_FAILED,
		"Error code must be ATOMIC_WRITE_FAILED"
	)

	assert_eq(
		_read_file(path),
		original_body,
		"Original project.godot must be unchanged when rename fails"
	)
	assert_false(
		FileAccess.file_exists(path + ".tmp"),
		"Temp sidecar must be cleaned up on rename failure"
	)
	assert_eq(renamer.attempts, 1, "Renamer must be invoked exactly once")


# ---------------------------------------------------------------------------
# 8) update() on a non-existent path returns FILE_NOT_FOUND.
# ---------------------------------------------------------------------------

func test_update_missing_file_returns_file_not_found() -> void:
	var writer: Object = WRITER_SCRIPT.new()
	var result: Dictionary = writer.update(_scratch_path("does_not_exist.godot"), {"a/b": 1})

	assert_false(result.get("applied", true), "Missing file must not report applied: true")
	var err: Dictionary = result.get("error", {})
	assert_eq(
		err.get("code", 0),
		MCP_ERROR_CODES_SCRIPT.FILE_NOT_FOUND,
		"Missing file must surface FILE_NOT_FOUND"
	)


# ---------------------------------------------------------------------------
# 9) Flat replacement still works for sub-keyed settings like rendering/*.
# ---------------------------------------------------------------------------

func test_update_flat_setting_replaces_value_in_nested_key() -> void:
	var path: String = _scratch_path("project_flat_setting.godot")
	_write_file(path, """config_version=5

[rendering]

textures/canvas_textures/default_texture_filter=0
""")

	var writer: Object = WRITER_SCRIPT.new()
	var result: Dictionary = writer.update(
		path,
		{"rendering/textures/canvas_textures/default_texture_filter": 1}
	)
	assert_true(result.get("applied", false), "update() must return applied: true")

	var cfg: ConfigFile = _load_cfg(path)
	assert_eq(
		cfg.get_value("rendering", "textures/canvas_textures/default_texture_filter", -1),
		1,
		"Nested flat key must be replaced"
	)


# ---------------------------------------------------------------------------
# 10) Multi-key patch reports all changed keys.
# ---------------------------------------------------------------------------

func test_update_multi_key_patch_reports_all_changed_keys() -> void:
	var path: String = _scratch_path("project_multi_key.godot")
	_write_file(path, _sample_project_godot_body())

	var writer: Object = WRITER_SCRIPT.new()
	var result: Dictionary = writer.update(path, {
		"application/config/name": "Multi",
		"input/ui_accept/deadzone": 0.1,
	})

	assert_true(result.get("applied", false), "update() must return applied: true")
	var keys_changed: Array = result.get("keys_changed", [])
	assert_eq(keys_changed.size(), 2, "Both patched keys must be reported")
	assert_true(keys_changed.has("application/config/name"), "application/config/name must be reported")
	assert_true(keys_changed.has("input/ui_accept/deadzone"), "input/ui_accept/deadzone must be reported")
