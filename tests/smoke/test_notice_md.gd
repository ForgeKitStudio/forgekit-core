extends GutTest
## Smoke test that asserts the presence and minimum content of `NOTICE.md`.
## The notice file is the human-readable license manifest for every ForgeKit
## module installed in the project; the entry for `forgekit_core` must
## always declare MIT so downstream users (and the Module_Installer) have a
## stable reference for the free core.


const NOTICE_PATH: String = "res://NOTICE.md"

const CORE_MODULE_TOKEN: String = "forgekit_core"
const MIT_LICENSE_TOKEN: String = "MIT"


func _read_notice() -> String:
	var file: FileAccess = FileAccess.open(NOTICE_PATH, FileAccess.READ)
	if file == null:
		return ""
	var text: String = file.get_as_text()
	file.close()
	return text


func test_notice_md_exists_at_project_root() -> void:
	assert_true(
		FileAccess.file_exists(NOTICE_PATH),
		"NOTICE.md must exist at the project root so the license manifest ships with the template"
	)


func test_notice_md_is_not_empty() -> void:
	var content: String = _read_notice()
	assert_true(
		content.strip_edges().length() > 0,
		"NOTICE.md must not be empty — it lists every installed module's license"
	)


## Scans every line for a single entry that mentions both the core module
## id and the MIT license. Keeping the check line-scoped guarantees the
## two tokens describe the same row even as the markdown table or prose
## layout evolves.
func test_notice_md_declares_core_license_as_mit() -> void:
	var content: String = _read_notice()
	assert_true(content.length() > 0, "NOTICE.md must be readable")

	var lines: PackedStringArray = content.split("\n", false)
	var found: bool = false
	for line in lines:
		if line.contains(CORE_MODULE_TOKEN) and line.contains(MIT_LICENSE_TOKEN):
			found = true
			break
	assert_true(
		found,
		"NOTICE.md must contain a single line associating '%s' with the '%s' license" % [
			CORE_MODULE_TOKEN,
			MIT_LICENSE_TOKEN,
		]
	)
