extends GutTest
## Feature: forgekit, Property 12: Undo reverses every single operation (snapshot round-trip)
##
## For any initial scene state `S` (a randomly generated Node2D tree) and
## any single MCP editor-channel mutation
## `op ∈ {node.add, node.remove, node.set_property, node.rename,
## node.reparent, node.duplicate}`, executing `op` through the
## `McpUndoRedoWrapper` and then invoking `editor.undo()` on the
## committed action must restore the scene to a state whose snapshot
## equals the snapshot of `S`.
##
## The wrapper is driven against a `FakeUndoRedo` stand-in that records
## every call verbatim so the test can simulate a single
## `editor.undo()` by invoking the recorded `add_undo_method` callables
## of the last committed action in reverse insertion order. This
## mirrors `EditorUndoRedoManager.undo()` semantics for a single action
## and keeps the test headless (no editor singletons required).
##
## Snapshot equality is deep-structural: for every node in the tree the
## canonical form captures the name, class, the `Node2D` / `CanvasItem`
## properties mutated by `node.set_property`, and the ordered list of
## child snapshots. Two scenes with identical snapshots are
## indistinguishable through the six MCP node tools covered by this
## property.
##
## `CoreFuzz.for_all` drives the property with at least 100 iterations.
## Each iteration picks a fresh random tree AND a fresh random op,
## ensuring every op is exercised on a variety of tree shapes.

const CoreFuzzScript: GDScript = preload("res://addons/forgekit_core/mcp/testing/core_fuzz.gd")
const UndoRedoWrapperScript: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/undo_redo_wrapper.gd")

const ITERATIONS: int = 100

const OP_ADD: int = 0
const OP_REMOVE: int = 1
const OP_SET_PROPERTY: int = 2
const OP_RENAME: int = 3
const OP_REPARENT: int = 4
const OP_DUPLICATE: int = 5
const OP_COUNT: int = 6

const OP_NAMES: Array[String] = [
	"node.add",
	"node.remove",
	"node.set_property",
	"node.rename",
	"node.reparent",
	"node.duplicate",
]


# ---------------------------------------------------------------------------
# FakeUndoRedo — duck-typed stand-in for `EditorUndoRedoManager`. Records
# every call in insertion order so the test can reason about the Undo
# stack without running a real editor singleton. `simulate_last_undo()`
# replays the last committed action's undo callables in reverse, which
# matches the behaviour of `EditorUndoRedoManager.undo()` applied to a
# single action.
# ---------------------------------------------------------------------------

class FakeUndoRedo:
	extends RefCounted

	var calls: Array = []

	func create_action(name: String, merge_mode: int = 0) -> void:
		calls.append({"op": "create_action", "name": name, "merge_mode": merge_mode})

	func add_do_method(c: Callable) -> void:
		calls.append({"op": "add_do_method", "callable": c})

	func add_undo_method(c: Callable) -> void:
		calls.append({"op": "add_undo_method", "callable": c})

	func add_do_property(object: Object, property: String, value: Variant) -> void:
		calls.append({"op": "add_do_property", "object": object, "property": property, "value": value})

	func add_undo_property(object: Object, property: String, value: Variant) -> void:
		calls.append({"op": "add_undo_property", "object": object, "property": property, "value": value})

	func commit_action(execute: bool = true) -> void:
		calls.append({"op": "commit_action", "execute": execute})

	# Invoke every undo recorded on the last committed action, in reverse
	# insertion order. Covers both method-level and property-level undos.
	func simulate_last_undo() -> void:
		var commit_idx: int = -1
		for i in range(calls.size() - 1, -1, -1):
			if (calls[i] as Dictionary).get("op", "") == "commit_action":
				commit_idx = i
				break
		if commit_idx < 0:
			return
		var create_idx: int = 0
		for i in range(commit_idx - 1, -1, -1):
			if (calls[i] as Dictionary).get("op", "") == "create_action":
				create_idx = i
				break
		var undo_entries: Array = []
		for i in range(create_idx + 1, commit_idx):
			var kind: String = (calls[i] as Dictionary).get("op", "")
			if kind == "add_undo_method" or kind == "add_undo_property":
				undo_entries.append(calls[i])
		for idx in range(undo_entries.size() - 1, -1, -1):
			var entry: Dictionary = undo_entries[idx]
			if entry["op"] == "add_undo_method":
				(entry["callable"] as Callable).call()
			else:
				(entry["object"] as Object).set(entry["property"], entry["value"])


