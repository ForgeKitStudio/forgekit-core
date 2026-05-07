extends GutTest
## Requires addons/gut/ — install via task 1.18
## Unit tests for TresLoader.load_validated: success, unknown-field and type-mismatch detection.


const TRES_LOADER_SCRIPT: GDScript = preload("res://addons/forgekit_core/resources/tres_loader.gd")

const TMP_DIR: String = "user://forgekit_core_test_tres/"


func before_each() -> void:
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(TMP_DIR))


func after_each() -> void:
	var abs: String = ProjectSettings.globalize_path(TMP_DIR)
	var dir: DirAccess = DirAccess.open(abs)
	if dir == null:
		return
	dir.list_dir_begin()
	var entry_name: String = dir.get_next()
	while entry_name != "":
		if not dir.current_is_dir():
			dir.remove(entry_name)
		entry_name = dir.get_next()
	dir.list_dir_end()


func _write_tres(filename: String, body: String) -> String:
	var path: String = TMP_DIR + filename
	var file: FileAccess = FileAccess.open(path, FileAccess.WRITE)
	assert_not_null(file, "Should be able to open %s for writing" % path)
	file.store_string(body)
	file.close()
	return path


func test_valid_item_tres_loads_ok() -> void:
	var body: String = """[gd_resource type="Resource" script_class="ItemResource" load_steps=2 format=3]

[ext_resource type="Script" path="res://addons/forgekit_core/resources/item_resource.gd" id="1"]

[resource]
script = ExtResource("1")
id = &"iron_ore"
display_name = "Iron Ore"
stack_size = 64
"""
	var path: String = _write_tres("valid_item.tres", body)

	var result: Dictionary = TRES_LOADER_SCRIPT.load_validated(path, "ItemResource")

	assert_true(result.get("ok", false), "Valid item .tres should load with ok = true")
	assert_true(result.has("resource"), "Result should contain the loaded resource")
	var res: ItemResource = result["resource"]
	assert_eq(res.id, &"iron_ore", "id should be loaded correctly")
	assert_eq(res.display_name, "Iron Ore", "display_name should be loaded correctly")
	assert_eq(res.stack_size, 64, "stack_size should be loaded correctly")


func test_unknown_field_is_reported() -> void:
	var body: String = """[gd_resource type="Resource" script_class="ItemResource" load_steps=2 format=3]

[ext_resource type="Script" path="res://addons/forgekit_core/resources/item_resource.gd" id="1"]

[resource]
script = ExtResource("1")
id = &"iron_ore"
display_name = "Iron Ore"
stack_size = 64
rarity = "legendary"
"""
	var path: String = _write_tres("unknown_field.tres", body)

	var result: Dictionary = TRES_LOADER_SCRIPT.load_validated(path, "ItemResource")

	assert_false(result.get("ok", true), "Tres with unknown field should fail validation")
	assert_true(result.has("errors"), "Result should contain errors array")
	var errors: Array = result["errors"]
	assert_true(errors.size() >= 1, "Should report at least one error")
	var found: bool = false
	for err in errors:
		if err.get("field", "") == "rarity":
			assert_eq(err.get("path", ""), path, "Error path should match loaded file")
			assert_eq(err.get("expected_type", ""), "<unknown>", "Unknown field should have expected_type = <unknown>")
			found = true
	assert_true(found, "Errors should include an entry for the unknown 'rarity' field")


func test_type_mismatch_is_reported() -> void:
	var body: String = """[gd_resource type="Resource" script_class="ItemResource" load_steps=2 format=3]

[ext_resource type="Script" path="res://addons/forgekit_core/resources/item_resource.gd" id="1"]

[resource]
script = ExtResource("1")
id = &"iron_ore"
display_name = "Iron Ore"
stack_size = "two"
"""
	var path: String = _write_tres("type_mismatch.tres", body)

	var result: Dictionary = TRES_LOADER_SCRIPT.load_validated(path, "ItemResource")

	assert_false(result.get("ok", true), "Tres with type mismatch should fail validation")
	var errors: Array = result["errors"]
	var found: bool = false
	for err in errors:
		if err.get("field", "") == "stack_size":
			assert_eq(err.get("path", ""), path, "Error path should match loaded file")
			assert_eq(err.get("expected_type", ""), "int", "stack_size mismatch should report expected_type = int")
			found = true
	assert_true(found, "Errors should include an entry for the stack_size type mismatch")
