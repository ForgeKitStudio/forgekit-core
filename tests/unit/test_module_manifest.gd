extends GutTest
## Unit tests for ModuleManifest: validate() rules, is_compatible() SemVer
## comparison, and the to_dict/from_dict round-trip used by project.list_modules.


const MODULE_MANIFEST_SCRIPT: GDScript = preload("res://addons/forgekit_core/manifest/module_manifest.gd")


func _make_valid_manifest() -> ModuleManifest:
	var manifest: ModuleManifest = MODULE_MANIFEST_SCRIPT.new()
	manifest.id = &"forgekit_rpg"
	manifest.version = "0.1.0"
	manifest.core_min_version = "0.0.1"
	manifest.depends_on = []
	manifest.license_id = "forgekit_rpg"
	manifest.source_repo = "ForgeKitStudio/forgekit-rpg"
	return manifest


# ---------------------------------------------------------------------------
# validate()
# ---------------------------------------------------------------------------

func test_valid_manifest_has_no_errors() -> void:
	var manifest: ModuleManifest = _make_valid_manifest()
	var errors: Array[String] = manifest.validate()
	assert_eq(errors.size(), 0, "Valid manifest should produce no validation errors")


func test_empty_id_reports_error() -> void:
	var manifest: ModuleManifest = _make_valid_manifest()
	manifest.id = &""
	var errors: Array[String] = manifest.validate()
	assert_true(errors.size() >= 1, "Empty id should produce at least one error")
	var joined: String = "\n".join(errors)
	assert_true(joined.find("id") != -1, "Error message should mention the id field")


func test_invalid_version_reports_error() -> void:
	var manifest: ModuleManifest = _make_valid_manifest()
	manifest.version = "1.0"
	var errors: Array[String] = manifest.validate()
	assert_true(errors.size() >= 1, "Non-SemVer version should produce an error")
	var joined: String = "\n".join(errors)
	assert_true(joined.find("version") != -1, "Error message should mention the version field")


func test_invalid_core_min_version_reports_error() -> void:
	var manifest: ModuleManifest = _make_valid_manifest()
	manifest.core_min_version = "not-a-version"
	var errors: Array[String] = manifest.validate()
	assert_true(errors.size() >= 1, "Non-SemVer core_min_version should produce an error")
	var joined: String = "\n".join(errors)
	assert_true(joined.find("core_min_version") != -1, "Error message should mention the core_min_version field")


func test_empty_license_id_reports_error() -> void:
	var manifest: ModuleManifest = _make_valid_manifest()
	manifest.license_id = ""
	var errors: Array[String] = manifest.validate()
	assert_true(errors.size() >= 1, "Empty license_id should produce an error")
	var joined: String = "\n".join(errors)
	assert_true(joined.find("license_id") != -1, "Error message should mention the license_id field")


func test_invalid_source_repo_reports_error() -> void:
	var manifest: ModuleManifest = _make_valid_manifest()
	manifest.source_repo = "just-a-single-segment"
	var errors: Array[String] = manifest.validate()
	assert_true(errors.size() >= 1, "source_repo without org/repo shape should produce an error")
	var joined: String = "\n".join(errors)
	assert_true(joined.find("source_repo") != -1, "Error message should mention the source_repo field")


func test_empty_source_repo_is_allowed() -> void:
	# source_repo is documentation-only; an empty string means "not declared" and must not fail validation.
	var manifest: ModuleManifest = _make_valid_manifest()
	manifest.source_repo = ""
	var errors: Array[String] = manifest.validate()
	assert_eq(errors.size(), 0, "Empty source_repo should be treated as 'not declared' and pass validation")


# ---------------------------------------------------------------------------
# is_compatible()
# ---------------------------------------------------------------------------

func test_is_compatible_true_for_equal_versions() -> void:
	var manifest: ModuleManifest = _make_valid_manifest()
	manifest.core_min_version = "1.2.3"
	assert_true(manifest.is_compatible("1.2.3"), "Equal SemVer must be treated as compatible")


