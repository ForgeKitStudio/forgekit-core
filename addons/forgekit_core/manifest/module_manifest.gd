class_name ModuleManifest
extends Resource
## Manifest resource shipped alongside every ForgeKit module. Declares the
## module identity, its version, the minimum ForgeKit Core version required,
## dependencies on other modules, the license id gating activation, and the
## optional source repository for attribution.


## Stable module identifier; matches the addons/forgekit_<id>/ directory name.
@export var id: StringName = &""

## Module SemVer version (MAJOR.MINOR.PATCH).
@export var version: String = ""

## Minimum ForgeKit Core SemVer version required to load the module.
@export var core_min_version: String = ""

## Module ids this module depends on; the loader will refuse to register a
## module whose dependencies are missing. Kept as StringName to match id.
@export var depends_on: Array[StringName] = []

## License id gating activation; "MIT" for the free Core, anything else for
## paid modules (checked by the license activator).
@export var license_id: String = ""

## Optional source repository reference in "OrgName/repo-name" form.
@export var source_repo: String = ""


## Returns a list of English error messages; an empty array means the manifest is valid.
func validate() -> Array[String]:
	var errors: Array[String] = []
	if String(id).is_empty():
		errors.append("id must not be empty")
	if not _is_valid_semver(version):
		errors.append("version must be a valid SemVer (MAJOR.MINOR.PATCH); got '%s'" % version)
	if not _is_valid_semver(core_min_version):
		errors.append("core_min_version must be a valid SemVer (MAJOR.MINOR.PATCH); got '%s'" % core_min_version)
	if license_id.is_empty():
		errors.append("license_id must not be empty")
	if not source_repo.is_empty() and not _is_valid_source_repo(source_repo):
		errors.append("source_repo must follow the 'OrgName/repo-name' shape; got '%s'" % source_repo)
	return errors


## Returns true iff `core_version` satisfies `core_min_version` in SemVer order.
## Empty or malformed inputs always yield false.
func is_compatible(core_version: String) -> bool:
	var installed: Array = _parse_semver(core_version)
	var required: Array = _parse_semver(core_min_version)
	if installed.is_empty() or required.is_empty():
		return false
	return _compare_semver(installed, required) >= 0


## Serializes this manifest to a plain dictionary; pairs with from_dict for round-trip.
func to_dict() -> Dictionary:
	var depends: Array = []
	for entry in depends_on:
		depends.append(String(entry))
	return {
		"id": String(id),
		"version": version,
		"core_min_version": core_min_version,
		"depends_on": depends,
		"license_id": license_id,
		"source_repo": source_repo,
	}


## Rebuilds a ModuleManifest from a dictionary produced by to_dict.
static func from_dict(data: Dictionary) -> ModuleManifest:
	var manifest: ModuleManifest = ModuleManifest.new()
	manifest.id = StringName(data.get("id", &""))
	manifest.version = String(data.get("version", ""))
	manifest.core_min_version = String(data.get("core_min_version", ""))
	manifest.license_id = String(data.get("license_id", ""))
	manifest.source_repo = String(data.get("source_repo", ""))
	var raw_deps: Variant = data.get("depends_on", [])
	var deps: Array[StringName] = []
	if raw_deps is Array:
		for entry in raw_deps:
			deps.append(StringName(entry))
	manifest.depends_on = deps
	return manifest


# ---------------------------------------------------------------------------
# SemVer helpers
# ---------------------------------------------------------------------------

## Returns [major, minor, patch] as ints when `value` is a valid SemVer triple,
## or an empty Array when the value is missing or malformed.
static func _parse_semver(value: String) -> Array:
	if value.is_empty():
		return []
	var parts: PackedStringArray = value.split(".", false)
	if parts.size() != 3:
		return []
	var numbers: Array = []
	for part in parts:
		if not _is_non_negative_integer(part):
			return []
		numbers.append(int(part))
	return numbers


## Compares two SemVer triples produced by `_parse_semver`.
## Returns -1 when `a < b`, 0 when equal, 1 when `a > b`.
static func _compare_semver(a: Array, b: Array) -> int:
	for i in range(3):
		if int(a[i]) < int(b[i]):
			return -1
		if int(a[i]) > int(b[i]):
			return 1
	return 0


static func _is_valid_semver(value: String) -> bool:
	return not _parse_semver(value).is_empty()


static func _is_non_negative_integer(value: String) -> bool:
	if value.is_empty():
		return false
	for c in value:
		if c < "0" or c > "9":
			return false
	return true


## Matches the documented "OrgName/repo-name" shape: exactly one slash,
## both sides non-empty and free of whitespace.
static func _is_valid_source_repo(value: String) -> bool:
	var parts: PackedStringArray = value.split("/", false)
	if parts.size() != 2:
		return false
	for part in parts:
		if part.is_empty():
			return false
		if part.contains(" ") or part.contains("\t"):
			return false
	return true
