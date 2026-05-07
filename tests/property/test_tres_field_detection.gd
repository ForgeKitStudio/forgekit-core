extends GutTest
## Feature: forgekit, Property 4: Detection of unknown fields and type mismatches in .tres
##
## Start from a freshly generated ItemResource or RecipeResource and serialize
## it through Godot's text resource writer so the input is a .tres the loader
## would accept. Then inject exactly one random mutation:
##   - an unknown top-level field inside [resource], or
##   - a type-incompatible literal for one of the existing schema fields.
## TresLoader.load_validated must return ok = false with an error whose fields
## match {path, field, expected_type} for the mutated field. Executes at least
## 100 iterations through CoreFuzz.for_all.

const CoreFuzzScript: GDScript = preload("res://addons/forgekit_core/mcp/testing/core_fuzz.gd")
const TresLoaderScript: GDScript = preload("res://addons/forgekit_core/resources/tres_loader.gd")

const TMP_DIR: String = "user://forgekit_pbt/"
const MUTATION_PATH: String = "user://forgekit_pbt/tres_field_detection.tres"
const MUTATION_ITERATIONS: int = 100


func before_each() -> void:
	# Recreate the scratch directory and clear any leftover file so a prior
	# failing run cannot mask a regression in the current run.
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(TMP_DIR))
	if FileAccess.file_exists(MUTATION_PATH):
		DirAccess.remove_absolute(ProjectSettings.globalize_path(MUTATION_PATH))


func _read_text(path: String) -> String:
	var file: FileAccess = FileAccess.open(path, FileAccess.READ)
	if file == null:
		return ""
	var text: String = file.get_as_text()
	file.close()
	return text


func _write_text(path: String, text: String) -> bool:
	var file: FileAccess = FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		return false
	file.store_string(text)
	file.close()
	return true


## Replaces the value literal for `field` in a .tres body. Anchors to the
## start of a line so the regex cannot accidentally match text inside a
## quoted string value. Returns the rewritten text and a flag indicating
## whether the field was found.
func _replace_field_literal(text: String, field: String, new_literal: String) -> Dictionary:
	var lines: PackedStringArray = text.split("\n")
	var regex: RegEx = RegEx.new()
	regex.compile("^" + field + "\\s*=\\s*.*$")
	var replaced: bool = false
	for i in range(lines.size()):
		if regex.search(lines[i]) != null:
			lines[i] = "%s = %s" % [field, new_literal]
			replaced = true
			break
	return {"text": "\n".join(lines), "replaced": replaced}


## Inserts `name = literal` immediately after the [resource] header so the
## injected key lands inside the resource scope rather than inside an
## ext_resource or sub_resource section.
func _inject_field_line(text: String, name: String, literal: String) -> String:
	var header: String = "[resource]"
	var header_index: int = text.find(header)
	if header_index < 0:
		return text
	var after_header: int = header_index + header.length()
	var newline_index: int = text.find("\n", after_header)
	if newline_index < 0:
		return text + "\n%s = %s\n" % [name, literal]
	return text.substr(0, newline_index + 1) + "%s = %s\n" % [name, literal] + text.substr(newline_index + 1)


## Builds a mutation plan: the base resource, its expected class, and a
## description of the mutation together with the error the loader must emit.
## Combining both resource types and both mutation kinds in a single plan lets
## one CoreFuzz run exercise the full matrix uniformly.
func _make_plan(rng: RandomNumberGenerator) -> Dictionary:
	var resource_choice: int = rng.randi_range(0, 1)
	var mutation_choice: int = rng.randi_range(0, 1)

	if resource_choice == 0:
		var item: ItemResource = CoreFuzzScript.random_item_resource(rng)
		var plan: Dictionary = {
			"resource": item,
			"expected_class": "ItemResource",
		}
		if mutation_choice == 0:
			# Field names prefixed with "unk_" are guaranteed not to collide with
			# the ItemResource schema (id, display_name, icon, stack_size) or with
			# the .tres system keys enumerated in TresLoader._SYSTEM_KEYS.
			var unknown_suffix: String = CoreFuzzScript.random_string(rng, rng.randi_range(3, 10))
			plan["mutation_kind"] = "unknown_field"
			plan["field"] = "unk_" + unknown_suffix
			plan["literal"] = "\"x\""
			plan["expected_type"] = "<unknown>"
		else:
			# Each mutation picks a literal whose inferred type is genuinely
			# incompatible with the schema: strings are not ints, ints are not
			# strings, and bools are not StringNames. The tres_loader coerces
			# float from int and StringName from String, so those pairings are
			# deliberately avoided to prevent false negatives.
			var item_mutations: Array = [
				{"field": "stack_size", "literal": "\"not_a_number\"", "expected_type": "int"},
				{"field": "display_name", "literal": "42", "expected_type": "String"},
				{"field": "id", "literal": "false", "expected_type": "StringName"},
			]
			var chosen: Dictionary = item_mutations[rng.randi_range(0, item_mutations.size() - 1)]
			plan["mutation_kind"] = "type_mismatch"
			plan["field"] = String(chosen["field"])
			plan["literal"] = String(chosen["literal"])
			plan["expected_type"] = String(chosen["expected_type"])
		return plan

	var recipe: RecipeResource = CoreFuzzScript.random_recipe_resource(rng)
	var recipe_plan: Dictionary = {
		"resource": recipe,
		"expected_class": "RecipeResource",
	}
	if mutation_choice == 0:
		var unknown_suffix_recipe: String = CoreFuzzScript.random_string(rng, rng.randi_range(3, 10))
		recipe_plan["mutation_kind"] = "unknown_field"
		recipe_plan["field"] = "unk_" + unknown_suffix_recipe
		recipe_plan["literal"] = "\"x\""
		recipe_plan["expected_type"] = "<unknown>"
	else:
		# duration_seconds is a float; a bare string literal is incompatible in
		# both directions (float does not coerce from String). id is StringName;
		# an int literal is incompatible (int is not a string-like type).
		var recipe_mutations: Array = [
			{"field": "id", "literal": "123", "expected_type": "StringName"},
			{"field": "duration_seconds", "literal": "\"fast\"", "expected_type": "float"},
		]
		var chosen_recipe: Dictionary = recipe_mutations[rng.randi_range(0, recipe_mutations.size() - 1)]
		recipe_plan["mutation_kind"] = "type_mismatch"
		recipe_plan["field"] = String(chosen_recipe["field"])
		recipe_plan["literal"] = String(chosen_recipe["literal"])
		recipe_plan["expected_type"] = String(chosen_recipe["expected_type"])
	return recipe_plan


