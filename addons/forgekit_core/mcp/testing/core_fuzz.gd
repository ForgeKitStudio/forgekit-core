class_name CoreFuzz
extends RefCounted
## Minimal property-based testing harness for ForgeKit Core.
##
## Provides the pieces required by Property 1 (Round-trip for ItemResource):
##   - seeded(seed)            deterministic RandomNumberGenerator
##   - random_unicode_string() Unicode strings across several code-point blocks
##   - random_string_name()    StringName suitable for resource identifiers
##   - random_item_resource()  factory producing resources that pass validate()
##   - for_all(gen, pred, n)   runs a predicate against n generated values and
##                             records the first counterexample
##
## Later phases extend this file with recipe / inventory / node-tree generators
## and a shrinking facility. Keeping the initial surface small makes it easy to
## follow the TDD cycle for each new property without adding unused helpers.


## Identifier-safe alphabet for random StringName ids: lowercase ASCII letters,
## digits and underscore. Matches the set of characters used by the hand-written
## resources that ship with ForgeKit Core (e.g. "iron_ore").
const IDENTIFIER_ALPHABET: String = "abcdefghijklmnopqrstuvwxyz0123456789_"

## Stack sizes greater than 1 are allowed by the validator (>= 1) but the upper
## bound keeps generated test data in a range that mirrors realistic item
## configuration without blowing up log output when a counterexample prints.
const DEFAULT_MAX_STACK_SIZE: int = 1024

## Upper bound for random display_name lengths. Long enough to include multiple
## code-point blocks in a single string, short enough to keep a counterexample
## line readable.
const DEFAULT_MAX_DISPLAY_NAME_LENGTH: int = 24

## Printable Unicode code-point ranges used by random_unicode_string. Each pair
## is [inclusive_start, inclusive_end]. The selection deliberately includes
## Latin, Latin Extended, Greek, Cyrillic, CJK Unified Ideographs, Hiragana and
## a sample of symbolic code points so that .tres serialization is exercised
## across both single-byte and multi-byte UTF-8 sequences. Control characters
## (< 0x20) and surrogates (0xD800-0xDFFF) are excluded because they cannot be
## represented safely in a Godot resource text file.
const UNICODE_BLOCKS: Array = [
	[0x0020, 0x007E],  # Basic Latin (printable)
	[0x00A0, 0x00FF],  # Latin-1 Supplement
	[0x0100, 0x017F],  # Latin Extended-A
	[0x0370, 0x03FF],  # Greek and Coptic
	[0x0400, 0x04FF],  # Cyrillic
	[0x2600, 0x26FF],  # Miscellaneous Symbols
	[0x3040, 0x309F],  # Hiragana
	[0x4E00, 0x4FFF],  # CJK Unified Ideographs (subset)
]


## Returns a RandomNumberGenerator seeded with `seed` so that generators derived
## from it are fully deterministic. Reproducing a counterexample is then a
## matter of re-running the test with the same seed.
static func seeded(seed: int) -> RandomNumberGenerator:
	var rng: RandomNumberGenerator = RandomNumberGenerator.new()
	rng.seed = seed
	return rng


## Returns a random integer uniformly distributed in [min_value, max_value].
## Extracted as a helper so every generator uses the same distribution and the
## RandomNumberGenerator instance is threaded through explicitly.
static func random_int_in_range(rng: RandomNumberGenerator, min_value: int, max_value: int) -> int:
	if min_value > max_value:
		return min_value
	return rng.randi_range(min_value, max_value)


## Returns a random character drawn from `alphabet`. Callers pre-validate that
## the alphabet is non-empty; an empty alphabet returns an empty string rather
## than raising so fuzzing never crashes on an unexpected configuration.
static func _pick_char(rng: RandomNumberGenerator, alphabet: String) -> String:
	if alphabet.is_empty():
		return ""
	var index: int = rng.randi_range(0, alphabet.length() - 1)
	return alphabet.substr(index, 1)


## Returns a random ASCII string of length `length` drawn from `alphabet`.
## Used as the building block for random identifiers and for alphabet-limited
## text where Unicode would obscure the failing example.
static func random_string(rng: RandomNumberGenerator, length: int, alphabet: String = IDENTIFIER_ALPHABET) -> String:
	var result: String = ""
	var effective_length: int = max(length, 0)
	for i in range(effective_length):
		result += _pick_char(rng, alphabet)
	return result


## Returns a random Unicode string by picking one of the UNICODE_BLOCKS and
## then a code point within that block, repeated `length` times. The output is
## guaranteed to be printable and free of surrogates so that Godot's text
## resource serializer can round-trip it without escaping tricks.
static func random_unicode_string(rng: RandomNumberGenerator, length: int) -> String:
	var result: String = ""
	var effective_length: int = max(length, 0)
	for i in range(effective_length):
		var block: Array = UNICODE_BLOCKS[rng.randi_range(0, UNICODE_BLOCKS.size() - 1)]
		var start_cp: int = int(block[0])
		var end_cp: int = int(block[1])
		var cp: int = rng.randi_range(start_cp, end_cp)
		result += String.chr(cp)
	return result


