extends GutTest
## Unit tests for EquipableItemResource: validation rules, inheritance
## from ItemResource, and to_dict/from_dict round-trip of both the base
## and equipable layers.


const EQUIPABLE_ITEM_SCRIPT: GDScript = preload("res://addons/forgekit_core/resources/equipable_item_resource.gd")


func _make_valid_equipable() -> EquipableItemResource:
	var item: EquipableItemResource = EQUIPABLE_ITEM_SCRIPT.new()
	item.id = &"iron_sword"
	item.display_name = "Iron Sword"
	item.stack_size = 1
	item.slot = &"weapon"
	item.stat_modifiers = [
		{"stat": &"attack", "type": "flat", "value": 15.0},
	]
	item.status_effects_on_equip = []
	item.requirements = {}
	return item


# ---------------------------------------------------------------------------
# Inheritance
# ---------------------------------------------------------------------------

func test_equipable_extends_item_resource() -> void:
	var item: EquipableItemResource = EQUIPABLE_ITEM_SCRIPT.new()
	assert_true(item is ItemResource, "EquipableItemResource must extend ItemResource")


func test_base_item_fields_are_inherited() -> void:
	var item: EquipableItemResource = _make_valid_equipable()

	assert_eq(item.id, StringName("iron_sword"))
	assert_eq(item.display_name, "Iron Sword")
	assert_eq(item.stack_size, 1)


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------

func test_validate_on_well_formed_resource_returns_empty_array() -> void:
	var item: EquipableItemResource = _make_valid_equipable()

	var errors: Array[String] = item.validate()

	assert_eq(errors.size(), 0, "well-formed EquipableItemResource must validate cleanly: %s" % [errors])


func test_validate_accepts_all_allowed_modifier_types() -> void:
	var item: EquipableItemResource = _make_valid_equipable()
	item.stat_modifiers = [
		{"stat": &"attack", "type": "flat", "value": 10.0},
		{"stat": &"defense", "type": "percent", "value": 0.1},
		{"stat": &"speed", "type": "multiplier", "value": 0.9},
	]

	var errors: Array[String] = item.validate()

	assert_eq(errors.size(), 0, "flat, percent, and multiplier must all be accepted: %s" % [errors])


func test_validate_accepts_status_effects_and_requirements() -> void:
	var item: EquipableItemResource = _make_valid_equipable()
	item.status_effects_on_equip = [&"regeneration"]
	item.requirements = {&"intelligence": 10.0}

	var errors: Array[String] = item.validate()

	assert_eq(errors.size(), 0, "status_effects_on_equip and requirements must validate: %s" % [errors])


# ---------------------------------------------------------------------------
# Slot validation
# ---------------------------------------------------------------------------

func test_validate_rejects_empty_slot() -> void:
	var item: EquipableItemResource = _make_valid_equipable()
	item.slot = &""

	var errors: Array[String] = item.validate()

	assert_gt(errors.size(), 0, "empty slot must be rejected")
	var joined: String = "\n".join(errors)
	assert_true(joined.find("slot") != -1, "error must mention 'slot'")


# ---------------------------------------------------------------------------
# Base ItemResource errors still surface
# ---------------------------------------------------------------------------

func test_validate_surfaces_base_item_errors() -> void:
	var item: EquipableItemResource = _make_valid_equipable()
	item.id = &""  # base-layer violation

	var errors: Array[String] = item.validate()

	assert_gt(errors.size(), 0, "base ItemResource.validate errors must surface through the subclass")
	var joined: String = "\n".join(errors)
	assert_true(joined.find("id") != -1, "error must mention 'id' from the base validator")


# ---------------------------------------------------------------------------
# stat_modifiers schema
# ---------------------------------------------------------------------------

func test_validate_rejects_modifier_missing_stat() -> void:
	var item: EquipableItemResource = _make_valid_equipable()
	item.stat_modifiers = [{"type": "flat", "value": 5.0}]

	var errors: Array[String] = item.validate()

	assert_gt(errors.size(), 0, "modifier missing 'stat' must be rejected")


func test_validate_rejects_modifier_with_unknown_type() -> void:
	var item: EquipableItemResource = _make_valid_equipable()
	item.stat_modifiers = [{"stat": &"attack", "type": "exponential", "value": 5.0}]

	var errors: Array[String] = item.validate()

	assert_gt(errors.size(), 0, "modifier with unknown 'type' must be rejected")


func test_validate_rejects_modifier_missing_value() -> void:
	var item: EquipableItemResource = _make_valid_equipable()
	item.stat_modifiers = [{"stat": &"attack", "type": "flat"}]

	var errors: Array[String] = item.validate()

	assert_gt(errors.size(), 0, "modifier missing 'value' must be rejected")


# ---------------------------------------------------------------------------
# status_effects_on_equip
# ---------------------------------------------------------------------------

