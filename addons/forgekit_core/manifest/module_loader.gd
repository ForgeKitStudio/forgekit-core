class_name ModuleLoader
extends Node
## Scans the `addons/` tree for ForgeKit modules, loads their manifests, and
## registers the ones compatible with the installed ForgeKit Core version.
##
## The loader is deliberately pull-based: callers (the MCP server, the editor
## plugin, tests) invoke `scan()` and receive a structured report. The loader
## never pushes errors for modules that simply are not installed — a missing
## `addons/forgekit_rpg/` directory or a placeholder-only install results in
## an empty report, so ForgeKit Core keeps starting even with zero modules.


## Emitted once per manifest that validates and satisfies `core_min_version`.
signal module_registered(id: StringName)

## Emitted when a manifest's validate() returns errors; `errors` is the array
## of English messages produced by `ModuleManifest.validate()`.
signal module_load_failed(id: StringName, errors: Array)

## Emitted when the manifest is valid but requires a higher ForgeKit Core
## version than the one currently installed. Carries both versions so clients
## can surface `{required, installed}` without re-reading the manifest.
signal core_version_mismatch(id: StringName, required: String, installed: String)


const _CORE_DIR_NAME: String = "forgekit_core"
const _MODULE_DIR_PREFIX: String = "forgekit_"
const _MANIFEST_FILE_NAME: String = "module.manifest.tres"
const _PLUGIN_CFG_PATH: String = "res://addons/forgekit_core/plugin.cfg"
const _FALLBACK_CORE_VERSION: String = "0.0.1"

var _registered_modules: Dictionary = {}


## Scans every `forgekit_*` directory under `addons_root` (except `forgekit_core`)
## for a `module.manifest.tres` file, validates it, and registers the modules
## that are compatible with `core_version`. `core_version` defaults to the
## version declared in the shipped `plugin.cfg` when left empty.
##
## Returns an ordered report of dictionaries `{path, id, status, ...}` where
## `status` is one of:
##   - "registered"             — manifest is valid and compatible;
##   - "load_failed"            — manifest.validate() returned errors (field `errors`);
##   - "core_version_mismatch"  — manifest is valid but core_min_version > installed (fields `required`, `installed`).
## Modules with status other than "registered" are not added to the internal registry.
func scan(addons_root: String = "res://addons/", core_version: String = "") -> Array:
	var report: Array = []
	var effective_core_version: String = core_version
	if effective_core_version.is_empty():
		effective_core_version = get_core_version()

	var root: String = addons_root
	if not root.ends_with("/"):
		root += "/"

	var module_dirs: Array[String] = _list_module_directories(root)
	for module_dir_name in module_dirs:
		var module_dir: String = root + module_dir_name + "/"
		var manifest_path: String = module_dir + _MANIFEST_FILE_NAME
		if not FileAccess.file_exists(manifest_path):
			# Placeholder or partially-installed modules are ignored silently so
			# ForgeKit Core starts cleanly even when only `.gitkeep` is present.
			continue
		report.append(_process_manifest(manifest_path, effective_core_version))

	return report


## Returns the list of successfully registered manifests in registration order.
func get_registered_modules() -> Array:
	var modules: Array = []
	for id in _registered_modules.keys():
		modules.append(_registered_modules[id])
	return modules


## Returns the registered manifest for `id`, or null when the module is
## unknown (never scanned, invalid, or incompatible).
func get_module(id: StringName) -> ModuleManifest:
	if _registered_modules.has(id):
		return _registered_modules[id]
	return null


## Reads the Core version from the shipped `plugin.cfg` so the loader stays in
## sync with the plugin metadata without duplicating the literal. Falls back
## to the documented initial release version when the file is unavailable
## (e.g. during tests that run from a stripped-down project).
static func get_core_version() -> String:
	var config: ConfigFile = ConfigFile.new()
	var err: int = config.load(_PLUGIN_CFG_PATH)
	if err != OK:
		return _FALLBACK_CORE_VERSION
	var value: Variant = config.get_value("plugin", "version", _FALLBACK_CORE_VERSION)
	return String(value)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

func _list_module_directories(addons_root: String) -> Array[String]:
	var result: Array[String] = []
	var dir: DirAccess = DirAccess.open(addons_root)
	if dir == null:
		return result
	dir.list_dir_begin()
	var entry_name: String = dir.get_next()
	while entry_name != "":
		if entry_name != "." and entry_name != "..":
			if dir.current_is_dir() and entry_name.begins_with(_MODULE_DIR_PREFIX) and entry_name != _CORE_DIR_NAME:
				result.append(entry_name)
		entry_name = dir.get_next()
	dir.list_dir_end()
	result.sort()
	return result


func _process_manifest(manifest_path: String, core_version: String) -> Dictionary:
	var resource: Resource = load(manifest_path)
	if not (resource is ModuleManifest):
		var errors: Array = ["manifest at %s is not a ModuleManifest resource" % manifest_path]
		module_load_failed.emit(StringName(""), errors)
		return {
			"path": manifest_path,
			"id": StringName(""),
			"status": "load_failed",
			"errors": errors,
		}

	var manifest: ModuleManifest = resource
	var validation_errors: Array[String] = manifest.validate()
	if validation_errors.size() > 0:
		var plain_errors: Array = []
		for message in validation_errors:
			plain_errors.append(message)
		module_load_failed.emit(manifest.id, plain_errors)
		return {
			"path": manifest_path,
			"id": manifest.id,
			"status": "load_failed",
			"errors": plain_errors,
		}

	if not manifest.is_compatible(core_version):
		push_warning(
			"CORE_VERSION_MISMATCH: module '%s' requires ForgeKit Core >= %s but %s is installed"
			% [String(manifest.id), manifest.core_min_version, core_version]
		)
		core_version_mismatch.emit(manifest.id, manifest.core_min_version, core_version)
		return {
			"path": manifest_path,
			"id": manifest.id,
			"status": "core_version_mismatch",
			"required": manifest.core_min_version,
			"installed": core_version,
		}

	_registered_modules[manifest.id] = manifest
	module_registered.emit(manifest.id)
	return {
		"path": manifest_path,
		"id": manifest.id,
		"status": "registered",
	}
