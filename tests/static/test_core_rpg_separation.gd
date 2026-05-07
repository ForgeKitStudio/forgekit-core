extends GutTest
## Static boundary test that enforces the two import rules separating
## ForgeKit_Core from the paid ForgeKit_RPG_Module:
##
##   Rule 1.2 — `addons/forgekit_core/` must not import from any other
##              `forgekit_*` addon. Core is meant to be upgradeable by
##              swapping directories, so a core file reaching into
##              `forgekit_rpg/` would break that contract.
##
##   Rule 1.3 — Files inside `addons/forgekit_rpg/<subsystem>/` may only
##              reach other subsystems through
##              `addons/forgekit_rpg/public_api.gd`. Imports of *other*
##              `forgekit_*` modules are forbidden outright.
##
## The scanner walks every `.gd` file under both roots, extracts every
## `preload("res://...")`, `load("res://...")`, and `extends "res://..."`
## target, and reports each offending file once. The scanner intentionally
## mirrors the logic of the TypeScript `project.check_imports` MCP tool so
## the test can run entirely inside Godot without depending on the MCP
## server.


const CORE_ROOT: String = "res://addons/forgekit_core/"
const RPG_ROOT: String = "res://addons/forgekit_rpg/"
const RPG_PUBLIC_API: String = "res://addons/forgekit_rpg/public_api.gd"
const ADDONS_PREFIX: String = "res://addons/"
const FORGEKIT_MODULE_PREFIX: String = "forgekit_"


func test_project_has_no_core_rpg_boundary_violations() -> void:
	var violations: Array = _collect_violations()
	assert_eq(
		violations.size(),
		0,
		"project.check_imports must report zero violations; got: %s" % _format_violations(violations)
	)


## Scans both roots and returns a list of `{file, imports, reason}`
## dictionaries. Missing roots (e.g. `forgekit_rpg/` containing only the
## purchase placeholder) yield an empty list rather than an error, so the
## test still passes on a freshly cloned template repo.
func _collect_violations() -> Array:
	var violations: Array = []
	for root in [CORE_ROOT, RPG_ROOT]:
		var gd_files: Array = _collect_gd_files(root)
		for rel_path in gd_files:
			var imports: PackedStringArray = _extract_res_imports(rel_path)
			var violation: Dictionary = _classify(rel_path, imports)
			if not violation.is_empty():
				violations.append(violation)
	return violations


## Depth-first walk over a `res://` root. Returns project-relative paths
## (still prefixed with `res://`) for every `.gd` file, or an empty list
## when the root does not exist.
func _collect_gd_files(root: String) -> Array:
	var results: Array = []
	if not DirAccess.dir_exists_absolute(ProjectSettings.globalize_path(root)):
		return results
	var stack: Array = [root]
	while stack.size() > 0:
		var current: String = stack.pop_back()
		var dir: DirAccess = DirAccess.open(current)
		if dir == null:
			continue
		dir.list_dir_begin()
		var entry_name: String = dir.get_next()
		while entry_name != "":
			if entry_name == "." or entry_name == "..":
				entry_name = dir.get_next()
				continue
			var entry_path: String = current + entry_name
			if dir.current_is_dir():
				stack.push_back(entry_path + "/")
			elif entry_name.ends_with(".gd"):
				results.append(entry_path)
			entry_name = dir.get_next()
		dir.list_dir_end()
	return results


## Extracts every `res://...` target referenced by `preload(...)`,
## `load(...)`, or `extends "..."`. The three regexes accept either
## single or double quotes to match the GDScript style used across the
## project. Duplicates are preserved only once.
func _extract_res_imports(file_path: String) -> PackedStringArray:
	var seen: PackedStringArray = PackedStringArray()
	var file: FileAccess = FileAccess.open(file_path, FileAccess.READ)
	if file == null:
		return seen
	var text: String = file.get_as_text()
	file.close()

	var patterns: Array = [
		"\\bpreload\\s*\\(\\s*[\"'](res://[^\"']+)[\"']\\s*\\)",
		"\\bload\\s*\\(\\s*[\"'](res://[^\"']+)[\"']\\s*\\)",
		"\\bextends\\s+[\"'](res://[^\"']+)[\"']",
	]
	for pattern in patterns:
		var regex: RegEx = RegEx.new()
		var status: int = regex.compile(pattern)
		if status != OK:
			continue
		for result in regex.search_all(text):
			var target: String = result.get_string(1)
			if not seen.has(target):
				seen.append(target)
	return seen


## Dispatches the per-file classification to the correct rule. Returns an
## empty dict when the file is clean.
func _classify(rel_path: String, imports: PackedStringArray) -> Dictionary:
	if rel_path.begins_with(CORE_ROOT):
		return _classify_core(rel_path, imports)
	if rel_path.begins_with(RPG_ROOT):
		return _classify_rpg(rel_path, imports)
	return {}


## Rule 1.2 — any import of `res://addons/forgekit_<other>/` from a file
## under `addons/forgekit_core/` is forbidden.
func _classify_core(rel_path: String, imports: PackedStringArray) -> Dictionary:
	var bad: Array = []
	for target in imports:
		if not target.begins_with(ADDONS_PREFIX):
			continue
		var after_addons: String = target.substr(ADDONS_PREFIX.length())
		if not after_addons.begins_with(FORGEKIT_MODULE_PREFIX):
			continue
		if target.begins_with(CORE_ROOT):
			continue
		bad.append(target)
	if bad.is_empty():
		return {}
	return {
		"file": rel_path,
		"imports": bad,
		"reason": "ForgeKit_Core files must not import from other forgekit_* modules (rule 1.2).",
	}


## Rule 1.3 — subsystems inside `addons/forgekit_rpg/` may only cross
## subsystem boundaries via `public_api.gd`; all other `forgekit_*`
## imports are forbidden outright.
func _classify_rpg(rel_path: String, imports: PackedStringArray) -> Dictionary:
	var segments: PackedStringArray = rel_path.split("/", false)
	# segments[0..1] = ["res:", "addons"], segments[2] = "forgekit_rpg",
	# segments[3] = subsystem when the file lives inside one.
	var subsystem: String = ""
	if segments.size() >= 5:
		subsystem = segments[3]

	var bad: Array = []
	var reason: String = ""
	for target in imports:
		if target.begins_with(CORE_ROOT):
			continue
		if target == RPG_PUBLIC_API:
			continue
		if target.begins_with(RPG_ROOT):
			if subsystem != "" and target.begins_with(RPG_ROOT + subsystem + "/"):
				continue
			bad.append(target)
			reason = "forgekit_rpg subsystems must reach other subsystems only through public_api.gd (rule 1.3)."
			continue
		if target.begins_with(ADDONS_PREFIX):
			var after_addons: String = target.substr(ADDONS_PREFIX.length())
			if after_addons.begins_with(FORGEKIT_MODULE_PREFIX):
				bad.append(target)
				reason = "files under addons/forgekit_rpg/ must not import from another forgekit_* module (rule 1.3)."
	if bad.is_empty():
		return {}
	return {
		"file": rel_path,
		"imports": bad,
		"reason": reason,
	}


## Pretty-prints a short list of violations for the assertion failure
## message. Keeping the payload compact means a real regression shows up
## directly in the GUT output without drowning the reader in per-file
## noise.
func _format_violations(violations: Array) -> String:
	if violations.is_empty():
		return "[]"
	var parts: Array = []
	for v in violations:
		parts.append("%s → %s (%s)" % [v["file"], v["imports"], v["reason"]])
	return "\n  - " + "\n  - ".join(parts)
