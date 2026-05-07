extends GutTest
## Requires addons/gut/ — install via task 1.18
## Unit tests for ItemResource: validation rules and to_dict/from_dict round-trip.


const ITEM_RESOURCE_SCRIPT: GDScript = preload("res://addons/forgekit_core/resources/item_resource.gd")


func _make_valid_item() -> ItemResource:
	var item: ItemResource = ITEM_RESOURCE_SCRIPT.new()
	item.id = &"iron_ore"
	item.display_name = "Iron Ore"
	item.icon = null
	item.stack_size = 64
	return item


func test_valid_item_has_no_errors() -> void:
	var item: ItemResource = _make_valid_item()
	var errors: Array[String] = item.validate()
	assert_eq(errors.size(), 0, "Valid item should produce no validation errors")


func test_empty_id_reports_error() -> void:
	var item: ItemResource = _make_valid_item()
	item.id = &""
	var errors: Array[String] = item.validate()
	assert_true(errors.size() >= 1, "Empty id should produce at least one error")
	var joined: String = "\n".join(errors)
	assert_true(joined.find("id") != -1, "Error message should mention the id field")


func test_empty_display_name_reports_error() -> void:
	var item: ItemResource = _make_valid_item()
	item.display_name = ""
	var errors: Array[String] = item.validate()
	assert_true(errors.size() >= 1, "Empty display_name should produce at least one error")
	var joined: String = "\n".join(errors)
	assert_true(joined.find("display_name") != -1, "Error message should mention the display_name field")


func test_stack_size_zero_reports_error() -> void:
	var item: ItemResource = _make_valid_item()
	item.stack_size = 0
	var errors: Array[String] = item.validate()
	assert_true(errors.size() >= 1, "stack_size = 0 should produce an error")
	var joined: String = "\n".join(errors)
	assert_true(joined.find("stack_size") != -1, "Error message should mention the stack_size field")


func test_stack_size_negative_reports_error() -> void:
	var item: ItemResource = _make_valid_item()
	item.stack_size = -1
	var errors: Array[String] = item.validate()
	assert_true(errors.size() >= 1, "Negative stack_size should produce an error")
	var joined: String = "\n".join(errors)
	assert_true(joined.find("stack_size") != -1, "Error message should mention the stack_size field")


func test_roundtrip_with_unicode_display_name() -> void:
	var item: ItemResource = _make_valid_item()
	item.id = &"unicode_item"
	item.display_name = "Héroïque Iron Ore \u2694 \u5263"
	item.stack_size = 32

	var data: Dictionary = item.to_dict()
	var restored: ItemResource = ITEM_RESOURCE_SCRIPT.from_dict(data)

	assert_eq(restored.id, item.id, "id should survive round-trip")
	assert_eq(restored.display_name, item.display_name, "Unicode display_name should survive round-trip")
	assert_eq(restored.stack_size, item.stack_size, "stack_size should survive round-trip")
	assert_eq(restored.icon, item.icon, "icon should survive round-trip (null)")


func test_roundtrip_with_null_icon() -> void:
	var item: ItemResource = _make_valid_item()
	item.icon = null

	var data: Dictionary = item.to_dict()
	var restored: ItemResource = ITEM_RESOURCE_SCRIPT.from_dict(data)

	assert_eq(restored.icon, null, "Null icon should round-trip as null")
	assert_eq(restored.id, item.id, "id should survive round-trip")
	assert_eq(restored.display_name, item.display_name, "display_name should survive round-trip")
	assert_eq(restored.stack_size, item.stack_size, "stack_size should survive round-trip")


func test_from_dict_with_empty_dictionary_produces_safe_defaults() -> void:
	var restored: ItemResource = ITEM_RESOURCE_SCRIPT.from_dict({})

	assert_eq(String(restored.id), "", "Missing id key should fall back to an empty StringName")
	assert_eq(restored.display_name, "", "Missing display_name should fall back to an empty String")
	assert_eq(restored.stack_size, 1, "Missing stack_size should fall back to the documented default of 1")
	assert_eq(restored.icon, null, "Missing icon should fall back to null without loading any resource")


func test_from_dict_with_missing_icon_key_yields_null_icon() -> void:
	# Absence of the icon key (as opposed to presence with an empty string) must still round-trip to null.
	var restored: ItemResource = ITEM_RESOURCE_SCRIPT.from_dict({
		"id": &"keyless_icon",
		"display_name": "Keyless Icon",
		"stack_size": 4,
	})

	assert_eq(restored.icon, null, "Missing icon key should produce a null icon")
	assert_eq(restored.id, &"keyless_icon", "id should still be preserved when icon key is absent")
	assert_eq(restored.stack_size, 4, "stack_size should still be preserved when icon key is absent")


func test_roundtrip_preserves_id_as_string_name() -> void:
	var item: ItemResource = _make_valid_item()
	item.id = &"type_sensitive"

	var data: Dictionary = item.to_dict()
	var restored: ItemResource = ITEM_RESOURCE_SCRIPT.from_dict(data)

	assert_eq(typeof(restored.id), TYPE_STRING_NAME, "id must remain a StringName across round-trip, not degrade to String")
	assert_eq(typeof(restored.stack_size), TYPE_INT, "stack_size must remain an int across round-trip")


func test_from_dict_coerces_stringified_stack_size() -> void:
	# Round-trip through a JSON layer may convert ints to their string form; from_dict must coerce back.
	var restored: ItemResource = ITEM_RESOURCE_SCRIPT.from_dict({
		"id": "stringified",
		"display_name": "Stringified Stack",
		"stack_size": "64",
		"icon": "",
	})

	assert_eq(typeof(restored.stack_size), TYPE_INT, "stack_size must be an int after coercion")
	assert_eq(restored.stack_size, 64, "stringified numeric stack_size must coerce to the same integer value")