## Returns a random StringName with 1..16 identifier characters. Always starts
## with a letter so it is a syntactically valid ASCII identifier and cannot be
## mistaken for an empty id by ItemResource.validate().
static func random_string_name(rng: RandomNumberGenerator) -> StringName:
	var head: String = _pick_char(rng, "abcdefghijklmnopqrstuvwxyz")
	var tail_length: int = rng.randi_range(0, 15)
	var tail: String = random_string(rng, tail_length, IDENTIFIER_ALPHABET)
	return StringName(head + tail)


## Returns an ItemResource with fields populated so that validate() returns an
## empty error list. `display_name` is guaranteed non-empty and includes
## Unicode code points; `stack_size` is a positive integer >= 1; `icon` is
## left as null (generating fixture textures would require on-disk assets and
## is outside the scope of the round-trip property).
static func random_item_resource(rng: RandomNumberGenerator) -> ItemResource:
	var item: ItemResource = ItemResource.new()
	item.id = random_string_name(rng)
	var name_length: int = rng.randi_range(1, DEFAULT_MAX_DISPLAY_NAME_LENGTH)
	item.display_name = random_unicode_string(rng, name_length)
	item.stack_size = rng.randi_range(1, DEFAULT_MAX_STACK_SIZE)
	item.icon = null
	return item


## Upper bound for random recipe amount fields. The validator requires
## amount >= 1; capping at 999 keeps counterexamples readable and still
## exercises multi-digit serialization in the .tres text format.
const DEFAULT_MAX_RECIPE_AMOUNT: int = 999

## Upper bound for the number of entries in a recipe's inputs or outputs
## array. Small enough to keep counterexamples diagnosable, large enough
## to cover collision cases where the same item_id appears twice.
const DEFAULT_MAX_RECIPE_ENTRIES: int = 5

## Upper bound for generated duration_seconds. The validator requires
## duration_seconds >= 0.0; an upper cap avoids astronomical floats
## whose text representation inflates counterexample output.
const DEFAULT_MAX_RECIPE_DURATION_SECONDS: float = 600.0


## Returns a single recipe entry dictionary with shape {item_id: StringName,
## amount: int} that satisfies RecipeResource.validate(). Extracted as a
## helper so inputs and outputs can reuse the same distribution.
static func random_recipe_entry(rng: RandomNumberGenerator) -> Dictionary:
	return {
		"item_id": random_string_name(rng),
		"amount": rng.randi_range(1, DEFAULT_MAX_RECIPE_AMOUNT),
	}


## Returns a typed Array[Dictionary] of `count` freshly generated recipe
## entries. The return type is declared so callers can assign directly
## into RecipeResource.inputs / RecipeResource.outputs without Godot
## rejecting a loosely typed Array at assignment time.
static func random_recipe_entries(rng: RandomNumberGenerator, count: int) -> Array[Dictionary]:
	var entries: Array[Dictionary] = []
	var effective_count: int = max(count, 0)
	for i in range(effective_count):
		entries.append(random_recipe_entry(rng))
	return entries


## Returns a RecipeResource whose validate() returns an empty error list.
## Inputs may be empty (pure-output recipes such as debug spawns); outputs
## always contain at least one entry because RecipeResource.validate()
## requires a non-empty outputs list. duration_seconds is non-negative.
static func random_recipe_resource(rng: RandomNumberGenerator) -> RecipeResource:
	var recipe: RecipeResource = RecipeResource.new()
	recipe.id = random_string_name(rng)
	var input_count: int = rng.randi_range(0, DEFAULT_MAX_RECIPE_ENTRIES)
	# outputs must be non-empty per RecipeResource.validate(); bias the
	# lower bound to 1 so the generator never emits an invalid recipe.
	var output_count: int = rng.randi_range(1, DEFAULT_MAX_RECIPE_ENTRIES)
	recipe.inputs = random_recipe_entries(rng, input_count)
	recipe.outputs = random_recipe_entries(rng, output_count)
	recipe.duration_seconds = rng.randf_range(0.0, DEFAULT_MAX_RECIPE_DURATION_SECONDS)
	return recipe


## Upper bound for the random amounts produced by
## random_inventory_operations. Large enough to cover multi-digit
## accumulation across repeat add_item calls to the same item_id,
## small enough that a counterexample's sum fits on one log line.
const DEFAULT_MAX_INVENTORY_AMOUNT: int = 100

## Size of the item_id pool drawn from by random_inventory_operations.
## Reusing a small pool of ids guarantees that across a sequence of
## 1..20 operations at least a few ids will repeat, so Property 16
## genuinely exercises per-id accumulation (not just trivial singletons).
const DEFAULT_INVENTORY_ID_POOL_SIZE: int = 5


