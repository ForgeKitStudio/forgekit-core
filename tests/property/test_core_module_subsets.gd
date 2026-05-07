extends GutTest
## Feature: forgekit, Property 8: ForgeKit_Core starts without errors for any subset of installed modules
##
## For every subset M of a hypothetical module universe, writing one valid
## module.manifest.tres per id in M under a scratch addons/ directory and then
## invoking ModuleLoader.scan() must:
##   - not emit any push_error or push_warning,
##   - return a report whose entries all have status = "registered",
##   - register exactly the ids contained in M (no ghosts, no drops).
## The empty subset case asserts Core initialises cleanly when no modules are
## installed at all, which is the direct requirement covered by this property.
## CoreFuzz.for_all drives at least 100 iterations across randomly-sized
## subsets of a universe of three hypothetical ids so the property exercises
## real "any subset" behaviour and not just today's single-module reality.

const CoreFuzzScript: GDScript = preload("res://addons/forgekit_core/mcp/testing/core_fuzz.gd")
const MODULE_LOADER_SCRIPT: GDScript = preload("res://addons/forgekit_core/manifest/module_loader.gd")
const MODULE_MANIFEST_SCRIPT: GDScript = preload("res://addons/forgekit_core/manifest/module_manifest.gd")

const SCRATCH_ADDONS_ROOT: String = "user://forgekit_pbt/core_module_subsets/addons/"
const CORE_VERSION_FOR_TEST: String = "1.0.0"
const ITERATIONS: int = 100

## Hypothetical universe of module ids. Today only "forgekit_rpg" is real;
## the two extra ids model the future ForgeKit module catalogue so the subset
## property is exercised against 2^3 = 8 possible configurations rather than
## the trivial 2^1 = 2 a single-module universe would allow.
const UNIVERSE: Array = [
	"forgekit_rpg",
	"forgekit_survivors",
	"forgekit_roguelike",
]


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


func before_each() -> void:
	_remove_dir_recursive(SCRATCH_ADDONS_ROOT)
	_ensure_dir(SCRATCH_ADDONS_ROOT)


func after_each() -> void:
	_remove_dir_recursive(SCRATCH_ADDONS_ROOT)


## Writes one valid module.manifest.tres per id under SCRATCH_ADDONS_ROOT.
## Returns the list of ids that were actually written so the predicate can
## diff against ModuleLoader's report without relying on directory ordering.
func _write_subset(subset: Array) -> Array:
	var written: Array = []
	for id in subset:
		var module_dir: String = SCRATCH_ADDONS_ROOT + String(id) + "/"
		_ensure_dir(module_dir)
		var manifest: ModuleManifest = MODULE_MANIFEST_SCRIPT.new()
		manifest.id = StringName(id)
		manifest.version = "0.1.0"
		manifest.core_min_version = "0.0.1"
		manifest.license_id = "%s-license" % String(id)
		manifest.source_repo = "ForgeKitStudio/%s" % String(id).replace("_", "-")
		manifest.depends_on = []
		var save_status: int = ResourceSaver.save(manifest, module_dir + "module.manifest.tres")
		if save_status != OK:
			return []
		written.append(String(id))
	written.sort()
	return written


## Generates a random subset of UNIVERSE. Each id is independently kept with
## probability 0.5 so every possible subset (including the empty one) has a
## non-zero probability of being sampled. The ids are shuffled so the test
## also covers random insertion orders on disk.
func _random_subset(rng: RandomNumberGenerator) -> Array:
	var shuffled: Array = UNIVERSE.duplicate()
	for i in range(shuffled.size() - 1, 0, -1):
		var j: int = rng.randi_range(0, i)
		var tmp: Variant = shuffled[i]
		shuffled[i] = shuffled[j]
		shuffled[j] = tmp
	var subset: Array = []
	for id in shuffled:
		if rng.randi_range(0, 1) == 1:
			subset.append(id)
	return subset


func _sorted_registered_ids(loader: Node) -> Array:
	var ids: Array = []
	for manifest in loader.get_registered_modules():
		ids.append(String(manifest.id))
	ids.sort()
	return ids


func _count_new_push_messages(errors_before: int, errors_after: Array) -> Dictionary:
	var push_errors: int = 0
	var push_warnings: int = 0
	for i in range(errors_before, errors_after.size()):
		var err: GutTrackedError = errors_after[i]
		if err.is_push_error():
			push_errors += 1
			err.handled = true
		elif err.is_push_warning():
			push_warnings += 1
			err.handled = true
	return {"push_errors": push_errors, "push_warnings": push_warnings}


