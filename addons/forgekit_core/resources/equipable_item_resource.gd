class_name EquipableItemResource
extends ItemResource
## Equipable item: extends ItemResource with the slot, stat modifier
## stack, status-effects-on-equip list, and equip requirements that the
## RPG module's EquipmentSystem consumes.
##
## The resource itself is pure data. The runtime equip / unequip
## contract lives in the consumer module (`addons/forgekit_rpg/inventory/
## equipment_system.gd`) — this script only models the shape of an
## equipable `.tres` file and provides a `validate()` that authors can
## run before shipping.
##
## Field conventions
##
## - `slot` — StringName naming the equipment slot this item targets
##   (`&"head"`, `&"chest"`, `&"weapon"`, ...). Must be non-empty.
## - `stat_modifiers` — Array[Dictionary], each entry `{stat, type, value}`
##   matching the StatsSystem modifier payload contract. `type` is one of
##   `"flat"`, `"percent"`, `"multiplier"`.
## - `status_effects_on_equip` — Array[StringName] naming status effect
##   resources that should be applied on equip and removed on unequip.
##   Consumers resolve each entry against their effect resource library.
## - `requirements` — Dictionary of `{stat_name: StringName -> min_value:
##   float}` gating whether the owner can equip the item. Consumers
##   compare the owner's stat ledger against every entry before calling
##   `EquipmentSystem.equip`.


const _ALLOWED_MODIFIER_TYPES: Array = ["flat", "percent", "multiplier"]


## Slot the item occupies. Must be a non-empty StringName; consumer
## projects decide which slot names are active via
## `ProjectSettings["combat/equipment_slots"]` with a fixed fallback.
@export var slot: StringName = &""

## Stat modifiers applied on equip. Each entry is
## `{stat: StringName, type: String, value: float}`.
@export var stat_modifiers: Array[Dictionary] = []

## Status effects applied on equip and removed on unequip. Listed as
## effect ids so the consumer can resolve each entry against its
## effect resource library.
@export var status_effects_on_equip: Array[StringName] = []

## Stat minimums the owner must meet to equip the item. Keys are stat
## names, values are the minimum required value.
@export var requirements: Dictionary = {}


## Returns a list of English error messages; an empty array means the
## resource is valid. Extends `ItemResource.validate()` — callers
## receive the union of base and equipable-specific errors.
func validate() -> Array[String]:
	var errors: Array[String] = super.validate()

	if String(slot).is_empty():
		errors.append("slot must be a non-empty StringName")

	_validate_stat_modifiers(errors)
	_validate_status_effect_ids(errors)
	_validate_requirements(errors)

	return errors


## Serializes this equipable item to a plain dictionary. The returned
## shape is the union of `ItemResource.to_dict()` and the equipable
## fields so a round-trip preserves both layers.
func to_dict() -> Dictionary:
	var data: Dictionary = super.to_dict()
	data["slot"] = slot
	data["stat_modifiers"] = stat_modifiers.duplicate(true)
	data["status_effects_on_equip"] = status_effects_on_equip.duplicate()
	data["requirements"] = requirements.duplicate(true)
	return data


## Rebuilds an EquipableItemResource from a dictionary produced by
## `to_dict`. Missing keys fall back to documented defaults.
static func from_dict(data: Dictionary) -> EquipableItemResource:
	var item: EquipableItemResource = EquipableItemResource.new()
	# Base fields
	item.id = StringName(data.get("id", &""))
	item.display_name = String(data.get("display_name", ""))
	item.stack_size = int(data.get("stack_size", 1))
	var icon_path: String = String(data.get("icon", ""))
	if icon_path.is_empty():
		item.icon = null
	else:
		var loaded: Resource = load(icon_path)
		item.icon = loaded if loaded is Texture2D else null
	# Equipable fields
	item.slot = StringName(data.get("slot", &""))
	item.stat_modifiers = _coerce_modifier_list(data.get("stat_modifiers", []))
	item.status_effects_on_equip = _coerce_string_name_array(
		data.get("status_effects_on_equip", [])
	)
	item.requirements = _coerce_requirements(data.get("requirements", {}))
	return item


# ---------------------------------------------------------------------------
# Internal helpers — validation
# ---------------------------------------------------------------------------

func _validate_stat_modifiers(errors: Array[String]) -> void:
	for i in range(stat_modifiers.size()):
		var entry: Variant = stat_modifiers[i]
		if typeof(entry) != TYPE_DICTIONARY:
			errors.append("stat_modifiers[%d] must be a Dictionary" % i)
			continue
		var modifier: Dictionary = entry
		if not modifier.has("stat") or String(modifier["stat"]).is_empty():
			errors.append("stat_modifiers[%d] missing non-empty 'stat'" % i)
		if not modifier.has("type"):
			errors.append("stat_modifiers[%d] missing 'type'" % i)
		else:
			var mod_type: String = String(modifier["type"])
			if not _ALLOWED_MODIFIER_TYPES.has(mod_type):
				errors.append(
					"stat_modifiers[%d] 'type' must be one of [flat, percent, multiplier] (got '%s')"
					% [i, mod_type]
				)
		if not modifier.has("value"):
			errors.append("stat_modifiers[%d] missing 'value'" % i)
		elif not _is_numeric(modifier["value"]):
			errors.append("stat_modifiers[%d] 'value' must be numeric" % i)


func _validate_status_effect_ids(errors: Array[String]) -> void:
	for i in range(status_effects_on_equip.size()):
		var entry: Variant = status_effects_on_equip[i]
		if String(entry).is_empty():
			errors.append("status_effects_on_equip[%d] must be a non-empty StringName" % i)


func _validate_requirements(errors: Array[String]) -> void:
	for key in requirements.keys():
		if String(key).is_empty():
			errors.append("requirements key must be a non-empty stat name")
		if not _is_numeric(requirements[key]):
			errors.append(
				"requirements['%s'] value must be numeric" % String(key)
			)


func _is_numeric(value: Variant) -> bool:
	var t: int = typeof(value)
	return t == TYPE_INT or t == TYPE_FLOAT


# ---------------------------------------------------------------------------
# Internal helpers — from_dict coercion
# ---------------------------------------------------------------------------

static func _coerce_modifier_list(raw: Variant) -> Array[Dictionary]:
	var result: Array[Dictionary] = []
	if typeof(raw) != TYPE_ARRAY:
		return result
	for entry in raw:
		if typeof(entry) != TYPE_DICTIONARY:
			continue
		var src: Dictionary = entry
		result.append({
			"stat": StringName(src.get("stat", &"")),
			"type": String(src.get("type", "")),
			"value": float(src.get("value", 0.0)),
		})
	return result


static func _coerce_string_name_array(raw: Variant) -> Array[StringName]:
	var result: Array[StringName] = []
	if typeof(raw) != TYPE_ARRAY:
		return result
	for entry in raw:
		result.append(StringName(entry))
	return result


static func _coerce_requirements(raw: Variant) -> Dictionary:
	var result: Dictionary = {}
	if typeof(raw) != TYPE_DICTIONARY:
		return result
	var src: Dictionary = raw
	for key in src.keys():
		result[StringName(key)] = float(src[key])
	return result
