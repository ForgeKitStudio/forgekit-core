extends GutTest
## Unit tests for ModuleLoader: scans addons/forgekit_* directories, filters
## out forgekit_core and placeholder-only modules, emits core_version_mismatch
## for incompatible manifests, and registers valid manifests.


const MODULE_LOADER_SCRIPT: GDScript = preload("res://addons/forgekit_core/manifest/module_loader.gd")
const MODULE_MANIFEST_SCRIPT: GDScript = preload("res://addons/forgekit_core/manifest/module_manifest.gd")

const TMP_ADDONS_ROOT: String = "user://forgekit_core_test_modules/"


func _ensure_dir(path: String) -> void:
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(path))


func _remove_dir_recursive(path: String) -> void:
	var absolute: String = ProjectSettings.globalize_path(path)
	var dir: DirAccess = DirAccess.open(absolute)
	if dir == null:
		return
	dir.list_dir_begin()
	var entry_name: String = dir.get_next()
	while entry_name != "":
		var entry_path: String = path + entry_name
		if dir.current_is_dir():
			_remove_dir_recursive(entry_path + "/")
		else:
			dir.remove(entry_name)
		entry_name = dir.get_next()
	dir.list_dir_end()
	DirAccess.remove_absolute(absolute)


func _write_text(path: String, body: String) -> void:
	var file: FileAccess = FileAccess.open(path, FileAccess.WRITE)
	assert_not_null(file, "Should be able to open %s for writing" % path)
	file.store_string(body)
	file.close()


func _write_manifest(module_dir: String, manifest: ModuleManifest) -> String:
	_ensure_dir(module_dir)
	var path: String = module_dir + "module.manifest.tres"
	var result: int = ResourceSaver.save(manifest, path)
	assert_eq(result, OK, "Should be able to save a manifest .tres to %s" % path)
	return path


func _make_valid_manifest(id: StringName = &"forgekit_fake") -> ModuleManifest:
	var manifest: ModuleManifest = MODULE_MANIFEST_SCRIPT.new()
	manifest.id = id
	manifest.version = "0.1.0"
	manifest.core_min_version = "0.0.1"
	manifest.license_id = "fake-license"
	manifest.source_repo = "ForgeKitStudio/forgekit-fake"
	manifest.depends_on = []
	return manifest


func before_each() -> void:
	_remove_dir_recursive(TMP_ADDONS_ROOT)
	_ensure_dir(TMP_ADDONS_ROOT)


func after_each() -> void:
	_remove_dir_recursive(TMP_ADDONS_ROOT)


# ---------------------------------------------------------------------------
# scan()
# ---------------------------------------------------------------------------

func test_scan_empty_root_returns_empty_report() -> void:
	var loader: Node = MODULE_LOADER_SCRIPT.new()
	add_child_autofree(loader)

	var report: Array = loader.scan(TMP_ADDONS_ROOT, "1.0.0")

	assert_eq(report.size(), 0, "Scanning an empty addons root must return an empty report")
	assert_eq(loader.get_registered_modules().size(), 0, "No modules should be registered after an empty scan")


func test_scan_ignores_forgekit_core_directory() -> void:
	_ensure_dir(TMP_ADDONS_ROOT + "forgekit_core/")
	# Even if a manifest accidentally lived under forgekit_core/, it must be skipped.
	var manifest: ModuleManifest = _make_valid_manifest(&"forgekit_core")
	_write_manifest(TMP_ADDONS_ROOT + "forgekit_core/", manifest)

	var loader: Node = MODULE_LOADER_SCRIPT.new()
	add_child_autofree(loader)

	var report: Array = loader.scan(TMP_ADDONS_ROOT, "1.0.0")

	assert_eq(report.size(), 0, "forgekit_core/ must never be reported as a module")


func test_scan_ignores_non_forgekit_directories() -> void:
	_ensure_dir(TMP_ADDONS_ROOT + "gut/")
	_ensure_dir(TMP_ADDONS_ROOT + "some_third_party/")

	var loader: Node = MODULE_LOADER_SCRIPT.new()
	add_child_autofree(loader)

	var report: Array = loader.scan(TMP_ADDONS_ROOT, "1.0.0")

	assert_eq(report.size(), 0, "Directories that do not start with 'forgekit_' must be ignored")


func test_scan_skips_module_directory_without_manifest() -> void:
	# Simulates the shipped forgekit_rpg/ placeholder that contains only .gitkeep.
	_ensure_dir(TMP_ADDONS_ROOT + "forgekit_rpg/")
	_write_text(TMP_ADDONS_ROOT + "forgekit_rpg/.gitkeep", "placeholder")

	var loader: Node = MODULE_LOADER_SCRIPT.new()
	add_child_autofree(loader)

	var report: Array = loader.scan(TMP_ADDONS_ROOT, "1.0.0")

	assert_eq(report.size(), 0, "A forgekit_* directory without module.manifest.tres must be ignored silently")
	assert_eq(loader.get_registered_modules().size(), 0, "Placeholder directories must not register any module")


