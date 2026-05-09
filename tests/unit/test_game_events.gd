extends GutTest
## Unit tests for the GameEvents autoload: declared signals, list_signals,
## and the payload-validating emit_validated entry point.


const EXPECTED_SIGNALS: Array = [
	"chest_opened",
	"crafting_completed",
	"damage_dealt",
	"dialog_completed",
	"dialog_started",
	"died",
	"item_added",
	"item_equipped",
	"item_removed",
	"item_unequipped",
	"leveled_up",
	"scene_transition_requested",
	"shop_transaction",
	"spell_cast",
	"status_effect_expired",
	"status_effect_ticked",
	"xp_gained",
]


func _bus() -> Node:
	return get_node("/root/GameEvents")


var _received_item_added: Array = []
var _received_damage_dealt: Array = []


func _on_item_added(item_id: StringName, amount: int) -> void:
	_received_item_added.append([item_id, amount])


func _on_damage_dealt(source: Node, target: Node, damage: float, damage_type: StringName) -> void:
	_received_damage_dealt.append([source, target, damage, damage_type])


func before_each() -> void:
	_received_item_added.clear()
	_received_damage_dealt.clear()


func after_each() -> void:
	# Drop any leftover connections from this test instance so tests stay independent.
	for signal_name in EXPECTED_SIGNALS:
		if not _bus().has_signal(signal_name):
			continue
		for connection in _bus().get_signal_connection_list(signal_name):
			var callable: Callable = connection["callable"]
			if callable.get_object() == self:
				_bus().disconnect(signal_name, callable)
	_received_status_effect_ticked.clear()
	_received_status_effect_expired.clear()
	_received_spell_cast.clear()
	_received_item_equipped.clear()
	_received_item_unequipped.clear()
	_received_xp_gained.clear()
	_received_leveled_up.clear()
	_received_died.clear()
	_received_chest_opened.clear()
	_received_scene_transition_requested.clear()
	_received_dialog_started.clear()
	_received_dialog_completed.clear()
	_received_shop_transaction.clear()


func test_list_signals_returns_all_declared_signal_names() -> void:
	var result: Variant = _bus().call("list_signals")
	assert_true(result is Array, "list_signals must return an Array")
	var names: Array = result
	assert_eq(names.size(), 17, "Expected exactly seventeen declared global signals after phase 6 additions")
	for expected in EXPECTED_SIGNALS:
		assert_true(names.has(expected), "Expected signal '%s' to be declared" % expected)


func test_list_signals_returns_names_in_sorted_order() -> void:
	var names: Array = _bus().call("list_signals")
	var sorted_names: Array = names.duplicate()
	sorted_names.sort()
	assert_eq(names, sorted_names, "list_signals must return a sorted array for stable introspection")


func test_declared_signals_exist_on_autoload() -> void:
	for signal_name in EXPECTED_SIGNALS:
		assert_true(
			_bus().has_signal(signal_name),
			"Expected GameEvents to expose signal '%s'" % signal_name
		)


func test_emit_validated_propagates_well_typed_item_added_payload() -> void:
	var callable := Callable(self, "_on_item_added")
	_bus().connect(&"item_added", callable)

	var ok: bool = _bus().call("emit_validated", &"item_added", [StringName("iron_ore"), 3])

	assert_true(ok, "emit_validated must return true on well-typed payload")
	assert_eq(_received_item_added.size(), 1, "Subscriber must be invoked exactly once")
	if _received_item_added.size() == 1:
		assert_eq(_received_item_added[0][0], StringName("iron_ore"), "Payload item_id must propagate")
		assert_eq(_received_item_added[0][1], 3, "Payload amount must propagate")


func test_emit_validated_propagates_well_typed_damage_dealt_payload() -> void:
	var callable := Callable(self, "_on_damage_dealt")
	_bus().connect(&"damage_dealt", callable)

	var source: Node = Node.new()
	var target: Node = Node.new()
	add_child_autofree(source)
	add_child_autofree(target)

	var ok: bool = _bus().call(
		"emit_validated",
		&"damage_dealt",
		[source, target, 12.5, StringName("fire")]
	)

	assert_true(ok, "emit_validated must return true for a well-typed Node payload")
	assert_eq(_received_damage_dealt.size(), 1, "damage_dealt subscriber must fire exactly once")


