extends GutTest
## Unit tests for the GameEvents autoload: declared signals, list_signals,
## and the payload-validating emit_validated entry point.


const EXPECTED_SIGNALS: Array = [
	"crafting_completed",
	"damage_dealt",
	"item_added",
	"item_equipped",
	"item_removed",
	"item_unequipped",
	"spell_cast",
	"status_effect_expired",
	"status_effect_ticked",
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


func test_list_signals_returns_all_declared_signal_names() -> void:
	var result: Variant = _bus().call("list_signals")
	assert_true(result is Array, "list_signals must return an Array")
	var names: Array = result
	assert_eq(names.size(), 9, "Expected exactly nine declared global signals after phase 4B additions")
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
