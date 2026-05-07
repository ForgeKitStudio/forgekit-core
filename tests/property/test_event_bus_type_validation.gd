extends GutTest
## Feature: forgekit, Property 6: Event Bus rejects payloads with mismatched types
##
## For every (signal, arg-index, mismatched value) triple where the value's
## Godot type does NOT match the schema type at that position, GameEvents
## `emit_validated` must:
##   - return false,
##   - emit exactly one push_error during the call, and
##   - include both the signal name and the expected type name in that error.
## CoreFuzz.for_all drives the property across at least 100 iterations.

const CoreFuzzScript: GDScript = preload("res://addons/forgekit_core/mcp/testing/core_fuzz.gd")

const ITERATIONS: int = 100

# Local copy of the GameEvents schema. Duplicated on purpose so the test is
# self-contained and does not reach into the autoload's private `_SIGNAL_SCHEMAS`.
const SIGNAL_NAMES: Array = [
	&"damage_dealt",
	&"crafting_completed",
	&"item_added",
	&"item_removed",
]
const SCHEMAS: Dictionary = {
	&"damage_dealt": ["Node", "Node", "float", "StringName"],
	&"crafting_completed": ["StringName", "Array"],
	&"item_added": ["StringName", "int"],
	&"item_removed": ["StringName", "int"],
}


func _bus() -> Node:
	return get_node("/root/GameEvents")


## Builds a well-typed baseline payload for `signal_name`. Any Node instances
## created here are returned separately so the predicate can free them after
## the emit call, even when one of the Node slots has been mutated away.
func _baseline_payload(signal_name: StringName) -> Dictionary:
	var nodes: Array = []
	var payload: Array = []
	match signal_name:
		&"damage_dealt":
			var source: Node = Node.new()
			var target: Node = Node.new()
			nodes.append(source)
			nodes.append(target)
			payload = [source, target, 1.0, StringName("fire")]
		&"crafting_completed":
			payload = [StringName("iron_ingot_recipe"), []]
		&"item_added":
			payload = [StringName("iron_ore"), 1]
		&"item_removed":
			payload = [StringName("iron_ore"), 1]
	return {"payload": payload, "nodes": nodes}


## Returns a value whose Godot type is guaranteed NOT to satisfy `expected_type`
## under GameEvents._matches_type (TYPE_INT, TYPE_FLOAT, TYPE_STRING_NAME,
## TYPE_ARRAY, or `is Node`). Uses `rng` so the test stays deterministic.
func _mismatched_value(expected_type: String, rng: RandomNumberGenerator) -> Variant:
	var pool: Array = []
	match expected_type:
		"int":
			pool = ["not_an_int", 1.5, StringName("sn"), true]
		"float":
			pool = ["not_a_float", 42, StringName("sn"), true]
		"StringName":
			pool = ["plain_string", 7, 1.0, true]
		"Array":
			pool = [{}, 9, StringName("sn"), "not_an_array"]
		"Node":
			pool = [StringName("sn"), 3, 1.5, "not_a_node"]
		_:
			pool = ["unsupported_expected_type"]
	return pool[rng.randi_range(0, pool.size() - 1)]


func test_event_bus_rejects_payloads_with_mismatched_types() -> void:
	var bus: Node = _bus()
	var failure_message: String = ""

	var predicate: Callable = func(sample: Dictionary) -> bool:
		var signal_name: StringName = sample["signal_name"]
		var index: int = sample["index"]
		var expected_type: String = sample["expected_type"]
		var payload: Array = sample["payload"]
		var nodes: Array = sample["nodes"]

		var errors_before: int = get_errors().size()
		var ok: bool = bool(bus.call("emit_validated", signal_name, payload))
		var errors_after: Array = get_errors()
		var new_error_count: int = errors_after.size() - errors_before

		# Free baseline Node instances regardless of outcome so 100 iterations
		# cannot leak nodes. Detached Nodes are safe to free() directly.
		for node in nodes:
			if is_instance_valid(node):
				node.free()

		if ok:
			failure_message = (
				"emit_validated returned true for signal '%s' with mismatched arg at index %d (expected '%s')"
				% [String(signal_name), index, expected_type]
			)
			return false

		if new_error_count != 1:
			failure_message = (
				"Expected exactly one push_error for signal '%s' mismatch at index %d (expected '%s'), got %d"
				% [String(signal_name), index, expected_type, new_error_count]
			)
			return false

		var err = errors_after[errors_after.size() - 1]
		var mentions_signal: bool = err.contains_text(String(signal_name))
		var mentions_type: bool = err.contains_text(expected_type)
		err.handled = true

		if not mentions_signal:
			failure_message = (
				"push_error for signal '%s' mismatch at index %d did not mention the signal name"
				% [String(signal_name), index]
			)
			return false
		if not mentions_type:
			failure_message = (
				"push_error for signal '%s' mismatch at index %d did not mention expected type '%s'"
				% [String(signal_name), index, expected_type]
			)
			return false

		return true

	var rng: RandomNumberGenerator = CoreFuzzScript.seeded(6)
	var generator: Callable = func() -> Dictionary:
		var signal_name: StringName = SIGNAL_NAMES[rng.randi_range(0, SIGNAL_NAMES.size() - 1)]
		var schema: Array = SCHEMAS[signal_name]
		var index: int = rng.randi_range(0, schema.size() - 1)
		var expected_type: String = schema[index]
		var baseline: Dictionary = _baseline_payload(signal_name)
		var payload: Array = baseline["payload"]
		payload[index] = _mismatched_value(expected_type, rng)
		return {
			"signal_name": signal_name,
			"index": index,
			"expected_type": expected_type,
			"payload": payload,
			"nodes": baseline["nodes"],
		}

	var result: Dictionary = CoreFuzzScript.for_all(generator, predicate, ITERATIONS)

	assert_true(
		result["ok"],
		"Property 6 (Event Bus rejects mismatched payload types) failed after %d iterations: %s | counterexample=%s" % [
			int(result.get("iterations", -1)),
			failure_message,
			str(result.get("counterexample")),
		]
	)
	assert_gte(
		int(result.get("iterations", 0)),
		ITERATIONS,
		"CoreFuzz.for_all must execute at least %d iterations" % ITERATIONS
	)
