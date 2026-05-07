extends GutTest
## Requires addons/gut/ — install via task 1.18
## Unit tests for RecipeResource: validation rules and to_dict/from_dict round-trip.


const RECIPE_RESOURCE_SCRIPT: GDScript = preload("res://addons/forgekit_core/resources/recipe_resource.gd")


func _make_valid_recipe() -> RecipeResource:
	var recipe: RecipeResource = RECIPE_RESOURCE_SCRIPT.new()
	recipe.id = &"iron_ingot"
	recipe.inputs = [{"item_id": &"iron_ore", "amount": 2}]
	recipe.outputs = [{"item_id": &"iron_ingot", "amount": 1}]
	recipe.duration_seconds = 1.5
	return recipe


func test_valid_recipe_has_no_errors() -> void:
	var recipe: RecipeResource = _make_valid_recipe()
	var errors: Array[String] = recipe.validate()
	assert_eq(errors.size(), 0, "Valid recipe should produce no validation errors")


func test_empty_id_reports_error() -> void:
	var recipe: RecipeResource = _make_valid_recipe()
	recipe.id = &""
	var errors: Array[String] = recipe.validate()
	assert_true(errors.size() >= 1, "Empty id should produce at least one error")
	var joined: String = "\n".join(errors)
	assert_true(joined.find("id") != -1, "Error message should mention the id field")


func test_empty_outputs_reports_error() -> void:
	var recipe: RecipeResource = _make_valid_recipe()
	recipe.outputs = []
	var errors: Array[String] = recipe.validate()
	assert_true(errors.size() >= 1, "Empty outputs should produce at least one error")
	var joined: String = "\n".join(errors)
	assert_true(joined.find("outputs") != -1, "Error message should mention the outputs field")


func test_malformed_input_entry_reports_error() -> void:
	var recipe: RecipeResource = _make_valid_recipe()
	# Missing the "amount" key.
	recipe.inputs = [{"item_id": &"iron_ore"}]
	var errors: Array[String] = recipe.validate()
	assert_true(errors.size() >= 1, "Malformed input entry should produce an error")
	var joined: String = "\n".join(errors)
	assert_true(joined.find("inputs[0]") != -1, "Error message should reference inputs[0]")


func test_input_entry_with_invalid_amount_reports_error() -> void:
	var recipe: RecipeResource = _make_valid_recipe()
	recipe.inputs = [
		{"item_id": &"coal", "amount": 1},
		{"item_id": &"iron_ore", "amount": 0},
	]
	var errors: Array[String] = recipe.validate()
	assert_true(errors.size() >= 1, "Zero amount should produce an error")
	var joined: String = "\n".join(errors)
	assert_true(joined.find("inputs[1]") != -1, "Error message should reference inputs[1]")
	assert_true(joined.find("amount") != -1, "Error message should mention amount")


func test_negative_duration_reports_error() -> void:
	var recipe: RecipeResource = _make_valid_recipe()
	recipe.duration_seconds = -0.5
	var errors: Array[String] = recipe.validate()
	assert_true(errors.size() >= 1, "Negative duration should produce an error")
	var joined: String = "\n".join(errors)
	assert_true(joined.find("duration_seconds") != -1, "Error message should mention duration_seconds")


func test_roundtrip_with_multiple_inputs_and_outputs() -> void:
	var recipe: RecipeResource = _make_valid_recipe()
	recipe.id = &"steel_ingot"
	recipe.inputs = [
		{"item_id": &"iron_ingot", "amount": 2},
		{"item_id": &"coal", "amount": 1},
	]
	recipe.outputs = [
		{"item_id": &"steel_ingot", "amount": 1},
		{"item_id": &"slag", "amount": 1},
	]
	recipe.duration_seconds = 3.25

	var data: Dictionary = recipe.to_dict()
	var restored: RecipeResource = RECIPE_RESOURCE_SCRIPT.from_dict(data)

	assert_eq(restored.id, recipe.id, "id should survive round-trip")
	assert_eq(restored.duration_seconds, recipe.duration_seconds, "duration_seconds should survive round-trip")
	assert_eq(restored.inputs.size(), recipe.inputs.size(), "inputs length should match")
	assert_eq(restored.outputs.size(), recipe.outputs.size(), "outputs length should match")
	for i in range(recipe.inputs.size()):
		assert_eq(restored.inputs[i]["item_id"], recipe.inputs[i]["item_id"], "input[%d].item_id should match" % i)
		assert_eq(restored.inputs[i]["amount"], recipe.inputs[i]["amount"], "input[%d].amount should match" % i)
	for i in range(recipe.outputs.size()):
		assert_eq(restored.outputs[i]["item_id"], recipe.outputs[i]["item_id"], "output[%d].item_id should match" % i)
		assert_eq(restored.outputs[i]["amount"], recipe.outputs[i]["amount"], "output[%d].amount should match" % i)


