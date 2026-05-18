extends Node
## Wires the ForgeKit RPG runtime tool surfaces into the
## `McpBridge` autoload before the bridge spins up its UDP server.
##
## The registrar is itself an autoload (declared after `McpBridge` in
## `project.godot`) so it runs after Core has placed `McpBridge` on
## the SceneTree but before the first `_process` tick that drives the
## receive loop. We set `tool_registrar` synchronously and re-trigger
## activation so the dispatcher is built with the RPG surfaces
## already attached — modules added after the dispatcher exists call
## `McpBridge.get_dispatcher().register_handler(...)` directly.
##
## The registrar holds onto the tool adapters and any backing
## subsystems as member fields because Godot Callables do not keep a
## strong reference to RefCounted targets. Without these anchors the
## adapters are GC'd as soon as `_register_tools()` returns and the
## dispatcher's handler callables resolve to null on the first tool
## call.
##
## Surfaces wired today:
##   * combat   — `McpRuntimeCombatTools` attached to the scene root.
##   * inventory — `McpRuntimeInventoryTools` over a fresh
##                 `InventorySystem` instance.
##   * crafting  — `McpCraftingTools` over a `CraftingManager` bound
##                 to the same `InventorySystem`, with the bundled
##                 `iron_ingot.tres` recipe pre-registered so the
##                 gameplay scenario in Wymaganie 13.2 resolves
##                 without an extra setup call.


const McpRuntimeCombatTools: GDScript = preload(
	"res://addons/forgekit_rpg/combat/combat_tools.gd"
)
const McpRuntimeInventoryTools: GDScript = preload(
	"res://addons/forgekit_rpg/inventory/inventory_tools.gd"
)
const McpCraftingTools: GDScript = preload(
	"res://addons/forgekit_rpg/crafting/crafting_tools.gd"
)
const InventorySystemScript: GDScript = preload(
	"res://addons/forgekit_rpg/inventory/inventory_system.gd"
)
const CraftingManagerScript: GDScript = preload(
	"res://addons/forgekit_rpg/crafting/crafting_manager.gd"
)

const IRON_INGOT_RECIPE_PATH: String = (
	"res://addons/forgekit_rpg/crafting/recipes/iron_ingot.tres"
)


# Strong references to the tool adapters registered on the dispatcher.
# Each Callable produced by `register_on(dispatcher)` references the
# adapter weakly, so we have to anchor every adapter here for the
# lifetime of the autoload.
var _adapters: Array = []

# Strong references to the live subsystems backing the inventory and
# crafting adapters. Kept on the autoload so `RefCounted` instances
# survive past the registrar callback.
var _inventory: RefCounted = null
var _crafting_manager: RefCounted = null


func _ready() -> void:
	var bridge: Node = get_tree().root.get_node_or_null("McpBridge")
	if bridge == null:
		push_error("McpBridgeRegistrar: McpBridge autoload is not present in the SceneTree")
		return

	bridge.tool_registrar = Callable(self, "_register_tools")

	# `McpBridge._ready()` runs before this autoload, so the bridge has
	# already activated (or skipped activation when `--mcp-bridge` is
	# absent). When it activated, we have to deactivate-and-re-activate
	# so the dispatcher is rebuilt with the RPG handlers attached.
	# Without `--mcp-bridge` the bridge stays dormant and this is a
	# pure no-op.
	if bridge.has_method("is_active") and bridge.is_active():
		if bridge.has_method("deactivate"):
			bridge.deactivate()
		var _result: Dictionary = bridge.activate(OS.get_cmdline_args())


# Registrar callable invoked by `McpBridge._install_dispatcher()` once
# the JSON-RPC dispatcher exists. The combat tools attach to whatever
# scene root the bridge is rooted in; the test fixture's `main.tscn`
# spawns under that root so calls with `parent_path: "."` resolve to
# the live tree. The inventory/crafting tools use plain `RefCounted`
# subsystems and do not need scene tree access.
func _register_tools(dispatcher: Object, scene_root: Node) -> void:
	_adapters.clear()

	# Combat surface (used by `combat_create_hitbox_2d.test.ts`).
	var combat_tools: Object = McpRuntimeCombatTools.new(scene_root)
	combat_tools.register_on(dispatcher)
	_adapters.append(combat_tools)

	# Inventory + crafting backends share the same InventorySystem so
	# the crafting flow can both read and mutate it within a single
	# transaction.
	_inventory = InventorySystemScript.new()
	_crafting_manager = CraftingManagerScript.new(_inventory)
	_register_iron_ingot_recipe(_crafting_manager)

	var inventory_tools: Object = McpRuntimeInventoryTools.new(_inventory)
	inventory_tools.register_on(dispatcher)
	_adapters.append(inventory_tools)

	var crafting_tools: Object = McpCraftingTools.new(_crafting_manager)
	crafting_tools.register_on(dispatcher)
	_adapters.append(crafting_tools)


# Loads the bundled `iron_ingot.tres` recipe (2 iron_ore -> 1
# iron_ingot) and registers it on the manager so the gameplay
# scenario from Wymaganie 13.2 can call `crafting.execute("iron_ingot")`
# without first authoring a recipe through `crafting.create_recipe`.
func _register_iron_ingot_recipe(manager: RefCounted) -> void:
	var recipe: Resource = ResourceLoader.load(
		IRON_INGOT_RECIPE_PATH, "", ResourceLoader.CACHE_MODE_REPLACE
	)
	if recipe == null:
		push_error(
			"McpBridgeRegistrar: failed to load %s; crafting.execute will fail"
			% IRON_INGOT_RECIPE_PATH
		)
		return
	manager.register_recipe(recipe)