func test_emit_validated_rejects_mismatched_type_and_does_not_propagate() -> void:
	var callable := Callable(self, "_on_item_added")
	_bus().connect(&"item_added", callable)

	# amount must be an int; passing a String must trigger push_error and return false.
	var ok: bool = _bus().call(
		"emit_validated",
		&"item_added",
		[StringName("iron_ore"), "not_an_int"]
	)

	assert_false(ok, "emit_validated must return false on type mismatch")
	assert_eq(_received_item_added.size(), 0, "Mismatched payload must not propagate to subscribers")
	assert_push_error_count(1, "Type mismatch must generate exactly one push_error")


func test_emit_validated_push_error_message_includes_signal_and_expected_type() -> void:
	var ok: bool = _bus().call(
		"emit_validated",
		&"item_added",
		[StringName("iron_ore"), "not_an_int"]
	)

	assert_false(ok, "emit_validated must return false on type mismatch")
	# GUT consumes errors per assertion, so inspect the tracked error directly
	# to verify it mentions both the signal name and the expected type.
	var errs: Array = get_errors()
	assert_eq(errs.size(), 1, "Type mismatch must generate exactly one push_error")
	if errs.size() == 1:
		var err = errs[0]
		assert_true(err.contains_text("item_added"), "push_error must mention the signal name")
		assert_true(err.contains_text("int"), "push_error must mention the expected type")
		err.handled = true


func test_emit_validated_rejects_wrong_arity_and_does_not_propagate() -> void:
	var callable := Callable(self, "_on_item_added")
	_bus().connect(&"item_added", callable)

	# item_added expects two arguments; passing one must fail validation.
	var ok: bool = _bus().call("emit_validated", &"item_added", [StringName("iron_ore")])

	assert_false(ok, "emit_validated must return false on wrong arity")
	assert_eq(_received_item_added.size(), 0, "Wrong arity must not propagate to subscribers")
	assert_push_error_count(1, "Arity mismatch must generate exactly one push_error")


func test_emit_validated_rejects_unknown_signal() -> void:
	var ok: bool = _bus().call("emit_validated", &"nonexistent_signal", [])

	assert_false(ok, "emit_validated must return false for an unknown signal")
	# GUT consumes errors per assertion, so inspect the tracked error directly
	# to verify both the count and the content on a single push_error.
	var errs: Array = get_errors()
	assert_eq(errs.size(), 1, "Unknown signal must generate exactly one push_error")
	if errs.size() == 1:
		var err = errs[0]
		assert_true(
			err.contains_text("nonexistent_signal"),
			"push_error must mention the offending signal name"
		)
		err.handled = true


# ---------------------------------------------------------------------------
# Phase 4B additions — status effects, spell casts, equipment events
# ---------------------------------------------------------------------------

var _received_status_effect_ticked: Array = []
var _received_status_effect_expired: Array = []
var _received_spell_cast: Array = []
var _received_item_equipped: Array = []
var _received_item_unequipped: Array = []


func _on_status_effect_ticked(owner: StringName, effect_id: StringName, tick_index: int) -> void:
	_received_status_effect_ticked.append([owner, effect_id, tick_index])


func _on_status_effect_expired(owner: StringName, effect_id: StringName) -> void:
	_received_status_effect_expired.append([owner, effect_id])


func _on_spell_cast(caster: StringName, spell_id: StringName, target: Node, status: StringName) -> void:
	_received_spell_cast.append([caster, spell_id, target, status])


func _on_item_equipped(owner: StringName, slot: StringName, item_id: StringName) -> void:
	_received_item_equipped.append([owner, slot, item_id])


