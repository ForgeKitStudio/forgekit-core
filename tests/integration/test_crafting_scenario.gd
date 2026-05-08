extends GutTest
## Integration test — Crafting gameplay scenario.
##
## Feature: forgekit, Gameplay Scenario: crafting iron_ingot from iron_ore
##
## Drives the end-to-end flow specified by the Gameplay_Test_Runner spec:
##
##     add_item("iron_ore", 2)
##  -> crafting.execute("iron_ingot")
##  -> get_count("iron_ore")   == 0
##  -> get_count("iron_ingot") == 1
##
## The test loads `tests/integration/scenes/crafting_test_scene.tscn`,
## attaches live `InventorySystem`/`CraftingManager` instances (obtained
## via `addons/forgekit_rpg/public_api.gd`) onto the matching placeholder
## nodes through `set_meta("instance", ...)`, registers the stock
## `iron_ingot` recipe, and asserts the post-craft counts plus the
## `CraftingResult.status == OK` outcome.
##
## The forgekit_rpg subsystem ships as a `.gitkeep` placeholder in the
## public forgekit-core template, so this file uses `load()` (not
## `preload()`) to resolve the public API lazily: `preload()` would fail
## at parse time in the public template, turning the whole test script
## into a hard load error instead of a graceful `pending`. When the
## module directory is empty, the test marks itself pending with a
## descriptive message and returns early, keeping the public template's
## test suite green.

const TEST_SCENE_PATH: String = "res://tests/integration/scenes/crafting_test_scene.tscn"
const PUBLIC_API_PATH: String = "res://addons/forgekit_rpg/public_api.gd"
const IRON_INGOT_RECIPE_PATH: String = "res://addons/forgekit_rpg/crafting/recipes/iron_ingot.tres"

var _scene_instance: Node = null


func before_each() -> void:
	# Load and instantiate the integration scene. The scene itself only
	# references engine-builtin `Node` types, so it loads cleanly even
	# when the RPG module is absent — the subsystems attach at runtime.
	var packed: PackedScene = load(TEST_SCENE_PATH)
	assert_not_null(packed, "Test scene must load at %s" % TEST_SCENE_PATH)
	_scene_instance = packed.instantiate()
	add_child_autofree(_scene_instance)


func test_crafting_iron_ingot_scenario() -> void:
	# Module availability probe. In the public forgekit-core template the
	# subsystem ships as a placeholder, so skip rather than fail.
	if not ResourceLoader.exists(PUBLIC_API_PATH):
		pending("forgekit_rpg module not installed")
		return

	var public_api: GDScript = load(PUBLIC_API_PATH)
	assert_not_null(public_api, "Failed to load forgekit_rpg public_api.gd")

	# Construct the live subsystems through the public API and bind them
	# onto the scene's placeholder nodes so downstream observers (MCP
	# bridge, editor tooling) can resolve them by node path + meta.
	var inventory = public_api.InventorySystem.new()
	var crafting = public_api.CraftingManager.new(inventory)
	var result_script: GDScript = public_api.CraftingResult

	var inventory_node: Node = _scene_instance.get_node("InventorySystem")
	var crafting_node: Node = _scene_instance.get_node("CraftingManager")
	inventory_node.set_meta("instance", inventory)
	crafting_node.set_meta("instance", crafting)

	# Register the stock iron_ingot recipe (2 iron_ore -> 1 iron_ingot).
	var recipe: Resource = load(IRON_INGOT_RECIPE_PATH)
	assert_not_null(recipe, "iron_ingot recipe must load at %s" % IRON_INGOT_RECIPE_PATH)
	crafting.register_recipe(recipe)

	# Scenario.
	inventory.add_item(&"iron_ore", 2)
	var result = crafting.execute_crafting(&"iron_ingot")

	# Assertions.
	assert_not_null(result, "CraftingManager.execute_crafting must return a CraftingResult")
	assert_eq(
		int(result.status),
		int(result_script.Status.OK),
		"CraftingResult.status must be OK after successful craft"
	)
	assert_eq(
		inventory.get_count(&"iron_ore"),
		0,
		"iron_ore count must be 0 after crafting iron_ingot"
	)
	assert_eq(
		inventory.get_count(&"iron_ingot"),
		1,
		"iron_ingot count must be 1 after crafting iron_ingot"
	)