# ---------------------------------------------------------------------------
# Snapshot — canonical dictionary representation of a node subtree. The
# shape is deterministic (no set iteration), so deep-equality via `==`
# is a reliable test of structural identity.
# ---------------------------------------------------------------------------

func _snapshot(root: Node) -> Dictionary:
	var out: Dictionary = {
		"name": String(root.name),
		"class": root.get_class(),
		"properties": _snapshot_properties(root),
		"children": [],
	}
	for child in root.get_children():
		(out["children"] as Array).append(_snapshot(child))
	return out


# Capture only the fields that `node.set_property` can mutate in this
# test. Keeping the surface narrow avoids false positives from Godot
# internals (e.g. transform caches) that are not relevant to Property 12.
func _snapshot_properties(node: Node) -> Dictionary:
	var props: Dictionary = {}
	if node is Node2D:
		var n2d: Node2D = node as Node2D
		props["position"] = n2d.position
		props["rotation"] = n2d.rotation
		props["scale"] = n2d.scale
		props["z_index"] = n2d.z_index
	if node is CanvasItem:
		var ci: CanvasItem = node as CanvasItem
		props["visible"] = ci.visible
		props["modulate"] = ci.modulate
	return props


# ---------------------------------------------------------------------------
# Tree utilities
# ---------------------------------------------------------------------------

func _collect_nodes(root: Node) -> Array[Node]:
	var out: Array[Node] = []
	_collect_nodes_recursive(root, out)
	return out


func _collect_nodes_recursive(node: Node, out: Array[Node]) -> void:
	out.append(node)
	for child in node.get_children():
		_collect_nodes_recursive(child, out)


func _is_ancestor_or_self(ancestor: Node, candidate: Node) -> bool:
	var walker: Node = candidate
	while walker != null:
		if walker == ancestor:
			return true
		walker = walker.get_parent()
	return false


# Produce a random value for a property, guaranteed to differ from the
# current value when reasonably possible so the op has a visible effect
# on the snapshot. A trivial no-op still satisfies the property (undo of
# no-op is no-op), but exercising a change makes the test stronger.
func _random_property_change(rng: RandomNumberGenerator, node: Node2D) -> Dictionary:
	var property_names: Array[String] = ["position", "rotation", "scale", "z_index", "visible", "modulate"]
	var property: String = property_names[rng.randi_range(0, property_names.size() - 1)]
	var old_value: Variant = node.get(property)
	var new_value: Variant = old_value
	match property:
		"position":
			new_value = Vector2(rng.randf_range(-500.0, 500.0), rng.randf_range(-500.0, 500.0))
		"rotation":
			new_value = rng.randf_range(-TAU, TAU)
		"scale":
			new_value = Vector2(rng.randf_range(-5.0, 5.0), rng.randf_range(-5.0, 5.0))
		"z_index":
			new_value = rng.randi_range(-2048, 2048)
		"visible":
			new_value = not bool(old_value)
		"modulate":
			new_value = Color(rng.randf(), rng.randf(), rng.randf(), rng.randf())
	return {"property": property, "old_value": old_value, "new_value": new_value}


# ---------------------------------------------------------------------------
# Per-op executors. Each performs the forward mutation synchronously AND
# registers the pair (do, undo) on the wrapper, so a later
# `simulate_last_undo()` reverts the mutation. Returns true when the op
# ran, false when the generator could not find valid params on this tree
# (e.g. remove on a root-only tree); the caller is expected to fall back
# to an op that always has valid params (`node.add`).
# ---------------------------------------------------------------------------

func _exec_add(rng: RandomNumberGenerator, root: Node, wrapper: Object, orphans: Array) -> bool:
	var nodes: Array[Node] = _collect_nodes(root)
	var parent: Node = nodes[rng.randi_range(0, nodes.size() - 1)]
	var new_node: Node2D = Node2D.new()
	new_node.name = StringName("Added_%d" % rng.randi())
	new_node.position = Vector2(rng.randf_range(-100.0, 100.0), rng.randf_range(-100.0, 100.0))
	var do_c: Callable = func() -> void:
		parent.add_child(new_node)
	var undo_c: Callable = func() -> void:
		parent.remove_child(new_node)
	do_c.call()
	wrapper.wrap("node.add", String(new_node.name), do_c, undo_c)
	# After undo the node has no parent; track it so the iteration can
	# free it explicitly instead of relying on the root's free to cascade.
	orphans.append(new_node)
	return true


