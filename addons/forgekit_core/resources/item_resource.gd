class_name ItemResource
extends Resource
## Base item resource: id, display name, optional icon, stack size.


## Stable identifier used to reference the item from code and recipes.
@export var id: StringName = &""

## Human-readable label shown in UI; may contain any Unicode.
@export var display_name: String = ""

## Optional icon texture; may be null for items without dedicated art.
@export var icon: Texture2D = null

## Maximum stack size; must be a positive integer.
@export var stack_size: int = 1


## Returns a list of English error messages; an empty array means the resource is valid.
func validate() -> Array[String]:
	var errors: Array[String] = []
	if String(id).is_empty():
		errors.append("id must not be empty")
	if display_name.is_empty():
		errors.append("display_name must not be empty")
	if stack_size < 1:
		errors.append("stack_size must be >= 1 (got %d)" % stack_size)
	return errors


## Serializes this item to a plain dictionary; pairs with from_dict for round-trip.
func to_dict() -> Dictionary:
	var icon_path: String = ""
	if icon != null:
		icon_path = icon.resource_path
	return {
		"id": id,
		"display_name": display_name,
		"icon": icon_path,
		"stack_size": stack_size,
	}


## Rebuilds an ItemResource from a dictionary produced by to_dict; pairs with to_dict for round-trip.
static func from_dict(data: Dictionary) -> ItemResource:
	var item: ItemResource = ItemResource.new()
	item.id = StringName(data.get("id", &""))
	item.display_name = String(data.get("display_name", ""))
	item.stack_size = int(data.get("stack_size", 1))
	var icon_path: String = String(data.get("icon", ""))
	if icon_path.is_empty():
		item.icon = null
	else:
		var loaded: Resource = load(icon_path)
		if loaded is Texture2D:
			item.icon = loaded
		else:
			item.icon = null
	return item
