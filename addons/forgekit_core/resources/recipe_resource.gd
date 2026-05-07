class_name RecipeResource
extends Resource
## Base crafting recipe resource: id, inputs, outputs, duration.


## Stable identifier used to reference the recipe from code and crafting managers.
@export var id: StringName = &""

## List of consumed entries; each dictionary has keys item_id: StringName and amount: int >= 1.
@export var inputs: Array[Dictionary] = []

## List of produced entries; same schema as inputs and must contain at least one entry.
@export var outputs: Array[Dictionary] = []

## Crafting duration in seconds; must be >= 0.0.
@export var duration_seconds: float = 0.0


## Returns a list of English error messages; an empty array means the resource is valid.
func validate() -> Array[String]:
	var errors: Array[String] = []
	if String(id).is_empty():
		errors.append("id must not be empty")
	_validate_entries(inputs, "inputs", errors, false)
	_validate_entries(outputs, "outputs", errors, true)
	if duration_seconds < 0.0:
		errors.append("duration_seconds must be >= 0.0 (got %f)" % duration_seconds)
	return errors


## Serializes this recipe to a plain dictionary; pairs with from_dict for round-trip.
func to_dict() -> Dictionary:
	return {
		"id": id,
		"inputs": _entries_to_plain(inputs),
		"outputs": _entries_to_plain(outputs),
		"duration_seconds": duration_seconds,
	}


## Rebuilds a RecipeResource from a dictionary produced by to_dict; pairs with to_dict for round-trip.
static func from_dict(data: Dictionary) -> RecipeResource:
	var recipe: RecipeResource = RecipeResource.new()
	recipe.id = StringName(data.get("id", &""))
	recipe.duration_seconds = float(data.get("duration_seconds", 0.0))
	recipe.inputs = _entries_from_plain(data.get("inputs", []))
	recipe.outputs = _entries_from_plain(data.get("outputs", []))
	return recipe


func _validate_entries(entries: Array[Dictionary], field_name: String, errors: Array[String], require_non_empty: bool) -> void:
	if require_non_empty and entries.is_empty():
		errors.append("%s must contain at least one entry" % field_name)
		return
	for i in range(entries.size()):
		var entry: Dictionary = entries[i]
		var prefix: String = "%s[%d]" % [field_name, i]
		if not entry.has("item_id"):
			errors.append("%s: missing required key 'item_id'" % prefix)
		elif typeof(entry["item_id"]) != TYPE_STRING_NAME and typeof(entry["item_id"]) != TYPE_STRING:
			errors.append("%s: item_id must be a StringName" % prefix)
		elif String(entry["item_id"]).is_empty():
			errors.append("%s: item_id must not be empty" % prefix)
		if not entry.has("amount"):
			errors.append("%s: missing required key 'amount'" % prefix)
		elif typeof(entry["amount"]) != TYPE_INT:
			errors.append("%s: amount must be an int" % prefix)
		elif int(entry["amount"]) < 1:
			errors.append("%s: amount must be >= 1 (got %d)" % [prefix, int(entry["amount"])])


static func _entries_to_plain(entries: Array[Dictionary]) -> Array:
	var plain: Array = []
	for entry in entries:
		var converted: Dictionary = {}
		for key in entry.keys():
			converted[String(key)] = entry[key]
		plain.append(converted)
	return plain


static func _entries_from_plain(raw: Variant) -> Array[Dictionary]:
	var entries: Array[Dictionary] = []
	if raw is Array:
		for item in raw:
			if item is Dictionary:
				var entry: Dictionary = {}
				if item.has("item_id"):
					entry["item_id"] = StringName(item["item_id"])
				if item.has("amount"):
					entry["amount"] = int(item["amount"])
				entries.append(entry)
	return entries