func test_validate_rejects_empty_status_effect_id() -> void:
	var item: EquipableItemResource = _make_valid_equipable()
	item.status_effects_on_equip = [&""]

	var errors: Array[String] = item.validate()

	assert_gt(errors.size(), 0, "empty status_effects_on_equip entry must be rejected")


# ---------------------------------------------------------------------------
# requirements
# ---------------------------------------------------------------------------

func test_validate_rejects_empty_requirement_key() -> void:
	var item: EquipableItemResource = _make_valid_equipable()
	item.requirements = {&"": 10.0}

	var errors: Array[String] = item.validate()

	assert_gt(errors.size(), 0, "empty requirements key must be rejected")


func test_validate_rejects_non_numeric_requirement_value() -> void:
	var item: EquipableItemResource = _make_valid_equipable()
	item.requirements = {&"strength": "lots"}

	var errors: Array[String] = item.validate()

	assert_gt(errors.size(), 0, "non-numeric requirements value must be rejected")


# ---------------------------------------------------------------------------
# Round-trip
# ---------------------------------------------------------------------------

func test_roundtrip_preserves_equipable_fields() -> void:
	var item: EquipableItemResource = _make_valid_equipable()
	item.stat_modifiers = [
		{"stat": &"attack", "type": "flat", "value": 15.0},
		{"stat": &"speed", "type": "multiplier", "value": 0.9},
	]
	item.status_effects_on_equip = [&"regeneration", &"shielded"]
	item.requirements = {&"strength": 12.0, &"dexterity": 8.0}

	var data: Dictionary = item.to_dict()
	var restored: EquipableItemResource = EQUIPABLE_ITEM_SCRIPT.from_dict(data)

	assert_eq(restored.id, item.id, "id must round-trip")
	assert_eq(restored.display_name, item.display_name, "display_name must round-trip")
	assert_eq(restored.stack_size, item.stack_size, "stack_size must round-trip")
	assert_eq(restored.slot, item.slot, "slot must round-trip")
	assert_eq(
		restored.stat_modifiers.size(),
		item.stat_modifiers.size(),
		"stat_modifiers length must round-trip"
	)
	assert_eq(
		StringName(restored.stat_modifiers[0]["stat"]),
		StringName(item.stat_modifiers[0]["stat"]),
		"stat_modifiers[0].stat must round-trip"
	)
	assert_eq(
		String(restored.stat_modifiers[0]["type"]),
		String(item.stat_modifiers[0]["type"]),
		"stat_modifiers[0].type must round-trip"
	)
	assert_eq(
		float(restored.stat_modifiers[0]["value"]),
		float(item.stat_modifiers[0]["value"]),
		"stat_modifiers[0].value must round-trip"
	)
	assert_eq(
		restored.status_effects_on_equip.size(),
		item.status_effects_on_equip.size(),
		"status_effects_on_equip length must round-trip"
	)
	assert_eq(
		restored.status_effects_on_equip[0],
		item.status_effects_on_equip[0],
		"status_effects_on_equip[0] must round-trip"
	)
	assert_eq(
		float(restored.requirements[&"strength"]),
		float(item.requirements[&"strength"]),
		"requirements['strength'] must round-trip"
	)


func test_from_dict_with_empty_dictionary_produces_safe_defaults() -> void:
	var restored: EquipableItemResource = EQUIPABLE_ITEM_SCRIPT.from_dict({})

	assert_eq(String(restored.id), "", "missing id must fall back to empty")
	assert_eq(restored.stack_size, 1, "missing stack_size must default to 1")
	assert_eq(String(restored.slot), "", "missing slot must fall back to empty")
	assert_eq(restored.stat_modifiers.size(), 0, "missing stat_modifiers must default to empty")
	assert_eq(
		restored.status_effects_on_equip.size(),
		0,
		"missing status_effects_on_equip must default to empty"
	)
	assert_eq(restored.requirements.size(), 0, "missing requirements must default to empty")


func test_from_dict_coerces_modifier_types() -> void:
	var restored: EquipableItemResource = EQUIPABLE_ITEM_SCRIPT.from_dict({
		"id": "coerced",
		"display_name": "Coerced",
		"stack_size": 1,
		"slot": "weapon",
		"stat_modifiers": [
			{"stat": "attack", "type": "flat", "value": "5"},
		],
	})

	assert_eq(restored.stat_modifiers.size(), 1)
	assert_eq(
		typeof(restored.stat_modifiers[0]["stat"]),
		TYPE_STRING_NAME,
		"modifier 'stat' must coerce to StringName"
	)
	assert_eq(
		typeof(restored.stat_modifiers[0]["value"]),
		TYPE_FLOAT,
		"modifier 'value' must coerce to float"
	)
	assert_eq(float(restored.stat_modifiers[0]["value"]), 5.0)