func test_core_starts_cleanly_for_any_subset_of_installed_modules() -> void:
	# failure_message is wrapped in a single-element Array so the lambda
	# predicate below can mutate it through the reference and the outer
	# scope can read the diagnostic text that explains a counterexample.
	# A plain String would be captured by value and the assertion message
	# would lose the explanation.
	var failure_message: Array = [""]
	var rng: RandomNumberGenerator = CoreFuzzScript.seeded(8)

	var generator: Callable = func() -> Array:
		return _random_subset(rng)

	var predicate: Callable = func(subset: Array) -> bool:
		# Each iteration starts from an empty scratch directory so leftover
		# manifests from the previous subset cannot mask a regression.
		_remove_dir_recursive(SCRATCH_ADDONS_ROOT)
		_ensure_dir(SCRATCH_ADDONS_ROOT)

		var expected_ids: Array = _write_subset(subset)
		if expected_ids.size() != subset.size():
			failure_message[0] = "Failed to write manifests for subset %s" % str(subset)
			return false

		var loader: Node = MODULE_LOADER_SCRIPT.new()
		add_child_autofree(loader)

		var errors_before: int = get_errors().size()
		var report: Array = loader.scan(SCRATCH_ADDONS_ROOT, CORE_VERSION_FOR_TEST)
		var errors_after: Array = get_errors()
		var counts: Dictionary = _count_new_push_messages(errors_before, errors_after)

		if int(counts["push_errors"]) != 0:
			failure_message[0] = (
				"Scan for subset %s produced %d push_error(s) about missing or invalid modules"
				% [str(subset), int(counts["push_errors"])]
			)
			return false
		if int(counts["push_warnings"]) != 0:
			failure_message[0] = (
				"Scan for subset %s produced %d push_warning(s) about missing or invalid modules"
				% [str(subset), int(counts["push_warnings"])]
			)
			return false

		if report.size() != expected_ids.size():
			failure_message[0] = (
				"Report size mismatch for subset %s: got %d entries, expected %d"
				% [str(subset), report.size(), expected_ids.size()]
			)
			return false

		for entry in report:
			var status: String = String(entry.get("status", ""))
			if status != "registered":
				failure_message[0] = (
					"Non-registered status '%s' for subset %s: entry=%s"
					% [status, str(subset), str(entry)]
				)
				return false

		var registered_ids: Array = _sorted_registered_ids(loader)
		if registered_ids != expected_ids:
			failure_message[0] = (
				"Registered ids %s differ from expected subset %s"
				% [str(registered_ids), str(expected_ids)]
			)
			return false

		return true

	var result: Dictionary = CoreFuzzScript.for_all(generator, predicate, ITERATIONS)

	assert_true(
		bool(result["ok"]),
		"Property 8 (ForgeKit Core starts cleanly for any module subset) failed after %d iterations: %s | counterexample=%s" % [
			int(result.get("iterations", -1)),
			String(failure_message[0]),
			str(result.get("counterexample")),
		]
	)
	assert_gte(
		int(result.get("iterations", 0)),
		ITERATIONS,
		"CoreFuzz.for_all must execute at least %d iterations" % ITERATIONS
	)


func test_core_initialises_cleanly_with_empty_module_set() -> void:
	# Directly covers the empty-subset case: when no modules are installed,
	# ModuleLoader.scan() must produce no report entries, no registered
	# modules, and neither push_error nor push_warning.
	var loader: Node = MODULE_LOADER_SCRIPT.new()
	add_child_autofree(loader)

	var errors_before: int = get_errors().size()
	var report: Array = loader.scan(SCRATCH_ADDONS_ROOT, CORE_VERSION_FOR_TEST)
	var counts: Dictionary = _count_new_push_messages(errors_before, get_errors())

	assert_eq(report.size(), 0, "Empty addons root must produce an empty report")
	assert_eq(loader.get_registered_modules().size(), 0, "Empty addons root must not register any module")
	assert_eq(int(counts["push_errors"]), 0, "Empty subset must not emit any push_error")
	assert_eq(int(counts["push_warnings"]), 0, "Empty subset must not emit any push_warning")
