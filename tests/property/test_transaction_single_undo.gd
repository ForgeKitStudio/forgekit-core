extends GutTest
## Feature: forgekit, Property 13: Transaction collapses N operations into a single Undo entry
##
## For any N in [1..20], opening a transaction with
## `TransactionManager.begin()`, registering N mutating operations via
## `register_operation(...)`, and finalising with `commit(tx_id)` must add
## exactly one entry to the editor Undo stack — one `create_action` plus one
## `commit_action` on the injected `EditorUndoRedoManager` stand-in,
## regardless of how many operations the transaction collected.
##
## Furthermore, a single simulated `editor.undo()` on that one committed
## action must revert all N operations. We simulate the undo by invoking
## every `add_undo_method` callable recorded on the single action, in
## reverse insertion order — this mirrors what `EditorUndoRedoManager.undo()`
## does for a single action in the real editor.
##
## CoreFuzz.for_all drives the property with at least 100 iterations; each
## iteration picks a fresh N uniformly at random in [1..20] and asserts the
## invariants above against a fresh TransactionManager + FakeUndoRedo pair.

const CoreFuzzScript: GDScript = preload("res://addons/forgekit_core/mcp/testing/core_fuzz.gd")
const TransactionManagerScript: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/transaction_manager.gd")

const ITERATIONS: int = 100
const MIN_OPERATIONS: int = 1
const MAX_OPERATIONS: int = 20


# ---------------------------------------------------------------------------
# FakeUndoRedo — duck-typed stand-in for EditorUndoRedoManager that records
# every incoming call in insertion order. Headless GUT cannot instantiate the
# real editor singleton, so TransactionManager is written against a narrow
# interface that this fake satisfies.
# ---------------------------------------------------------------------------

class FakeUndoRedo:
	extends RefCounted

	var calls: Array = []

	func create_action(name: String, merge_mode: int = 0) -> void:
		calls.append({"op": "create_action", "name": name, "merge_mode": merge_mode})

	func add_do_method(callable: Callable) -> void:
		calls.append({"op": "add_do_method", "callable": callable})

	func add_undo_method(callable: Callable) -> void:
		calls.append({"op": "add_undo_method", "callable": callable})

	func commit_action(execute: bool = true) -> void:
		calls.append({"op": "commit_action", "execute": execute})

	func count_calls(op_name: String) -> int:
		var n: int = 0
		for c in calls:
			if (c as Dictionary).get("op", "") == op_name:
				n += 1
		return n

	# Returns every recorded call of the given op_name in insertion order.
	func collect(op_name: String) -> Array:
		var result: Array = []
		for c in calls:
			if (c as Dictionary).get("op", "") == op_name:
				result.append(c)
		return result


# ---------------------------------------------------------------------------
# WorldState — mutable sink that per-operation do/undo callables toggle.
# Operation i sets values[i] = i + 1 on do and values[i] = 0 on undo. This
# gives each position a unique marker so undo ordering mistakes are caught
# (e.g. an undo at position j touching position i would leave a residue).
# ---------------------------------------------------------------------------

class WorldState:
	extends RefCounted

	var values: Array = []

	func resize_to(size: int) -> void:
		values.clear()
		for _i in range(size):
			values.append(0)

	func do_at(i: int) -> void:
		values[i] = i + 1

	func undo_at(i: int) -> void:
		values[i] = 0

	func snapshot() -> Array:
		return values.duplicate()


func test_transaction_collapses_n_operations_into_single_undo_entry() -> void:
	var failure_message: String = ""

	var predicate: Callable = func(n: int) -> bool:
		var fake: FakeUndoRedo = FakeUndoRedo.new()
		var mgr: Object = TransactionManagerScript.new()
		mgr.set_undo_redo(fake)

		var world: WorldState = WorldState.new()
		world.resize_to(n)
		var pre_state: Array = world.snapshot()

		var tx_id: String = mgr.begin("MCP: batch")

		# Register N operations. Drive the forward mutation synchronously so
		# the observable post-commit state is well-defined and the subsequent
		# undo assertion has something to revert.
		for i in range(n):
			var do_c: Callable = Callable(world, "do_at").bind(i)
			var undo_c: Callable = Callable(world, "undo_at").bind(i)
			mgr.register_operation(tx_id, do_c, undo_c)
			do_c.call()

		# Sanity: the world has actually advanced before commit. Without this
		# intermediate check a bug that never applies forward mutations could
		# trivially satisfy "undo reverted state" by doing nothing.
		var mid_state: Array = world.snapshot()
		for i in range(n):
			if int(mid_state[i]) != i + 1:
				failure_message = (
					"Pre-undo world state not advanced at position %d for N=%d (got %d, expected %d)"
					% [i, n, int(mid_state[i]), i + 1]
				)
				return false

		var result: Dictionary = mgr.commit(tx_id)
		if not bool(result.get("committed", false)):
			failure_message = "commit() did not return committed=true for N=%d" % n
			return false

		# Exactly one new entry on the Undo stack, independent of how many
		# operations the transaction collected.
		var create_count: int = fake.count_calls("create_action")
		if create_count != 1:
			failure_message = "Expected exactly 1 create_action for N=%d, got %d" % [n, create_count]
			return false
		var commit_count: int = fake.count_calls("commit_action")
		if commit_count != 1:
			failure_message = "Expected exactly 1 commit_action for N=%d, got %d" % [n, commit_count]
			return false
		var do_count: int = fake.count_calls("add_do_method")
		if do_count != n:
			failure_message = "Expected %d add_do_method calls for N=%d, got %d" % [n, n, do_count]
			return false
		var undo_count: int = fake.count_calls("add_undo_method")
		if undo_count != n:
			failure_message = "Expected %d add_undo_method calls for N=%d, got %d" % [n, n, undo_count]
			return false

		# Simulate a single editor.undo() on the single committed action.
		# In the real editor, EditorUndoRedoManager.undo() invokes every
		# undo-method registered on the top action in reverse insertion order.
		var undo_calls: Array = fake.collect("add_undo_method")
		for idx in range(undo_calls.size() - 1, -1, -1):
			var cb: Callable = (undo_calls[idx] as Dictionary).get("callable") as Callable
			cb.call()

		var post_state: Array = world.snapshot()
		if post_state != pre_state:
			failure_message = (
				"Single undo did not revert all N=%d operations. pre=%s mid=%s post=%s"
				% [n, str(pre_state), str(mid_state), str(post_state)]
			)
			return false

		return true

	var rng: RandomNumberGenerator = CoreFuzzScript.seeded(13)
	var generator: Callable = func() -> int:
		return rng.randi_range(MIN_OPERATIONS, MAX_OPERATIONS)

	var result: Dictionary = CoreFuzzScript.for_all(generator, predicate, ITERATIONS)

	assert_true(
		result["ok"],
		"Property 13 (Transaction collapses N operations into a single Undo entry) failed after %d iterations: %s | counterexample N=%s" % [
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
