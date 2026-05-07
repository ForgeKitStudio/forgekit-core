extends Node
## Global event bus: declares cross-system signals and validates payloads
## before they reach subscribers so typos and schema drift surface early.


## Emitted when an attack resolves against a valid target.
## Payload: source (Node), target (Node), damage (float), damage_type (StringName)
signal damage_dealt(source: Node, target: Node, damage: float, damage_type: StringName)

## Emitted when a crafting operation completes successfully.
## Payload: recipe_id (StringName), outputs (Array)
signal crafting_completed(recipe_id: StringName, outputs: Array)

## Emitted when an item is added to an inventory.
## Payload: item_id (StringName), amount (int)
signal item_added(item_id: StringName, amount: int)

## Emitted when an item is removed from an inventory.
## Payload: item_id (StringName), amount (int)
signal item_removed(item_id: StringName, amount: int)


## Schema: signal name -> ordered list of expected argument type names.
## Type names are human-readable strings reused in push_error messages.
const _SIGNAL_SCHEMAS: Dictionary = {
	&"damage_dealt": ["Node", "Node", "float", "StringName"],
	&"crafting_completed": ["StringName", "Array"],
	&"item_added": ["StringName", "int"],
	&"item_removed": ["StringName", "int"],
}


## Returns the declared global signal names in sorted ascending order
## so MCP introspection and test golden files stay stable.
func list_signals() -> Array[String]:
	var names: Array[String] = []
	for key in _SIGNAL_SCHEMAS.keys():
		names.append(String(key))
	names.sort()
	return names


## Emits a declared signal after verifying its payload against the schema.
## Returns true on success, false (plus a single push_error) on any mismatch.
func emit_validated(signal_name: StringName, args: Array) -> bool:
	if not _SIGNAL_SCHEMAS.has(signal_name):
		push_error("GameEvents.emit_validated: unknown signal '%s'" % String(signal_name))
		return false
	var schema: Array = _SIGNAL_SCHEMAS[signal_name]
	if args.size() != schema.size():
		push_error(
			"GameEvents.emit_validated: signal '%s' expects %d argument(s), got %d"
			% [String(signal_name), schema.size(), args.size()]
		)
		return false
	for i in range(schema.size()):
		var expected_type: String = schema[i]
		if not _matches_type(args[i], expected_type):
			push_error(
				"GameEvents.emit_validated: signal '%s' argument %d expected type '%s'"
				% [String(signal_name), i, expected_type]
			)
			return false
	callv("emit_signal", [signal_name] + args)
	return true


## Returns true when value satisfies the declared type name.
func _matches_type(value: Variant, type_name: String) -> bool:
	match type_name:
		"int":
			return typeof(value) == TYPE_INT
		"float":
			return typeof(value) == TYPE_FLOAT
		"StringName":
			return typeof(value) == TYPE_STRING_NAME
		"Array":
			return typeof(value) == TYPE_ARRAY
		"Node":
			return value is Node
		_:
			return false
