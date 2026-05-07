extends GutTest
## Feature: forgekit, Property 5: Event Bus propagates signal to all subscribers in the same frame
##
## For any subscriber count N in [1..20], connecting N distinct listeners to a
## declared GameEvents signal and then emitting that signal must invoke every
## listener synchronously (before the emit call returns). The test increments
## a shared counter once per listener and asserts counter == N after emit.
## CoreFuzz.for_all drives the property with at least 100 iterations.

const CoreFuzzScript: GDScript = preload("res://addons/forgekit_core/mcp/testing/core_fuzz.gd")

const ITERATIONS: int = 100
const MIN_SUBSCRIBERS: int = 1
const MAX_SUBSCRIBERS: int = 20

# item_added has a minimal well-typed schema (StringName, int) so every
# iteration can reuse a single constant payload and focus the property on
# propagation, not payload shape. Reusing a constant also keeps counterexample
# output limited to the varying input: the subscriber count N.
const TEST_SIGNAL: StringName = &"item_added"
const TEST_PAYLOAD: Array = [StringName("forgekit_pbt_item"), 1]


func _bus() -> Node:
	return get_node("/root/GameEvents")


## Connects `n` distinct Callables to TEST_SIGNAL, each incrementing counter[0]
## when invoked. Returns the list of Callables so the caller can disconnect
## exactly what was connected even when earlier iterations left state behind.
func _connect_counters(bus: Node, n: int, counter: Array) -> Array:
	var callables: Array = []
	for i in range(n):
		var cb: Callable = func(_item_id: StringName, _amount: int) -> void:
			counter[0] += 1
		bus.connect(TEST_SIGNAL, cb)
		callables.append(cb)
	return callables


func _disconnect_counters(bus: Node, callables: Array) -> void:
	for cb in callables:
		if bus.is_connected(TEST_SIGNAL, cb):
			bus.disconnect(TEST_SIGNAL, cb)


func test_event_bus_propagates_to_all_subscribers_in_same_frame() -> void:
	var bus: Node = _bus()
	var failure_message: String = ""

	var predicate: Callable = func(n: int) -> bool:
		var counter: Array = [0]
		var callables: Array = _connect_counters(bus, n, counter)
		# emit_validated forwards to emit_signal synchronously, so every
		# listener must have incremented the counter before this call returns.
		var ok: bool = bool(bus.call("emit_validated", TEST_SIGNAL, TEST_PAYLOAD))
		_disconnect_counters(bus, callables)
		if not ok:
			failure_message = "emit_validated returned false for N=%d" % n
			return false
		if counter[0] != n:
			failure_message = (
				"Expected counter=%d after synchronous emit with %d subscribers, got %d"
				% [n, n, counter[0]]
			)
			return false
		return true

	var rng: RandomNumberGenerator = CoreFuzzScript.seeded(5)
	var generator: Callable = func() -> int:
		return rng.randi_range(MIN_SUBSCRIBERS, MAX_SUBSCRIBERS)

	var result: Dictionary = CoreFuzzScript.for_all(generator, predicate, ITERATIONS)

	assert_true(
		result["ok"],
		"Property 5 (Event Bus propagation) failed after %d iterations: %s | counterexample N=%s" % [
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
