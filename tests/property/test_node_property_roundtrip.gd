extends GutTest
## Feature: forgekit, Property 11: node.set_property and node.get_property are mutual inverses
##
## For any node `n` in a randomly generated node tree, any property name `p`
## drawn from a fixed set of known-typed Node2D/CanvasItem properties, and
## any value `v` drawn from `p`'s type, invoking the MCP editor-channel tool
## `node.set_property(scene_path, node_path, p, v)` followed by
## `node.get_property(scene_path, node_path, p)` must return a payload whose
## `value` field equals `v`.
##
## The property is exercised through the real `McpEditorNodeTools` adapter.
## A minimal in-memory `LiveNodeBackend` satisfies the duck-typed backend
## contract by resolving `(scene_path, node_path)` to a live Node in the
## generated tree and invoking Godot's native `Object.set` / `Object.get`.
## This keeps the test honest: Property 11 is verified end-to-end across
## the JSON-RPC-facing adapter surface that Requirement 5.3 exposes.
##
## CoreFuzz.for_all drives the test with at least 100 iterations.

const CoreFuzzScript: GDScript = preload("res://addons/forgekit_core/mcp/testing/core_fuzz.gd")
const NodeToolsScript: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/tools/node_tools.gd")

const ITERATIONS: int = 100
const SCENE_PATH: String = "res://tests/property/fixtures/node_property_roundtrip.tscn"

# Fixed set of Node2D / CanvasItem properties whose types are known at
# generator time so that a well-typed value can be produced for each one.
# Using a closed set keeps counterexamples short and lets us reason about
# equality semantics property-by-property.
const KNOWN_PROPERTY_NAMES: Array[StringName] = [
	&"position",
	&"scale",
	&"rotation",
	&"z_index",
	&"visible",
	&"modulate",
]


# ---------------------------------------------------------------------------
# LiveNodeBackend — duck-typed EditorNodeBackend that operates against a
# real Node root in memory. Only the two methods Property 11 exercises are
# implemented; every other handler on the adapter would raise on an unset
# backend method, which is exactly what we want: the property must not
# accidentally depend on any other path.
# ---------------------------------------------------------------------------

class LiveNodeBackend:
	extends RefCounted

	var root: Node = null

	func _init(p_root: Node) -> void:
		root = p_root

	# Absolute `node_path` strings in this test start with "/Root..." and
	# refer to positions within the in-memory tree `root`. Strip the leading
	# "/Root" so Node.get_node can resolve the remainder against `root`; an
	# empty remainder means the target is the root itself.
	func _resolve(node_path: String) -> Node:
		if node_path == "/Root" or node_path == "":
			return root
		var prefix: String = "/Root/"
		if node_path.begins_with(prefix):
			var relative: String = node_path.substr(prefix.length())
			return root.get_node_or_null(NodePath(relative))
		return null

	func set_node_property(_scene_path: String, node_path: String, property: String, value: Variant) -> Variant:
		var target: Node = _resolve(node_path)
		if target == null:
			return {"error": {"code": -32001, "message": "NODE_NOT_FOUND", "data": {"node_path": node_path}}}
		var previous: Variant = target.get(property)
		target.set(property, value)
		return {"property": property, "previous_value": previous, "new_value": target.get(property)}

	func get_node_property(_scene_path: String, node_path: String, property: String) -> Variant:
		var target: Node = _resolve(node_path)
		if target == null:
			return {"error": {"code": -32001, "message": "NODE_NOT_FOUND", "data": {"node_path": node_path}}}
		return {"property": property, "value": target.get(property)}


# ---------------------------------------------------------------------------
# Helpers for generator + property logic.
# ---------------------------------------------------------------------------

# Walks `root` in depth-first order and collects every node's absolute path
# in the synthetic "/Root/..." namespace used by LiveNodeBackend. The list
# is never empty because random_node_tree always returns a root.
func _collect_paths(root: Node) -> Array[String]:
	var out: Array[String] = []
	_collect_paths_recursive(root, "/Root", out)
	return out