func test_scan_registers_valid_manifest() -> void:
	var manifest: ModuleManifest = _make_valid_manifest(&"forgekit_fake")
	_write_manifest(TMP_ADDONS_ROOT + "forgekit_fake/", manifest)

	var loader: Node = MODULE_LOADER_SCRIPT.new()
	add_child_autofree(loader)
	watch_signals(loader)

	var report: Array = loader.scan(TMP_ADDONS_ROOT, "1.0.0")

	assert_eq(report.size(), 1, "A valid manifest should produce exactly one report entry")
	if report.size() == 1:
		var entry: Dictionary = report[0]
		assert_eq(entry.get("status", ""), "registered", "Valid manifest must have status 'registered'")
		assert_eq(entry.get("id", &""), StringName("forgekit_fake"), "Report entry must echo the manifest id")
	assert_signal_emitted_with_parameters(loader, "module_registered", [StringName("forgekit_fake")])

	var registered: Array = loader.get_registered_modules()
	assert_eq(registered.size(), 1, "get_registered_modules must reflect the successful registration")
	if registered.size() == 1:
		assert_eq(registered[0].id, StringName("forgekit_fake"), "Registered manifest must preserve its id")

	var looked_up: ModuleManifest = loader.get_module(&"forgekit_fake")
	assert_not_null(looked_up, "get_module must return the registered manifest")
	if looked_up != null:
		assert_eq(looked_up.version, "0.1.0", "Registered manifest must preserve its version")


func test_scan_emits_core_version_mismatch_for_incompatible_manifest() -> void:
	var manifest: ModuleManifest = _make_valid_manifest(&"forgekit_future")
	manifest.core_min_version = "99.0.0"
	_write_manifest(TMP_ADDONS_ROOT + "forgekit_future/", manifest)

	var loader: Node = MODULE_LOADER_SCRIPT.new()
	add_child_autofree(loader)
	watch_signals(loader)

	var report: Array = loader.scan(TMP_ADDONS_ROOT, "1.0.0")

	assert_eq(report.size(), 1, "Incompatible manifest must still appear in the scan report")
	if report.size() == 1:
		var entry: Dictionary = report[0]
		assert_eq(entry.get("status", ""), "core_version_mismatch", "Incompatible manifest must have status 'core_version_mismatch'")
		assert_eq(entry.get("required", ""), "99.0.0", "Report entry must include the required core version")
		assert_eq(entry.get("installed", ""), "1.0.0", "Report entry must include the installed core version")
	assert_signal_emitted_with_parameters(
		loader,
		"core_version_mismatch",
		[StringName("forgekit_future"), "99.0.0", "1.0.0"]
	)
	assert_eq(loader.get_registered_modules().size(), 0, "An incompatible manifest must not be registered")
	assert_null(loader.get_module(&"forgekit_future"), "get_module must return null for incompatible modules")


func test_scan_reports_load_failed_for_invalid_manifest() -> void:
	var manifest: ModuleManifest = _make_valid_manifest(&"forgekit_broken")
	manifest.id = &""  # Empty id makes the manifest invalid.
	_write_manifest(TMP_ADDONS_ROOT + "forgekit_broken/", manifest)

	var loader: Node = MODULE_LOADER_SCRIPT.new()
	add_child_autofree(loader)
	watch_signals(loader)

	var report: Array = loader.scan(TMP_ADDONS_ROOT, "1.0.0")

	assert_eq(report.size(), 1, "Invalid manifest must still appear in the scan report")
	if report.size() == 1:
		var entry: Dictionary = report[0]
		assert_eq(entry.get("status", ""), "load_failed", "Invalid manifest must have status 'load_failed'")
		var errors: Variant = entry.get("errors", [])
		assert_true(errors is Array, "load_failed report must carry an errors array")
		assert_true((errors as Array).size() >= 1, "load_failed report must list at least one error")
	assert_signal_emitted(loader, "module_load_failed", "module_load_failed must fire for invalid manifests")
	assert_eq(loader.get_registered_modules().size(), 0, "An invalid manifest must not be registered")


# ---------------------------------------------------------------------------
# get_core_version()
# ---------------------------------------------------------------------------

func test_get_core_version_reads_plugin_cfg() -> void:
	var version: String = MODULE_LOADER_SCRIPT.get_core_version()
	# The shipped plugin.cfg declares version 0.0.1; the test asserts on the
	# SemVer shape rather than the literal value so the assertion survives
	# future bumps of plugin.cfg.
	assert_true(version.split(".").size() == 3, "get_core_version must return a MAJOR.MINOR.PATCH SemVer string; got '%s'" % version)