func _on_item_unequipped(owner: StringName, slot: StringName, item_id: StringName) -> void:
	_received_item_unequipped.append([owner, slot, item_id])


func test_status_effect_ticked_is_declared_and_validated() -> void:
	assert_true(_bus().has_signal("status_effect_ticked"))

	_bus().connect(&"status_effect_ticked", Callable(self, "_on_status_effect_ticked"))

	var ok: bool = _bus().call(
		"emit_validated",
		&"status_effect_ticked",
		[StringName("hero"), StringName("mod_1"), 3]
	)

	assert_true(ok, "well-typed status_effect_ticked must propagate")
	assert_eq(_received_status_effect_ticked.size(), 1)

	_received_status_effect_ticked.clear()
	var bad: bool = _bus().call(
		"emit_validated",
		&"status_effect_ticked",
		[StringName("hero"), StringName("mod_1"), "three"]
	)
	assert_false(bad, "tick_index must be an int; String must be rejected")
	assert_eq(_received_status_effect_ticked.size(), 0)
	assert_push_error_count(1)


func test_status_effect_expired_is_declared_and_validated() -> void:
	assert_true(_bus().has_signal("status_effect_expired"))

	_bus().connect(&"status_effect_expired", Callable(self, "_on_status_effect_expired"))

	var ok: bool = _bus().call(
		"emit_validated",
		&"status_effect_expired",
		[StringName("hero"), StringName("mod_1")]
	)
	assert_true(ok)
	assert_eq(_received_status_effect_expired.size(), 1)


func test_spell_cast_is_declared_and_validated() -> void:
	assert_true(_bus().has_signal("spell_cast"))

	_bus().connect(&"spell_cast", Callable(self, "_on_spell_cast"))

	var target: Node = Node.new()
	add_child_autofree(target)

	var ok: bool = _bus().call(
		"emit_validated",
		&"spell_cast",
		[StringName("hero"), StringName("fireball"), target, StringName("ok")]
	)
	assert_true(ok, "well-typed spell_cast must propagate")
	assert_eq(_received_spell_cast.size(), 1)

	_received_spell_cast.clear()
	var bad: bool = _bus().call(
		"emit_validated",
		&"spell_cast",
		[StringName("hero"), StringName("fireball"), target, "ok"]  # status must be StringName
	)
	assert_false(bad, "spell_cast status must be StringName; plain String must be rejected")
	assert_eq(_received_spell_cast.size(), 0)
	assert_push_error_count(1)


func test_item_equipped_is_declared_and_validated() -> void:
	assert_true(_bus().has_signal("item_equipped"))

	_bus().connect(&"item_equipped", Callable(self, "_on_item_equipped"))

	var ok: bool = _bus().call(
		"emit_validated",
		&"item_equipped",
		[StringName("hero"), StringName("weapon"), StringName("iron_sword")]
	)
	assert_true(ok)
	assert_eq(_received_item_equipped.size(), 1)


func test_item_unequipped_is_declared_and_validated() -> void:
	assert_true(_bus().has_signal("item_unequipped"))

	_bus().connect(&"item_unequipped", Callable(self, "_on_item_unequipped"))

	var ok: bool = _bus().call(
		"emit_validated",
		&"item_unequipped",
		[StringName("hero"), StringName("weapon"), StringName("iron_sword")]
	)
	assert_true(ok)
	assert_eq(_received_item_unequipped.size(), 1)


# ---------------------------------------------------------------------------
# Phase 5 additions — XP and level-up events
# ---------------------------------------------------------------------------

var _received_xp_gained: Array = []
var _received_leveled_up: Array = []


func _on_xp_gained(owner: StringName, amount: float, source: StringName) -> void:
	_received_xp_gained.append([owner, amount, source])


func _on_leveled_up(owner: StringName, new_level: int, reward_tier: StringName) -> void:
	_received_leveled_up.append([owner, new_level, reward_tier])