func _describe_plan(plan: Dictionary) -> String:
	return "plan(class=%s, kind=%s, field=%s, literal=%s, expected_type=%s)" % [
		str(plan.get("expected_class", "?")),
		str(plan.get("mutation_kind", "?")),
		str(plan.get("field", "?")),
		str(plan.get("literal", "?")),
		str(plan.get("expected_type", "?")),
	]


func test_property_4_detects_unknown_fields_and_type_mismatches() -> void:
	var failure_message: String = ""
	var rng: RandomNumberGenerator = CoreFuzzScript.seeded(4)

	var generator: Callable = func() -> Dictionary:
		return _make_plan(rng)

	var predicate: Callable = func(plan: Dictionary) -> bool:
		# Step 1: write the untouched resource so the starting .tres is one
		# the loader would otherwise accept.
		var save_status: int = ResourceSaver.save(plan["resource"], MUTATION_PATH)
		if save_status != OK:
			failure_message = "ResourceSaver.save failed for %s" % _describe_plan(plan)
			return false

		var original_text: String = _read_text(MUTATION_PATH)
		if original_text.is_empty():
			failure_message = "Saved .tres was empty for %s" % _describe_plan(plan)
			return false

		# Step 2: apply one mutation. For type mismatches where the field was
		# unexpectedly absent from the serialized output (possible if Godot
		# ever elides a default-valued export), skip the iteration rather
		# than report a spurious failure; the property still holds vacuously.
		var mutated_text: String = ""
		if String(plan["mutation_kind"]) == "unknown_field":
			mutated_text = _inject_field_line(original_text, String(plan["field"]), String(plan["literal"]))
		else:
			var replace_result: Dictionary = _replace_field_literal(original_text, String(plan["field"]), String(plan["literal"]))
			if not bool(replace_result["replaced"]):
				return true
			mutated_text = String(replace_result["text"])

		if not _write_text(MUTATION_PATH, mutated_text):
			failure_message = "Failed to write mutated text for %s" % _describe_plan(plan)
			return false

		# Step 3: assert the validator detects the mutation with the exact
		# error schema required by the property.
		var result: Dictionary = TresLoaderScript.load_validated(MUTATION_PATH, String(plan["expected_class"]))
		if bool(result.get("ok", true)):
			failure_message = "Expected validation failure but loader returned ok=true for %s" % _describe_plan(plan)
			return false

		var errors: Array = result.get("errors", [])
		if errors.is_empty():
			failure_message = "Validation reported ok=false but errors array was empty for %s" % _describe_plan(plan)
			return false

		for err in errors:
			if String(err.get("field", "")) != String(plan["field"]):
				continue
			if String(err.get("path", "")) != MUTATION_PATH:
				failure_message = "Error path mismatch: got %s, expected %s (%s)" % [
					str(err.get("path", "")),
					MUTATION_PATH,
					_describe_plan(plan),
				]
				return false
			if String(err.get("expected_type", "")) != String(plan["expected_type"]):
				failure_message = "Error expected_type mismatch: got %s, expected %s (%s)" % [
					str(err.get("expected_type", "")),
					str(plan["expected_type"]),
					_describe_plan(plan),
				]
				return false
			return true

		failure_message = "No error entry for mutated field in %s; errors=%s" % [
			_describe_plan(plan),
			str(errors),
		]
		return false

	var result: Dictionary = CoreFuzzScript.for_all(generator, predicate, MUTATION_ITERATIONS)

	var counterexample_description: String = "<none>"
	if not bool(result["ok"]):
		var counterexample: Variant = result.get("counterexample", null)
		if counterexample is Dictionary:
			counterexample_description = _describe_plan(counterexample)

	assert_true(
		bool(result["ok"]),
		"Property 4 (Detection of unknown fields and type mismatches in .tres) failed after %d iterations: %s | counterexample=%s" % [
			int(result.get("iterations", -1)),
			failure_message,
			counterexample_description,
		]
	)
	assert_gte(
		int(result.get("iterations", 0)),
		MUTATION_ITERATIONS,
		"CoreFuzz.for_all must execute at least %d iterations" % MUTATION_ITERATIONS
	)
