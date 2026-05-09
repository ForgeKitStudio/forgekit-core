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

## Emitted each time a registered StatusEffect completes a tick (phase 4B).
## Payload: owner (StringName), effect_id (StringName), tick_index (int)
signal status_effect_ticked(owner: StringName, effect_id: StringName, tick_index: int)

## Emitted when a StatusEffect's remaining_duration decays to zero and it
## is automatically removed from the active set (phase 4B).
## Payload: owner (StringName), effect_id (StringName)
signal status_effect_expired(owner: StringName, effect_id: StringName)

## Emitted when a spell cast completes (phase 4B). The `status` is the
## CastResult.Status name (`ok`, `insufficient_mana`, `on_cooldown`, ...)
## so a single subscriber can react to both successful and failed casts.
## Payload: caster (StringName), spell_id (StringName), target (Node), status (StringName)
signal spell_cast(caster: StringName, spell_id: StringName, target: Node, status: StringName)

## Emitted when an EquipableItemResource is successfully equipped (phase 4B).
## Payload: owner (StringName), slot (StringName), item_id (StringName)
signal item_equipped(owner: StringName, slot: StringName, item_id: StringName)

## Emitted when an EquipableItemResource is removed from a slot (phase 4B).
## Payload: owner (StringName), slot (StringName), item_id (StringName)
signal item_unequipped(owner: StringName, slot: StringName, item_id: StringName)

## Emitted whenever XP is granted to an owner (phase 5). Fires once per
## `XPSystem.grant_xp(...)` call, before any resulting level-up signals.
## `source` identifies the XP origin — `&"manual"` for direct grants,
## `&"kill"` when driven by the `died` signal, `&"quest"` for quest
## rewards (phase 8) — so subscribers can route XP popups to the right
## UI channel.
## Payload: owner (StringName), amount (float), source (StringName)
signal xp_gained(owner: StringName, amount: float, source: StringName)

## Emitted each time an owner crosses the XP threshold for the next
## level (phase 5). Fires once per level crossed; a single grant_xp
## that spans multiple levels produces N sequential signals.
## `reward_tier` echoes `LevelUpRewardResource.unlock_tier` (or `&""`
## when the level-up applied no reward), so UI can group the event
## into warrior / mage / boss panels without inspecting the reward
## resource itself.
## Payload: owner (StringName), new_level (int), reward_tier (StringName)
signal leveled_up(owner: StringName, new_level: int, reward_tier: StringName)


## Emitted when an entity's HP reaches zero (phase 6). `victim` is the
## stringname id of the dead entity (an enemy id, a player id, or any
## other owner tracked by the combat subsystem). `killer` is the
## stringname id of the entity that landed the killing blow, or `&""`
## for environmental, suicide, poison-tick, or other unowned deaths.
## The RPG progression subsystem subscribes to this signal to award
## XP to the killer when available.
## Payload: victim (StringName), killer (StringName)
signal died(victim: StringName, killer: StringName)

## Emitted when a TreasureChest is opened and its loot has been rolled
## (phase 6). Fires exactly once per chest instance even if the chest
## is interacted with again afterwards; subsequent interactions are
## no-ops.
## Payload: chest_id (StringName), opener (StringName)
signal chest_opened(chest_id: StringName, opener: StringName)

## Emitted when a Door or Portal asks gameplay code to change the
## active scene (phase 6). The event bus does not change scenes
## itself; it merely announces the intent so gameplay code can drive
## the actual `SceneTree.change_scene_to_file` and snap the player to
## `target_spawn_point`.
## Payload: from_scene (String), to_scene (String), target_spawn_point (StringName)
signal scene_transition_requested(from_scene: String, to_scene: String, target_spawn_point: StringName)

## Emitted when a DialogRunner begins a conversation (phase 6).
## Payload: npc_id (StringName), dialog_tree_id (StringName)
signal dialog_started(npc_id: StringName, dialog_tree_id: StringName)

## Emitted when a DialogRunner ends a conversation (phase 6). `outcome`
## is an optional StringName tag the dialog author can attach to the
## terminal node (for example `&"quest_accepted"`, `&"refused"`); it is
## `&""` when no outcome tag was set.
## Payload: npc_id (StringName), dialog_tree_id (StringName), outcome (StringName)
signal dialog_completed(npc_id: StringName, dialog_tree_id: StringName, outcome: StringName)

## Emitted on every Vendor buy or sell operation (phase 6).
## `transaction_type` is `&"buy"` or `&"sell"`. `currency_delta` is the
## net change in currency on `actor`'s side: negative on buy (spent
## gold), positive on sell (received gold).
## Payload: actor (StringName), vendor_id (StringName), transaction_type (StringName),
##          item_id (StringName), amount (int), currency_delta (int)
signal shop_transaction(
	actor: StringName,
	vendor_id: StringName,
	transaction_type: StringName,
	item_id: StringName,
	amount: int,
	currency_delta: int
)


## Schema: signal name -> ordered list of expected argument type names.
## Type names are human-readable strings reused in push_error messages.
const _SIGNAL_SCHEMAS: Dictionary = {
	&"damage_dealt": ["Node", "Node", "float", "StringName"],
	&"crafting_completed": ["StringName", "Array"],
	&"item_added": ["StringName", "int"],
	&"item_removed": ["StringName", "int"],
	&"status_effect_ticked": ["StringName", "StringName", "int"],
	&"status_effect_expired": ["StringName", "StringName"],
	&"spell_cast": ["StringName", "StringName", "Node", "StringName"],
	&"item_equipped": ["StringName", "StringName", "StringName"],
	&"item_unequipped": ["StringName", "StringName", "StringName"],
	&"xp_gained": ["StringName", "float", "StringName"],
	&"leveled_up": ["StringName", "int", "StringName"],
	&"died": ["StringName", "StringName"],
	&"chest_opened": ["StringName", "StringName"],
	&"scene_transition_requested": ["String", "String", "StringName"],
	&"dialog_started": ["StringName", "StringName"],
	&"dialog_completed": ["StringName", "StringName", "StringName"],
	&"shop_transaction": ["StringName", "StringName", "StringName", "StringName", "int", "int"],
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
		"String":
			return typeof(value) == TYPE_STRING
		"StringName":
			return typeof(value) == TYPE_STRING_NAME
		"Array":
			return typeof(value) == TYPE_ARRAY
		"Node":
			return value is Node
		_:
			return false