func test_is_compatible_true_when_installed_patch_is_higher() -> void:
	var manifest: ModuleManifest = _make_valid_manifest()
	manifest.core_min_version = "1.2.3"
	assert_true(manifest.is_compatible("1.2.4"), "Higher PATCH must satisfy core_min_version")


func test_is_compatible_true_when_installed_minor_is_higher() -> void:
	var manifest: ModuleManifest = _make_valid_manifest()
	manifest.core_min_version = "1.2.3"
	assert_true(manifest.is_compatible("1.3.0"), "Higher MINOR must satisfy core_min_version")


func test_is_compatible_true_when_installed_major_is_higher() -> void:
	var manifest: ModuleManifest = _make_valid_manifest()
	manifest.core_min_version = "1.2.3"
	assert_true(manifest.is_compatible("2.0.0"), "Higher MAJOR must satisfy core_min_version")


func test_is_compatible_false_when_installed_patch_is_lower() -> void:
	var manifest: ModuleManifest = _make_valid_manifest()
	manifest.core_min_version = "1.2.3"
	assert_false(manifest.is_compatible("1.2.2"), "Lower PATCH must fail compatibility check")


func test_is_compatible_false_when_installed_minor_is_lower() -> void:
	var manifest: ModuleManifest = _make_valid_manifest()
	manifest.core_min_version = "1.2.0"
	assert_false(manifest.is_compatible("1.1.9"), "Lower MINOR must fail compatibility check")


func test_is_compatible_false_when_installed_major_is_lower() -> void:
	var manifest: ModuleManifest = _make_valid_manifest()
	manifest.core_min_version = "2.0.0"
	assert_false(manifest.is_compatible("1.9.9"), "Lower MAJOR must fail compatibility check")


func test_is_compatible_false_for_invalid_installed_version() -> void:
	var manifest: ModuleManifest = _make_valid_manifest()
	manifest.core_min_version = "1.0.0"
	assert_false(manifest.is_compatible(""), "Empty installed version must not be considered compatible")
	assert_false(manifest.is_compatible("abc"), "Garbage installed version must not be considered compatible")


func test_is_compatible_false_for_invalid_core_min_version() -> void:
	var manifest: ModuleManifest = _make_valid_manifest()
	manifest.core_min_version = "nope"
	assert_false(manifest.is_compatible("1.0.0"), "Garbage core_min_version must not be considered compatible")


# ---------------------------------------------------------------------------
# to_dict / from_dict round-trip
# ---------------------------------------------------------------------------

func test_to_dict_from_dict_roundtrip_preserves_fields() -> void:
	var manifest: ModuleManifest = _make_valid_manifest()
	manifest.depends_on = [StringName("forgekit_core")]

	var data: Dictionary = manifest.to_dict()
	var restored: ModuleManifest = MODULE_MANIFEST_SCRIPT.from_dict(data)

	assert_eq(restored.id, manifest.id, "id must survive round-trip")
	assert_eq(restored.version, manifest.version, "version must survive round-trip")
	assert_eq(restored.core_min_version, manifest.core_min_version, "core_min_version must survive round-trip")
	assert_eq(restored.license_id, manifest.license_id, "license_id must survive round-trip")
	assert_eq(restored.source_repo, manifest.source_repo, "source_repo must survive round-trip")
	assert_eq(restored.depends_on.size(), 1, "depends_on length must survive round-trip")
	assert_eq(restored.depends_on[0], StringName("forgekit_core"), "depends_on entry must round-trip as StringName")


func test_from_dict_with_empty_dictionary_produces_safe_defaults() -> void:
	var restored: ModuleManifest = MODULE_MANIFEST_SCRIPT.from_dict({})
	assert_eq(String(restored.id), "", "Missing id must default to an empty StringName")
	assert_eq(restored.version, "", "Missing version must default to an empty String")
	assert_eq(restored.core_min_version, "", "Missing core_min_version must default to an empty String")
	assert_eq(restored.license_id, "", "Missing license_id must default to an empty String")
	assert_eq(restored.source_repo, "", "Missing source_repo must default to an empty String")
	assert_eq(restored.depends_on.size(), 0, "Missing depends_on must default to an empty array")
