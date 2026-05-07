extends GutTest
## Feature: forgekit, Property 2: Round-trip for RecipeResource
##
## For any valid RecipeResource (non-empty id, arbitrary inputs/outputs drawn
## from item_id: StringName and amount: int >= 1, duration_seconds >= 0),
## saving to a .tres file and then loading it back must return an object whose
## fields equal the original. Implemented with CoreFuzz.for_all with a minimum
## of 100 iterations.

const CoreFuzzScript: GDScript = preload("res://addons/forgekit_core/mcp/testing/core_fuzz.gd")
const RecipeResourceScript: GDScript = preload("res://addons/forgekit_core/resources/recipe_resource.gd")

const ROUNDTRIP_PATH: String = "user://forgekit_pbt/recipe_roundtrip.tres"
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


func _save_and_reload(original: RecipeResource) -> RecipeResource:
	# Save the generated resource through Godot's native text serializer and
	# read it back so that Property 2 genuinely exercises the .tres format
	# rather than only the in-memory to_dict/from_dict path.
	var save_status: int = ResourceSaver.save(original, ROUNDTRIP_PATH)
	if save_status != OK:
		return null
	var loaded: Resource = ResourceLoader.load(ROUNDTRIP_PATH, "", ResourceLoader.CACHE_MODE_IGNORE)
	if loaded is RecipeResource:
		return loaded
	return null


func _entries_equal(a: Array, b: Array) -> bool:
	if a.size() != b.size():
		return false
	for i in range(a.size()):
		var entry_a: Dictionary = a[i]
		var entry_b: Dictionary = b[i]
		# item_id must compare equal as StringName on both sides; a plain
		# String on either side indicates the round-trip lost the type tag.
		if StringName(entry_a.get("item_id", &"")) != StringName(entry_b.get("item_id", &"")):
			return false
		if int(entry_a.get("amount", -1)) != int(entry_b.get("amount", -2)):
			return false
	return true


func _recipes_equal(a: RecipeResource, b: RecipeResource) -> bool:
	if a == null or b == null:
		return false
	if a.id != b.id:
		return false
	# Compare durations with is_equal_approx so that a binary round-trip of
	# the float through .tres text format does not flag spurious diffs.
	if not is_equal_approx(a.duration_seconds, b.duration_seconds):
		return false
	if not _entries_equal(a.inputs, b.inputs):
		return false
	if not _entries_equal(a.outputs, b.outputs):
		return false
	return true


func _describe_entries(entries: Array) -> String:
	var parts: Array[String] = []
	for entry in entries:
		parts.append("{item_id=%s, amount=%d}" % [
			String(entry.get("item_id", &"")),
			int(entry.get("amount", 0)),
		])
	return "[" + ", ".join(parts) + "]"


func _describe_recipe(recipe: RecipeResource) -> String:
	if recipe == null:
		return "<null>"
	return "RecipeResource(id=%s, duration_seconds=%f, inputs=%s, outputs=%s)" % [
		String(recipe.id),
		recipe.duration_seconds,
		_describe_entries(recipe.inputs),
		_describe_entries(recipe.outputs),
	]


func test_round_trip_for_recipe_resource() -> void:
	var failure_message: String = ""
	var predicate: Callable = func(original: RecipeResource) -> bool:
		# Guard: the generator must only emit recipes that pass validate();
		# otherwise a round-trip "failure" could really be a generator bug.
		var validation_errors: Array[String] = original.validate()
		if validation_errors.size() > 0:
			failure_message = "Generator produced invalid recipe: %s | errors=%s" % [
				_describe_recipe(original),
				"; ".join(validation_errors),
			]
			return false
		var restored: RecipeResource = _save_and_reload(original)
		if restored == null:
			failure_message = "RecipeResource failed to reload from %s" % ROUNDTRIP_PATH
			return false
		if not _recipes_equal(original, restored):
			failure_message = "Round-trip mismatch: original=%s vs restored=%s" % [
				_describe_recipe(original),
				_describe_recipe(restored),
			]
			return false
		return true

	var rng: RandomNumberGenerator = CoreFuzzScript.seeded(2)
	var generator: Callable = func() -> RecipeResource:
		return CoreFuzzScript.random_recipe_resource(rng)

	var result: Dictionary = CoreFuzzScript.for_all(generator, predicate, ROUNDTRIP_ITERATIONS)

	var counterexample_description: String = "<none>"
	if not result["ok"]:
		var ce: RecipeResource = result.get("counterexample") as RecipeResource
		counterexample_description = _describe_recipe(ce)

	assert_true(
		result["ok"],
		"Property 2 (Round-trip for RecipeResource) failed after %d iterations: %s | counterexample=%s" % [
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