func _exec_remove(rng: RandomNumberGenerator, root: Node, wrapper: Object, _orphans: Array) -> bool:
	var nodes: Array[Node] = _collect_nodes(root)
	nodes.erase(root)
	if nodes.is_empty():
		return false
	var target: Node = nodes[rng.randi_range(0, nodes.size() - 1)]
	var parent: Node = target.get_parent()
	var original_index: int = target.get_index()
	var do_c: Callable = func() -> void:
		parent.remove_child(target)
	var undo_c: Callable = func() -> void:
		parent.add_child(target)
		parent.move_child(target, original_index)
	do_c.call()
	wrapper.wrap("node.remove", String(target.name), do_c, undo_c)
	return true


func _exec_set_property(rng: RandomNumberGenerator, root: Node, wrapper: Object, _orphans: Array) -> bool:
	var nodes: Array[Node] = _collect_nodes(root)
	var target_any: Node = nodes[rng.randi_range(0, nodes.size() - 1)]
	if not (target_any is Node2D):
		return false
	var target: Node2D = target_any as Node2D
	var change: Dictionary = _random_property_change(rng, target)
	var property: String = change["property"]
	var old_value: Variant = change["old_value"]
	var new_value: Variant = change["new_value"]
	var do_c: Callable = func() -> void:
		target.set(property, new_value)
	var undo_c: Callable = func() -> void:
		target.set(property, old_value)
	do_c.call()
	wrapper.wrap("node.set_property", "%s.%s" % [String(target.name), property], do_c, undo_c)
	return true


func _exec_rename(rng: RandomNumberGenerator, root: Node, wrapper: Object, _orphans: Array) -> bool:
	var nodes: Array[Node] = _collect_nodes(root)
	var target: Node = nodes[rng.randi_range(0, nodes.size() - 1)]
	var old_name: StringName = target.name
	# StringName with a numeric suffix so Godot does not auto-dedupe.
	var new_name: StringName = StringName("Renamed_%d" % rng.randi())
	var do_c: Callable = func() -> void:
		target.name = new_name
	var undo_c: Callable = func() -> void:
		target.name = old_name
	do_c.call()
	wrapper.wrap("node.rename", String(old_name), do_c, undo_c)
	return true


func _exec_reparent(rng: RandomNumberGenerator, root: Node, wrapper: Object, _orphans: Array) -> bool:
	var nodes: Array[Node] = _collect_nodes(root)
	nodes.erase(root)
	if nodes.is_empty():
		return false
	var target: Node = nodes[rng.randi_range(0, nodes.size() - 1)]
	var old_parent: Node = target.get_parent()
	var old_index: int = target.get_index()
	var old_name: StringName = target.name
	# A valid new parent is any node that is not target itself, not a
	# descendant of target (would create a cycle) and not the current
	# parent (would be a no-op that still satisfies the property but
	# exercises nothing).
	var all_nodes: Array[Node] = _collect_nodes(root)
	var candidates: Array[Node] = []
	for n in all_nodes:
		if _is_ancestor_or_self(target, n):
			continue
		if n == old_parent:
			continue
		candidates.append(n)
	if candidates.is_empty():
		return false
	var new_parent: Node = candidates[rng.randi_range(0, candidates.size() - 1)]
	var do_c: Callable = func() -> void:
		old_parent.remove_child(target)
		new_parent.add_child(target)
	var undo_c: Callable = func() -> void:
		new_parent.remove_child(target)
		# Godot auto-renames on `add_child` when a sibling already owns
		# the same name. Restoring the original name explicitly keeps
		# the snapshot stable regardless of whether a rename happened.
		target.name = old_name
		old_parent.add_child(target)
		old_parent.move_child(target, old_index)
	do_c.call()
	wrapper.wrap("node.reparent", String(old_name), do_c, undo_c)
	return true