func test_xp_gained_is_declared_and_validated() -> void:
	assert_true(_bus().has_signal("xp_gained"))

	_bus().connect(&"xp_gained", Callable(self, "_on_xp_gained"))

	var ok: bool = _bus().call(
		"emit_validated",
		&"xp_gained",
		[StringName("hero"), 125.5, StringName("manual")]
	)

	assert_true(ok, "well-typed xp_gained must propagate")
	assert_eq(_received_xp_gained.size(), 1)
	if _received_xp_gained.size() == 1:
		assert_eq(_received_xp_gained[0][0], StringName("hero"))
		assert_eq(_received_xp_gained[0][1], 125.5)
		assert_eq(_received_xp_gained[0][2], StringName("manual"))

	_received_xp_gained.clear()
	var bad: bool = _bus().call(
		"emit_validated",
		&"xp_gained",
		[StringName("hero"), 125, StringName("manual")]  # amount must be float, int rejected
	)
	assert_false(bad, "xp_gained amount must be float; int must be rejected")
	assert_eq(_received_xp_gained.size(), 0)
	assert_push_error_count(1)


func test_leveled_up_is_declared_and_validated() -> void:
	assert_true(_bus().has_signal("leveled_up"))

	_bus().connect(&"leveled_up", Callable(self, "_on_leveled_up"))

	var ok: bool = _bus().call(
		"emit_validated",
		&"leveled_up",
		[StringName("hero"), 5, StringName("warrior")]
	)

	assert_true(ok, "well-typed leveled_up must propagate")
	assert_eq(_received_leveled_up.size(), 1)
	if _received_leveled_up.size() == 1:
		assert_eq(_received_leveled_up[0][0], StringName("hero"))
		assert_eq(_received_leveled_up[0][1], 5)
		assert_eq(_received_leveled_up[0][2], StringName("warrior"))

	_received_leveled_up.clear()
	# Empty reward_tier is valid when the level-up applied no reward.
	var ok_empty: bool = _bus().call(
		"emit_validated",
		&"leveled_up",
		[StringName("hero"), 6, StringName("")]
	)
	assert_true(ok_empty, "empty reward_tier StringName must be accepted")
	assert_eq(_received_leveled_up.size(), 1)

	_received_leveled_up.clear()
	var bad: bool = _bus().call(
		"emit_validated",
		&"leveled_up",
		[StringName("hero"), "5", StringName("")]  # new_level must be int, String rejected
	)
	assert_false(bad, "leveled_up new_level must be int; String must be rejected")
	assert_eq(_received_leveled_up.size(), 0)
	assert_push_error_count(1)


# ---------------------------------------------------------------------------
# Phase 6 additions — world layer signals
# ---------------------------------------------------------------------------

var _received_died: Array = []
var _received_chest_opened: Array = []
var _received_scene_transition_requested: Array = []
var _received_dialog_started: Array = []
var _received_dialog_completed: Array = []
var _received_shop_transaction: Array = []


func _on_died(victim: StringName, killer: StringName) -> void:
	_received_died.append([victim, killer])


func _on_chest_opened(chest_id: StringName, opener: StringName) -> void:
	_received_chest_opened.append([chest_id, opener])


func _on_scene_transition_requested(from_scene: String, to_scene: String, target_spawn_point: StringName) -> void:
	_received_scene_transition_requested.append([from_scene, to_scene, target_spawn_point])


func _on_dialog_started(npc_id: StringName, dialog_tree_id: StringName) -> void:
	_received_dialog_started.append([npc_id, dialog_tree_id])


func _on_dialog_completed(npc_id: StringName, dialog_tree_id: StringName, outcome: StringName) -> void:
	_received_dialog_completed.append([npc_id, dialog_tree_id, outcome])


func _on_shop_transaction(
	actor: StringName,
	vendor_id: StringName,
	transaction_type: StringName,
	item_id: StringName,
	amount: int,
	currency_delta: int
) -> void:
	_received_shop_transaction.append(
		[actor, vendor_id, transaction_type, item_id, amount, currency_delta]
	)


