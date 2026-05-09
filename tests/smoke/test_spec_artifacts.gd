extends GutTest
## Smoke test that locks down filesystem-level artefacts required by the
## ForgeKit specification: GUT installation, SKILLS package contents,
## template-repository context files, and README Quickstart anchor.
##
## These assertions exist so CI flags regressions such as a deleted
## `docs/SKILLS/authoring_items.md` or a missing `CLAUDE.md` template
## placeholder before a release ships.


const SKILLS_DIR: String = "res://docs/SKILLS/"
const REQUIRED_SKILLS: Array[String] = [
	"authoring_items.md",
	"debugging_failing_tests.md",
	"self_healing_tres.md",
	"module_licensing.md",
]

const REQUIRED_SKILL_SECTIONS: Array[String] = [
	"## MCP tool call sequence",
	"## Example user query",
]

const REQUIRED_ROOT_FILES: Array[String] = [
	"CLAUDE.md",
	".cursorrules",
	"README.md",
]


func _absolute(resource_path: String) -> String:
	return ProjectSettings.globalize_path(resource_path)


func _read_text(resource_path: String) -> String:
	var handle: FileAccess = FileAccess.open(resource_path, FileAccess.READ)
	if handle == null:
		return ""
	var text: String = handle.get_as_text()
	handle.close()
	return text


# ---------------------------------------------------------------------------
# Requirement 12.1 — GUT installed under `addons/gut/`
# ---------------------------------------------------------------------------

func test_gut_runner_is_installed_under_addons() -> void:
	assert_true(
		DirAccess.dir_exists_absolute(_absolute("res://addons/gut/")),
		"addons/gut/ must exist — GUT_Test_Runner is the unit-test harness"
	)
	assert_true(
		FileAccess.file_exists("res://addons/gut/gut_cmdln.gd"),
		"addons/gut/gut_cmdln.gd must exist so CI can invoke GUT headlessly"
	)


# ---------------------------------------------------------------------------
# Requirement 29 — SKILLS package
# ---------------------------------------------------------------------------

func test_skills_directory_is_present() -> void:
	assert_true(
		DirAccess.dir_exists_absolute(_absolute(SKILLS_DIR)),
		"docs/SKILLS/ must exist — the SKILLS pack ships with every release"
	)


func test_every_required_skill_file_is_present() -> void:
	for filename in REQUIRED_SKILLS:
		var resource_path: String = SKILLS_DIR + filename
		assert_true(
			FileAccess.file_exists(resource_path),
			"Missing required skill file: %s" % resource_path
		)


func test_every_skill_file_declares_api_version_and_required_sections() -> void:
	for filename in REQUIRED_SKILLS:
		var resource_path: String = SKILLS_DIR + filename
		var text: String = _read_text(resource_path)
		assert_ne(text, "", "Skill file %s is empty or unreadable" % resource_path)
		assert_true(
			text.find("api_version:") != -1,
			"Skill file %s must declare an api_version: field in its front-matter" % resource_path,
		)
		for section in REQUIRED_SKILL_SECTIONS:
			assert_true(
				text.find(section) != -1,
				"Skill file %s must contain section %s" % [resource_path, section],
			)


# ---------------------------------------------------------------------------
# Requirements 4.1 / 4.2 / 45.2 / 45.3 / 45.4 / 45.5 — Template Repository
# layout
# ---------------------------------------------------------------------------

func test_root_context_files_are_present_for_ai_clients() -> void:
	for filename in REQUIRED_ROOT_FILES:
		var resource_path: String = "res://" + filename
		assert_true(
			FileAccess.file_exists(resource_path),
			"Required top-level file is missing: %s" % resource_path,
		)


func test_readme_contains_quickstart_anchor() -> void:
	var text: String = _read_text("res://README.md")
	assert_ne(text, "", "README.md must be readable for the Quickstart check")
	assert_true(
		text.find("## Quickstart") != -1,
		"README.md must contain a '## Quickstart' section (Template Repository)",
	)
	assert_true(
		text.find("crafting.execute") != -1,
		"README.md Quickstart must walk the reader to the first crafting.execute call",
	)


# ---------------------------------------------------------------------------
# Requirement 45.3 — `addons/forgekit_rpg/` placeholder exists for the
# module archive drop-in
# ---------------------------------------------------------------------------

func test_forgekit_rpg_placeholder_directory_exists() -> void:
	assert_true(
		DirAccess.dir_exists_absolute(_absolute("res://addons/forgekit_rpg/")),
		"addons/forgekit_rpg/ placeholder directory must exist — the module ZIP is dropped here",
	)