func _exec_duplicate(rng: RandomNumberGenerator, root: Node, wrapper: Object, orphans: Array) -> bool:
	var nodes: Array[Node] = _collect_nodes(root)
	nodes.erase(root)
	if nodes.is_empty():
		return false
	var source: Node = nodes[rng.randi_range(0, nodes.size() - 1)]
	var parent: Node = source.get_parent()
	var dup: Node = source.duplicate()
	dup.name = StringName("Duplicated_%d" % rng.randi())
	var do_c: Callable = func() -> void:
		parent.add_child(dup)
	var undo_c: Callable = func() -> void:
		parent.remove_child(dup)
	do_c.call()
	wrapper.wrap("node.duplicate", String(source.name), do_c, undo_c)
	orphans.append(dup)
	return true


# Dispatch to the selected op. Falls back to `node.add` if the chosen op
# cannot execute on this tree (e.g. remove on a root-only tree).
func _run_op(rng: RandomNumberGenerator, root: Node, wrapper: Object, op_idx: int, orphans: Array) -> int:
	var executed: bool = false
	match op_idx:
		OP_ADD:
			executed = _exec_add(rng, root, wrapper, orphans)
		OP_REMOVE:
			executed = _exec_remove(rng, root, wrapper, orphans)
		OP_SET_PROPERTY:
			executed = _exec_set_property(rng, root, wrapper, orphans)
		OP_RENAME:
			executed = _exec_rename(rng, root, wrapper, orphans)
		OP_REPARENT:
			executed = _exec_reparent(rng, root, wrapper, orphans)
		OP_DUPLICATE:
			executed = _exec_duplicate(rng, root, wrapper, orphans)
	if executed:
		return op_idx
	if op_idx != OP_ADD:
		# Fallback: node.add always has valid params on a non-null tree.
		if _exec_add(rng, root, wrapper, orphans):
			return OP_ADD
	return -1


# Free every orphan created by the iteration, then the root. Orphans are
# nodes that were attached during the forward op and detached by the
# undo, so they have no parent and cannot be freed transitively via the
# root.
func _cleanup(root: Node, orphans: Array) -> void:
	for n in orphans:
		if not is_instance_valid(n):
			continue
		var orphan_node: Node = n as Node
		var p: Node = orphan_node.get_parent()
		if p != null:
			p.remove_child(orphan_node)
		orphan_node.free()
	root.free()


# ---------------------------------------------------------------------------
# The property itself.
# ---------------------------------------------------------------------------

func test_undo_reverses_every_single_operation() -> void:
	var failure_message: String = ""
	var rng: RandomNumberGenerator = CoreFuzzScript.seeded(12)

	var predicate: Callable = func(_unused: int) -> bool:
		var root: Node = CoreFuzzScript.random_node_tree(rng)
		var snap_before: Dictionary = _snapshot(root)

		var fake: FakeUndoRedo = FakeUndoRedo.new()
		var wrapper: Object = UndoRedoWrapperScript.new()
		wrapper.set_undo_redo(fake)

		var orphans: Array = []
		var chosen_op: int = rng.randi_range(0, OP_COUNT - 1)
		var executed_op: int = _run_op(rng, root, wrapper, chosen_op, orphans)
		if executed_op < 0:
			failure_message = "No op could be executed on the generated tree"
			_cleanup(root, orphans)
			return false

		fake.simulate_last_undo()

		var snap_after_undo: Dictionary = _snapshot(root)
		var ok: bool = snap_before == snap_after_undo
		if not ok:
			failure_message = "Snapshot mismatch after undo of %s: before=%s after=%s" % [
				OP_NAMES[executed_op],
				str(snap_before),
				str(snap_after_undo),
			]
		_cleanup(root, orphans)
		return ok

	# Every source of variation flows through the shared `rng` captured
	# by the predicate; the generator just hands a placeholder integer
	# so `CoreFuzz.for_all` has a concrete counterexample value to
	# report on failure.
	var generator: Callable = func() -> int:
		return 0

	var result: Dictionary = CoreFuzzScript.for_all(generator, predicate, ITERATIONS)

	assert_true(
		result["ok"],
		"Property 12 (Undo reverses every single operation — snapshot round-trip) failed after %d iterations: %s" % [
			int(result.get("iterations", -1)),
			failure_message,
		]
	)
	assert_gte(
		int(result.get("iterations", 0)),
		ITERATIONS,
		"CoreFuzz.for_all must execute at least %d iterations" % ITERATIONS
	)
