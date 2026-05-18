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
##   * combat    — `McpRuntimeCombatTools` attached to the scene root.
##   * inventory — `McpRuntimeInventoryTools` over a fresh
##                 `InventorySystem` instance.
##   * crafting  — `McpCraftingTools` over a `CraftingManager` bound
##                 to the same `InventorySystem`, with the bundled
##                 `iron_ingot.tres` recipe pre-registered so the
##                 gameplay scenario in Wymaganie 13.2 resolves
##                 without an extra setup call.
##
## RPG sources are loaded at runtime (not preloaded) so the autoload
## still parses cleanly when `addons/forgekit_rpg/` is absent — the
## public template ships only a `.gitkeep` placeholder there. When
## the module is missing, the registrar logs once and degrades to a
## core-only surface; gameplay scenarios that depend on RPG tools
## time out via the test runner's port-file watchdog and skip rather
## than crash the autoload.


const COMBAT_TOOLS_PATH: String = (
	"res://addons/forgekit_rpg/combat/combat_tools.gd"
)
const INVENTORY_TOOLS_PATH: String = (
	"res://addons/forgekit_rpg/inventory/inventory_tools.gd"
)
const CRAFTING_TOOLS_PATH: String = (
	"res://addons/forgekit_rpg/crafting/crafting_tools.gd"
)
const INVENTORY_SYSTEM_PATH: String = (
	"res://addons/forgekit_rpg/inventory/inventory_system.gd"
)
const CRAFTING_MANAGER_PATH: String = (
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

	if not _rpg_module_present():
		push_warning(
			"McpBridgeRegistrar: addons/forgekit_rpg/ is missing; "
			+ "registering core-only surface. Gameplay scenarios that "
			+ "depend on combat / inventory / crafting tools will not "
			+ "be reachable until the RPG module is installed."
		)
		return

	var combat_tools_script: GDScript = load(COMBAT_TOOLS_PATH) as GDScript
	var inventory_tools_script: GDScript = load(INVENTORY_TOOLS_PATH) as GDScript
	var crafting_tools_script: GDScript = load(CRAFTING_TOOLS_PATH) as GDScript
	var inventory_system_script: GDScript = load(INVENTORY_SYSTEM_PATH) as GDScript
	var crafting_manager_script: GDScript = load(CRAFTING_MANAGER_PATH) as GDScript

	if (
		combat_tools_script == null
		or inventory_tools_script == null
		or crafting_tools_script == null
		or inventory_system_script == null
		or crafting_manager_script == null
	):
		push_error(
			"McpBridgeRegistrar: failed to load one or more RPG tool "
			+ "scripts. Skipping RPG surface registration."
		)
		return

	# Combat surface (used by `combat_create_hitbox_2d.test.ts`).
	var combat_tools: Object = combat_tools_script.new(scene_root)
	combat_tools.register_on(dispatcher)
	_adapters.append(combat_tools)

	# Inventory + crafting backends share the same InventorySystem so
	# the crafting flow can both read and mutate it within a single
	# transaction.
	_inventory = inventory_system_script.new()
	_crafting_manager = crafting_manager_script.new(_inventory)
	_register_iron_ingot_recipe(_crafting_manager)

	var inventory_tools: Object = inventory_tools_script.new(_inventory)
	inventory_tools.register_on(dispatcher)
	_adapters.append(inventory_tools)

	var crafting_tools: Object = crafting_tools_script.new(_crafting_manager)
	crafting_tools.register_on(dispatcher)
	_adapters.append(crafting_tools)


# Returns true when at least one of the RPG tool scripts the registrar
# wires actually exists in the project. The public template ships only
# `addons/forgekit_rpg/.gitkeep` so this check returns false on a fresh
# `Use this template` checkout and on CI lanes that do not stage the
# paid module — both of which are valid configurations the registrar
# must keep parsing under.
func _rpg_module_present() -> bool:
	return ResourceLoader.exists(COMBAT_TOOLS_PATH)


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
