extends GutTest
## Smoke test that locks in the directory layout under
## `addons/forgekit_core/`. Every subsystem documented in the design must
## have its own top-level folder so that clients and tooling can rely on a
## predictable structure when resolving `res://addons/forgekit_core/<dir>/`
## paths.


const CORE_ROOT: String = "res://addons/forgekit_core/"

## Resolves `res://` to an absolute filesystem path and returns `true` when
## the directory exists on disk. We deliberately avoid `DirAccess.open`
## because it treats a missing directory as a non-fatal `null` return and
## would hide a layout regression behind a warning log.
func _core_dir_exists(subdir: String) -> bool:
	var absolute: String = ProjectSettings.globalize_path(CORE_ROOT + subdir)
	return DirAccess.dir_exists_absolute(absolute)


func test_forgekit_core_root_exists() -> void:
	assert_true(
		DirAccess.dir_exists_absolute(ProjectSettings.globalize_path(CORE_ROOT)),
		"addons/forgekit_core/ must exist — ForgeKit Core is the template's entry point"
	)


func test_event_bus_directory_exists() -> void:
	assert_true(
		_core_dir_exists("event_bus"),
		"addons/forgekit_core/event_bus/ must exist (hosts game_events.gd autoload)"
	)


func test_resources_directory_exists() -> void:
	assert_true(
		_core_dir_exists("resources"),
		"addons/forgekit_core/resources/ must exist (ItemResource, RecipeResource, TresLoader)"
	)


func test_manifest_directory_exists() -> void:
	assert_true(
		_core_dir_exists("manifest"),
		"addons/forgekit_core/manifest/ must exist (ModuleManifest + ModuleLoader)"
	)


func test_mcp_directory_exists() -> void:
	assert_true(
		_core_dir_exists("mcp"),
		"addons/forgekit_core/mcp/ must exist (editor_plugin, runtime_bridge, licensing)"
	)


func test_boundary_directory_exists() -> void:
	assert_true(
		_core_dir_exists("boundary"),
		"addons/forgekit_core/boundary/ must exist (CoreBoundary static helper)"
	)