func test_died_is_declared_and_validated() -> void:
	assert_true(_bus().has_signal("died"))

	_bus().connect(&"died", Callable(self, "_on_died"))

	var ok: bool = _bus().call(
		"emit_validated",
		&"died",
		[StringName("goblin_1"), StringName("player")]
	)

	assert_true(ok, "well-typed died must propagate")
	assert_eq(_received_died.size(), 1)
	if _received_died.size() == 1:
		assert_eq(_received_died[0][0], StringName("goblin_1"))
		assert_eq(_received_died[0][1], StringName("player"))

	_received_died.clear()
	# Empty killer StringName is valid for environmental / suicide deaths.
	var ok_env: bool = _bus().call(
		"emit_validated",
		&"died",
		[StringName("player"), StringName("")]
	)
	assert_true(ok_env, "empty killer StringName must be accepted")
	assert_eq(_received_died.size(), 1)

	_received_died.clear()
	var bad: bool = _bus().call(
		"emit_validated",
		&"died",
		[StringName("goblin_1"), "player"]  # killer must be StringName, String rejected
	)
	assert_false(bad, "died killer must be StringName; String must be rejected")
	assert_eq(_received_died.size(), 0)
	assert_push_error_count(1)


func test_chest_opened_is_declared_and_validated() -> void:
	assert_true(_bus().has_signal("chest_opened"))

	_bus().connect(&"chest_opened", Callable(self, "_on_chest_opened"))

	var ok: bool = _bus().call(
		"emit_validated",
		&"chest_opened",
		[StringName("common_chest_01"), StringName("player")]
	)

	assert_true(ok, "well-typed chest_opened must propagate")
	assert_eq(_received_chest_opened.size(), 1)
	if _received_chest_opened.size() == 1:
		assert_eq(_received_chest_opened[0][0], StringName("common_chest_01"))
		assert_eq(_received_chest_opened[0][1], StringName("player"))

	_received_chest_opened.clear()
	var bad: bool = _bus().call(
		"emit_validated",
		&"chest_opened",
		[StringName("common_chest_01"), 42]  # opener must be StringName, int rejected
	)
	assert_false(bad, "chest_opened opener must be StringName; int must be rejected")
	assert_eq(_received_chest_opened.size(), 0)
	assert_push_error_count(1)


func test_scene_transition_requested_is_declared_and_validated() -> void:
	assert_true(_bus().has_signal("scene_transition_requested"))

	_bus().connect(
		&"scene_transition_requested",
		Callable(self, "_on_scene_transition_requested")
	)

	var ok: bool = _bus().call(
		"emit_validated",
		&"scene_transition_requested",
		["res://scenes/village.tscn", "res://scenes/dungeon.tscn", StringName("dungeon_entry")]
	)

	assert_true(ok, "well-typed scene_transition_requested must propagate")
	assert_eq(_received_scene_transition_requested.size(), 1)
	if _received_scene_transition_requested.size() == 1:
		assert_eq(_received_scene_transition_requested[0][0], "res://scenes/village.tscn")
		assert_eq(_received_scene_transition_requested[0][1], "res://scenes/dungeon.tscn")
		assert_eq(_received_scene_transition_requested[0][2], StringName("dungeon_entry"))

	_received_scene_transition_requested.clear()
	var bad: bool = _bus().call(
		"emit_validated",
		&"scene_transition_requested",
		[
			StringName("res://scenes/village.tscn"),  # must be String, StringName rejected
			"res://scenes/dungeon.tscn",
			StringName("dungeon_entry"),
		]
	)
	assert_false(bad, "scene_transition_requested from_scene must be String; StringName must be rejected")
	assert_eq(_received_scene_transition_requested.size(), 0)
	assert_push_error_count(1)