## Returns a typed Array[Dictionary] of `count` random inventory
## operations of the shape `{item_id: StringName, amount: int}` with
## `amount >= 1`. `count` is clamped to [`min_ops`, `max_ops`]
## inclusive; passing a reversed range collapses to `min_ops`.
##
## The item_id pool is drawn up front from random_string_name and then
## reused across the whole sequence so that commutativity / associativity
## properties can be exercised with repeated ids per sequence rather
## than with a stream of unique singletons.
static func random_inventory_operations(
		rng: RandomNumberGenerator,
		min_ops: int,
		max_ops: int) -> Array[Dictionary]:
	var lower: int = max(min_ops, 0)
	var upper: int = max(max_ops, lower)
	var count: int = rng.randi_range(lower, upper)

	# Pool of candidate ids reused across the sequence; size capped at
	# count so short sequences still offer some variety without forcing
	# a unique id per op.
	var pool_size: int = min(DEFAULT_INVENTORY_ID_POOL_SIZE, max(count, 1))
	var pool: Array[StringName] = []
	for _i in range(pool_size):
		pool.append(random_string_name(rng))

	var ops: Array[Dictionary] = []
	for _i in range(count):
		var id_index: int = rng.randi_range(0, pool.size() - 1)
		ops.append({
			"item_id": pool[id_index],
			"amount": rng.randi_range(1, DEFAULT_MAX_INVENTORY_AMOUNT),
		})
	return ops


## Default depth (levels beneath the root) used by random_node_tree when
## the caller does not override it. Small enough that property tests can
## enumerate every node quickly, large enough to cover nested paths like
## "/Root/A/B/C" in the generated scenes.
const DEFAULT_NODE_TREE_DEPTH: int = 3

## Default maximum branching factor per non-leaf node in random_node_tree.
## Combined with DEFAULT_NODE_TREE_DEPTH this caps the tree at
## (1 + 3 + 9 + 27) = 40 nodes worst case, enough variety to exercise
## node resolution without making counterexamples unreadable.
const DEFAULT_NODE_TREE_BRANCHING: int = 3


## Returns a freshly allocated Node2D tree rooted at a single Node2D whose
## `name` is "Root". Each non-leaf node has between 0 and `max_branching`
## children (inclusive) and the tree never exceeds `max_depth` levels
## beneath the root.
##
## Ownership contract: the returned root is not attached to any SceneTree.
## Callers MUST invoke `.free()` on the root when the iteration finishes;
## calling `.free()` on a Node detaches and frees it along with every
## descendant synchronously, which is safe in headless GUT tests.
##
## Node2D is used throughout because it exposes properties across all the
## Variant scalar types needed by Property 11 (Vector2 position/scale,
## float rotation, int z_index, bool visible, Color modulate via
## CanvasItem inheritance).
static func random_node_tree(
		rng: RandomNumberGenerator,
		max_depth: int = DEFAULT_NODE_TREE_DEPTH,
		max_branching: int = DEFAULT_NODE_TREE_BRANCHING) -> Node:
	var root: Node2D = Node2D.new()
	root.name = "Root"
	_fill_random_children(rng, root, max_depth, max_branching)
	return root


## Recursive helper for random_node_tree. Extracted so the public factory
## stays free of implementation detail and so unit tests that want to
## grow a subtree on an existing root can reuse the same distribution.
static func _fill_random_children(
		rng: RandomNumberGenerator,
		parent: Node,
		remaining_depth: int,
		max_branching: int) -> void:
	if remaining_depth <= 0:
		return
	var count: int = rng.randi_range(0, max_branching)
	for i in range(count):
		var child: Node2D = Node2D.new()
		child.name = "Child_%d" % i
		parent.add_child(child)
		_fill_random_children(rng, child, remaining_depth - 1, max_branching)


## Runs `predicate` against `iterations` values produced by `generator`.
##
## Contract:
##   - `generator` is a Callable returning a fresh value on each invocation.
##   - `predicate` is a Callable taking one value and returning a bool.
##   - `iterations` must be >= 1. Callers should pass 100 or more to satisfy
##     the ForgeKit testing policy of at least 100 runs per property.
##
## Returns a dictionary:
##   { ok: bool,
##     iterations: int,             total iterations executed
##     counterexample: Variant,     first failing value, null on success
##     counterexample_index: int    0-based index of the first failure, -1 on success
##   }
##
## Intentionally simple: no shrinking, no parallel runs, no seed injection.
## Those extensions land with the properties that need them.
static func for_all(generator: Callable, predicate: Callable, iterations: int) -> Dictionary:
	assert(iterations >= 1, "for_all requires iterations >= 1")
	assert(generator.is_valid(), "for_all requires a valid generator callable")
	assert(predicate.is_valid(), "for_all requires a valid predicate callable")

	var executed: int = 0
	for i in range(iterations):
		var value: Variant = generator.call()
		var ok: bool = bool(predicate.call(value))
		executed = i + 1
		if not ok:
			return {
				"ok": false,
				"iterations": executed,
				"counterexample": value,
				"counterexample_index": i,
			}
	return {
		"ok": true,
		"iterations": executed,
		"counterexample": null,
		"counterexample_index": -1,
	}