func test_roundtrip_preserves_entry_value_types() -> void:
	var recipe: RecipeResource = _make_valid_recipe()
	recipe.inputs = [{"item_id": &"coal", "amount": 3}]
	recipe.outputs = [{"item_id": &"ash", "amount": 1}]

	var data: Dictionary = recipe.to_dict()
	var restored: RecipeResource = RECIPE_RESOURCE_SCRIPT.from_dict(data)

	assert_eq(typeof(restored.inputs[0]["item_id"]), TYPE_STRING_NAME, "input item_id must remain a StringName after round-trip")
	assert_eq(typeof(restored.inputs[0]["amount"]), TYPE_INT, "input amount must remain an int after round-trip")
	assert_eq(typeof(restored.outputs[0]["item_id"]), TYPE_STRING_NAME, "output item_id must remain a StringName after round-trip")
	assert_eq(typeof(restored.outputs[0]["amount"]), TYPE_INT, "output amount must remain an int after round-trip")
	assert_eq(typeof(restored.id), TYPE_STRING_NAME, "recipe id must remain a StringName after round-trip")
	assert_eq(typeof(restored.duration_seconds), TYPE_FLOAT, "duration_seconds must remain a float after round-trip")


func test_to_dict_entry_keys_are_plain_strings() -> void:
	# Entry dictionaries must use plain String keys so downstream JSON serialization does not mutate them.
	var recipe: RecipeResource = _make_valid_recipe()
	var data: Dictionary = recipe.to_dict()

	for field in ["inputs", "outputs"]:
		var entries: Array = data[field]
		for entry in entries:
			for key in (entry as Dictionary).keys():
				assert_eq(typeof(key), TYPE_STRING, "%s entry key '%s' must be a plain String, not a StringName" % [field, String(key)])


func test_roundtrip_with_empty_inputs_for_pure_output_recipe() -> void:
	# Pure-output recipes (for example, debug-spawn recipes) must round-trip with an empty inputs array intact.
	var recipe: RecipeResource = _make_valid_recipe()
	recipe.id = &"debug_spawn"
	recipe.inputs = []
	recipe.outputs = [{"item_id": &"debug_item", "amount": 1}]

	var data: Dictionary = recipe.to_dict()
	var restored: RecipeResource = RECIPE_RESOURCE_SCRIPT.from_dict(data)

	assert_eq(restored.inputs.size(), 0, "Empty inputs array should round-trip as empty")
	assert_eq(restored.outputs.size(), 1, "outputs should round-trip unchanged")
	assert_eq(restored.outputs[0]["item_id"], &"debug_item", "output item_id should round-trip")
	assert_eq(restored.outputs[0]["amount"], 1, "output amount should round-trip")


func test_from_dict_skips_malformed_non_dictionary_entries() -> void:
	# from_dict must defensively skip entries that are not dictionaries rather than crashing.
	var restored: RecipeResource = RECIPE_RESOURCE_SCRIPT.from_dict({
		"id": "defensive",
		"duration_seconds": 0.0,
		"inputs": [42, {"item_id": "ok", "amount": 2}, "stray_string"],
		"outputs": [{"item_id": "result", "amount": 1}],
	})

	assert_eq(restored.inputs.size(), 1, "Only the valid dictionary entry should survive from_dict")
	assert_eq(restored.inputs[0]["item_id"], &"ok", "Surviving input should coerce item_id to StringName")
	assert_eq(restored.inputs[0]["amount"], 2, "Surviving input should preserve amount as int")


func test_from_dict_coerces_string_item_id_to_string_name() -> void:
	# A JSON payload will supply item_id as a plain String; from_dict must coerce it to StringName.
	var restored: RecipeResource = RECIPE_RESOURCE_SCRIPT.from_dict({
		"id": "json_payload",
		"duration_seconds": 1.0,
		"inputs": [{"item_id": "from_json_input", "amount": 1}],
		"outputs": [{"item_id": "from_json_output", "amount": 1}],
	})

	assert_eq(typeof(restored.inputs[0]["item_id"]), TYPE_STRING_NAME, "input item_id must be coerced from String to StringName")
	assert_eq(restored.inputs[0]["item_id"], &"from_json_input", "coerced item_id must compare equal to its StringName form")
	assert_eq(typeof(restored.outputs[0]["item_id"]), TYPE_STRING_NAME, "output item_id must be coerced from String to StringName")
