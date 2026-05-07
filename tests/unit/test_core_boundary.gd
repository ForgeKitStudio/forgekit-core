extends GutTest
## Unit tests for CoreBoundary: read-only path detection, glob deny-pattern
## matching, and the structured violation payload surfaced to the MCP server
## as CORE_BOUNDARY_VIOLATION.


const CORE_BOUNDARY_SCRIPT: GDScript = preload("res://addons/forgekit_core/boundary/core_boundary.gd")


# ---------------------------------------------------------------------------
# is_read_only
# ---------------------------------------------------------------------------

func test_is_read_only_detects_file_inside_forgekit_core() -> void:
	assert_true(
		CORE_BOUNDARY_SCRIPT.is_read_only("res://addons/forgekit_core/event_bus/game_events.gd"),
		"Files inside addons/forgekit_core must be read-only"
	)


func test_is_read_only_detects_the_forgekit_core_root_itself() -> void:
	assert_true(
		CORE_BOUNDARY_SCRIPT.is_read_only("res://addons/forgekit_core/"),
		"The addons/forgekit_core/ root must itself be read-only"
	)


func test_is_read_only_rejects_client_writable_module_path() -> void:
	assert_false(
		CORE_BOUNDARY_SCRIPT.is_read_only("res://addons/forgekit_rpg/combat/hitbox.gd"),
		"Files under addons/forgekit_rpg must not be flagged as read-only"
	)


func test_is_read_only_rejects_scenes_folder() -> void:
	assert_false(
		CORE_BOUNDARY_SCRIPT.is_read_only("res://scenes/player.tscn"),
		"Client-owned scenes/ folder must not be flagged as read-only"
	)


func test_is_read_only_accepts_project_relative_path_without_res_prefix() -> void:
	assert_true(
		CORE_BOUNDARY_SCRIPT.is_read_only("addons/forgekit_core/plugin.cfg"),
		"Project-relative paths (no res:// prefix) must still be normalized and matched"
	)


func test_is_read_only_detects_gut_addon() -> void:
	assert_true(
		CORE_BOUNDARY_SCRIPT.is_read_only("res://addons/gut/gut_cmdln.gd"),
		"Vendored GUT addon must be treated as read-only"
	)


# ---------------------------------------------------------------------------
# matches_deny_pattern
# ---------------------------------------------------------------------------

func test_matches_deny_pattern_matches_core_script() -> void:
	assert_true(
		CORE_BOUNDARY_SCRIPT.matches_deny_pattern(
			"res://addons/forgekit_core/manifest/module_manifest.gd"
		),
		"Deeply nested forgekit_core scripts must match a deny pattern"
	)


func test_matches_deny_pattern_rejects_client_writable_tres() -> void:
	assert_false(
		CORE_BOUNDARY_SCRIPT.matches_deny_pattern(
			"res://addons/forgekit_rpg/inventory/items/sword.tres"
		),
		"Client-writable .tres files under addons/forgekit_rpg must not match any deny pattern"
	)


# ---------------------------------------------------------------------------
# violation_for
# ---------------------------------------------------------------------------

func test_violation_for_returns_populated_dict_for_core_path() -> void:
	var result: Dictionary = CORE_BOUNDARY_SCRIPT.violation_for(
		"res://addons/forgekit_core/event_bus/game_events.gd"
	)
	assert_false(result.is_empty(), "violation_for must return a non-empty dict for denied paths")
	assert_eq(
		result.get("code"),
		"CORE_BOUNDARY_VIOLATION",
		"Violation payload must use the documented error code"
	)
	assert_eq(
		result.get("path"),
		"res://addons/forgekit_core/event_bus/game_events.gd",
		"Violation payload must echo back the offending path"
	)
	var matched_rule: Variant = result.get("matched_rule")
	assert_true(matched_rule is String, "matched_rule must be a String")
	assert_true(
		(matched_rule as String).length() > 0,
		"matched_rule must identify the specific rule that triggered the rejection"
	)


func test_violation_for_returns_empty_dict_for_allowed_path() -> void:
	var result: Dictionary = CORE_BOUNDARY_SCRIPT.violation_for(
		"res://scenes/player.tscn"
	)
	assert_true(result.is_empty(), "violation_for must return an empty dict for allowed paths")