func _collect_paths_recursive(node: Node, current_path: String, out: Array[String]) -> void:
	out.append(current_path)
	for child in node.get_children():
		_collect_paths_recursive(child, "%s/%s" % [current_path, child.name], out)


# Returns a (property_name, value) pair whose value has the type Godot
# expects for `property_name` on a Node2D / CanvasItem. Floats, ints and
# bools use narrow ranges so counterexample printing stays readable; the
# distribution still covers negative, zero and positive inputs.
func _random_property_and_value(rng: RandomNumberGenerator) -> Array:
	var name: StringName = KNOWN_PROPERTY_NAMES[rng.randi_range(0, KNOWN_PROPERTY_NAMES.size() - 1)]
	match name:
		&"position":
			return [name, Vector2(rng.randf_range(-1000.0, 1000.0), rng.randf_range(-1000.0, 1000.0))]
		&"scale":
			return [name, Vector2(rng.randf_range(-10.0, 10.0), rng.randf_range(-10.0, 10.0))]
		&"rotation":
			return [name, rng.randf_range(-TAU, TAU)]
		&"z_index":
			# Godot clamps z_index to the range [-4096, 4096]. Stay well
			# within bounds so the stored value equals the input exactly.
			return [name, rng.randi_range(-4096, 4096)]
		&"visible":
			return [name, rng.randf() < 0.5]
		&"modulate":
			return [name, Color(rng.randf(), rng.randf(), rng.randf(), rng.randf())]
		_:
			return [name, null]


# ---------------------------------------------------------------------------
# The property itself.
# ---------------------------------------------------------------------------

func test_set_property_and_get_property_are_mutual_inverses() -> void:
	var failure_message: String = ""
	var rng: RandomNumberGenerator = CoreFuzzScript.seeded(11)

	var predicate: Callable = func(_unused: int) -> bool:
		var root: Node = CoreFuzzScript.random_node_tree(rng)
		var paths: Array[String] = _collect_paths(root)
		var target_path: String = paths[rng.randi_range(0, paths.size() - 1)]
		var pair: Array = _random_property_and_value(rng)
		var property: StringName = pair[0]
		var value: Variant = pair[1]

		var backend: LiveNodeBackend = LiveNodeBackend.new(root)
		var tools: Object = NodeToolsScript.new(backend)

		var set_result: Variant = tools.set_property({
			"scene_path": SCENE_PATH,
			"node_path": target_path,
			"property": String(property),
			"value": value,
		})
		var get_result: Variant = tools.get_property({
			"scene_path": SCENE_PATH,
			"node_path": target_path,
			"property": String(property),
		})

		root.free()

		if not (set_result is Dictionary) or (set_result as Dictionary).has("error"):
			failure_message = "set_property returned an error envelope: %s at %s.%s = %s" % [
				str(set_result), target_path, String(property), str(value),
			]
			return false
		if not (get_result is Dictionary) or (get_result as Dictionary).has("error"):
			failure_message = "get_property returned an error envelope: %s at %s.%s" % [
				str(get_result), target_path, String(property),
			]
			return false

		var returned: Variant = (get_result as Dictionary).get("value", null)
		if returned != value:
			failure_message = "Round-trip mismatch at %s.%s: set=%s get=%s" % [
				target_path, String(property), str(value), str(returned),
			]
			return false
		return true

	# The generator hands a dummy int to the predicate so the driver still
	# has a concrete value to report in counterexample output; every source
	# of variation comes from the shared `rng` captured by the predicate.
	var generator: Callable = func() -> int:
		return 0

	var result: Dictionary = CoreFuzzScript.for_all(generator, predicate, ITERATIONS)

	assert_true(
		result["ok"],
		"Property 11 (node.set_property / get_property mutual inverse) failed after %d iterations: %s" % [
			int(result.get("iterations", -1)),
			failure_message,
		]
	)
	assert_gte(
		int(result.get("iterations", 0)),
		ITERATIONS,
		"CoreFuzz.for_all must execute at least %d iterations" % ITERATIONS
	)