func test_dialog_started_is_declared_and_validated() -> void:
	assert_true(_bus().has_signal("dialog_started"))

	_bus().connect(&"dialog_started", Callable(self, "_on_dialog_started"))

	var ok: bool = _bus().call(
		"emit_validated",
		&"dialog_started",
		[StringName("village_elder"), StringName("elder_greeting")]
	)

	assert_true(ok, "well-typed dialog_started must propagate")
	assert_eq(_received_dialog_started.size(), 1)
	if _received_dialog_started.size() == 1:
		assert_eq(_received_dialog_started[0][0], StringName("village_elder"))
		assert_eq(_received_dialog_started[0][1], StringName("elder_greeting"))

	_received_dialog_started.clear()
	var bad: bool = _bus().call(
		"emit_validated",
		&"dialog_started",
		[StringName("village_elder")]  # wrong arity (missing dialog_tree_id)
	)
	assert_false(bad, "dialog_started must reject wrong arity")
	assert_eq(_received_dialog_started.size(), 0)
	assert_push_error_count(1)


func test_dialog_completed_is_declared_and_validated() -> void:
	assert_true(_bus().has_signal("dialog_completed"))

	_bus().connect(&"dialog_completed", Callable(self, "_on_dialog_completed"))

	var ok: bool = _bus().call(
		"emit_validated",
		&"dialog_completed",
		[StringName("village_elder"), StringName("elder_greeting"), StringName("quest_accepted")]
	)

	assert_true(ok, "well-typed dialog_completed must propagate")
	assert_eq(_received_dialog_completed.size(), 1)
	if _received_dialog_completed.size() == 1:
		assert_eq(_received_dialog_completed[0][2], StringName("quest_accepted"))

	_received_dialog_completed.clear()
	# Empty outcome StringName is valid when dialog ends without a tagged outcome.
	var ok_empty: bool = _bus().call(
		"emit_validated",
		&"dialog_completed",
		[StringName("village_elder"), StringName("elder_greeting"), StringName("")]
	)
	assert_true(ok_empty, "empty outcome StringName must be accepted")
	assert_eq(_received_dialog_completed.size(), 1)

	_received_dialog_completed.clear()
	var bad: bool = _bus().call(
		"emit_validated",
		&"dialog_completed",
		[StringName("village_elder"), StringName("elder_greeting"), 42]  # outcome must be StringName
	)
	assert_false(bad, "dialog_completed outcome must be StringName; int must be rejected")
	assert_eq(_received_dialog_completed.size(), 0)
	assert_push_error_count(1)


func test_shop_transaction_is_declared_and_validated() -> void:
	assert_true(_bus().has_signal("shop_transaction"))

	_bus().connect(&"shop_transaction", Callable(self, "_on_shop_transaction"))

	var ok: bool = _bus().call(
		"emit_validated",
		&"shop_transaction",
		[
			StringName("player"),
			StringName("general_store"),
			StringName("buy"),
			StringName("health_potion"),
			3,
			-30,
		]
	)

	assert_true(ok, "well-typed shop_transaction must propagate")
	assert_eq(_received_shop_transaction.size(), 1)
	if _received_shop_transaction.size() == 1:
		assert_eq(_received_shop_transaction[0][2], StringName("buy"))
		assert_eq(_received_shop_transaction[0][4], 3)
		assert_eq(_received_shop_transaction[0][5], -30)

	_received_shop_transaction.clear()
	# Sell transactions use positive currency_delta.
	var ok_sell: bool = _bus().call(
		"emit_validated",
		&"shop_transaction",
		[
			StringName("player"),
			StringName("weapons_shop"),
			StringName("sell"),
			StringName("iron_sword"),
			1,
			20,
		]
	)
	assert_true(ok_sell, "sell shop_transaction must propagate")
	assert_eq(_received_shop_transaction.size(), 1)

	_received_shop_transaction.clear()
	var bad: bool = _bus().call(
		"emit_validated",
		&"shop_transaction",
		[
			StringName("player"),
			StringName("general_store"),
			StringName("buy"),
			StringName("health_potion"),
			3.0,  # amount must be int, float rejected
			-30,
		]
	)
	assert_false(bad, "shop_transaction amount must be int; float must be rejected")
	assert_eq(_received_shop_transaction.size(), 0)
	assert_push_error_count(1)
