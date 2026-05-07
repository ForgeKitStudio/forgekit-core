extends GutTest
## Feature: forgekit, Property 1: Round-trip for ItemResource
##
## For any valid ItemResource (any id, Unicode display_name, stack_size >= 1,
## optional icon), saving to a .tres file and then loading it back must return
## an object whose fields equal the original. Implemented with CoreFuzz.for_all
## with a minimum of 100 iterations.

const CoreFuzzScript: GDScript = preload("res://addons/forgekit_core/mcp/testing/core_fuzz.gd")
const ItemResourceScript: GDScript = preload("res://addons/forgekit_core/resources/item_resource.gd")

const ROUNDTRIP_PATH: String = "user://forgekit_pbt/item_roundtrip.tres"
const ROUNDTRIP_ITERATIONS: int = 100


func before_each() -> void:
	# Ensure the per-test scratch directory exists and is empty so that a
	# leftover file from a previous failing run cannot mask a regression.
	var dir: DirAccess = DirAccess.open("user://")
	if dir == null:
		dir = DirAccess.open(OS.get_user_data_dir())
	if dir != null and not dir.dir_exists("forgekit_pbt"):
		dir.make_dir("forgekit_pbt")
	if FileAccess.file_exists(ROUNDTRIP_PATH):
		DirAccess.remove_absolute(ProjectSettings.globalize_path(ROUNDTRIP_PATH))


func _save_and_reload(original: ItemResource) -> ItemResource:
	# Save the generated resource through Godot's native text serializer and
	# read it back so that Property 1 genuinely exercises the .tres format
	# (Requirement 3.3) rather than only the in-memory to_dict/from_dict path.
	var save_status: int = ResourceSaver.save(original, ROUNDTRIP_PATH)
	if save_status != OK:
		return null
	var loaded: Resource = ResourceLoader.load(ROUNDTRIP_PATH, "", ResourceLoader.CACHE_MODE_IGNORE)
	if loaded is ItemResource:
		return loaded
	return null


func _items_equal(a: ItemResource, b: ItemResource) -> bool:
	if a == null or b == null:
		return false
	if a.id != b.id:
		return false
	if a.display_name != b.display_name:
		return false
	if a.stack_size != b.stack_size:
		return false
	# Icons round-trip either as the same resource path or both as null. The
	# generator never assigns a concrete texture, so both sides must be null.
	if a.icon != b.icon:
		return false
	return true


func test_round_trip_for_item_resource() -> void:
	var failure_message: String = ""
	var predicate: Callable = func(original: ItemResource) -> bool:
		var restored: ItemResource = _save_and_reload(original)
		if restored == null:
			failure_message = "ItemResource failed to reload from %s" % ROUNDTRIP_PATH
			return false
		if not _items_equal(original, restored):
			failure_message = "Round-trip mismatch: original id=%s name=%s stack=%d vs restored id=%s name=%s stack=%d" % [
				String(original.id),
				original.display_name,
				original.stack_size,
				String(restored.id),
				restored.display_name,
				restored.stack_size,
			]
			return false
		return true

	var rng: RandomNumberGenerator = CoreFuzzScript.seeded(1)
	var generator: Callable = func() -> ItemResource:
		return CoreFuzzScript.random_item_resource(rng)

	var result: Dictionary = CoreFuzzScript.for_all(generator, predicate, ROUNDTRIP_ITERATIONS)

	var counterexample_description: String = "<none>"
	if not result["ok"]:
		# Describe the counterexample by its visible fields rather than forcing
		# a String() conversion on an ItemResource, which Godot does not define.
		var ce: ItemResource = result.get("counterexample") as ItemResource
		if ce != null:
			counterexample_description = "ItemResource(id=%s, display_name=%s, stack_size=%d)" % [
				String(ce.id),
				ce.display_name,
				ce.stack_size,
			]

	assert_true(
		result["ok"],
		"Property 1 (Round-trip for ItemResource) failed after %d iterations: %s | counterexample=%s" % [
			int(result.get("iterations", -1)),
			failure_message,
			counterexample_description,
		]
	)
	assert_gte(
		int(result.get("iterations", 0)),
		ROUNDTRIP_ITERATIONS,
		"CoreFuzz.for_all must execute at least %d iterations" % ROUNDTRIP_ITERATIONS
	)
