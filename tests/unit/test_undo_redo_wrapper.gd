extends GutTest
## Unit tests for McpUndoRedoWrapper: action-name formatting, single-action
## wrapping through a fake EditorUndoRedoManager, transaction delegation,
## and NON_UNDOABLE_OPERATION warning envelope shape.


const UNDO_REDO_WRAPPER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/undo_redo_wrapper.gd")
const TRANSACTION_MANAGER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/transaction_manager.gd")
const MCP_ERROR_CODES_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/mcp_error_codes.gd")


# ---------------------------------------------------------------------------
# FakeUndoRedo — minimal duck-typed stand-in for EditorUndoRedoManager that
# records every method call. Mirrors the pattern used by
# test_transaction_manager.gd so the wrapper stays headless-testable.
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

	func add_do_property(object: Object, property: String, value: Variant) -> void:
		calls.append({"op": "add_do_property", "object": object, "property": property, "value": value})

	func add_undo_property(object: Object, property: String, value: Variant) -> void:
		calls.append({"op": "add_undo_property", "object": object, "property": property, "value": value})

	func commit_action(execute: bool = true) -> void:
		calls.append({"op": "commit_action", "execute": execute})

	func count_calls(op_name: String) -> int:
		var n: int = 0
		for c in calls:
			if (c as Dictionary).get("op", "") == op_name:
				n += 1
		return n

	func find_first(op_name: String) -> Dictionary:
		for c in calls:
			if (c as Dictionary).get("op", "") == op_name:
				return c
		return {}


# Sink used to capture whether do/undo callables were wired to the fake.
class CallSink:
	extends RefCounted

	var log: Array = []

	func record(tag: String) -> void:
		log.append(tag)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

func _new_wrapper_with_fake() -> Dictionary:
	var wrapper: Object = UNDO_REDO_WRAPPER_SCRIPT.new()
	var fake: FakeUndoRedo = FakeUndoRedo.new()
	wrapper.set_undo_redo(fake)
	return {"wrapper": wrapper, "fake": fake}


# ---------------------------------------------------------------------------
# 1) format_action_name — "MCP: <tool_name> <target>"
# ---------------------------------------------------------------------------

func test_format_action_name_joins_tool_and_target() -> void:
	assert_eq(
		UNDO_REDO_WRAPPER_SCRIPT.format_action_name("node.add", "/root/Hero"),
		"MCP: node.add /root/Hero",
		"format_action_name must produce 'MCP: <tool_name> <target>'"
	)


func test_format_action_name_falls_back_when_target_empty() -> void:
	assert_eq(
		UNDO_REDO_WRAPPER_SCRIPT.format_action_name("node.add", ""),
		"MCP: node.add",
		"Empty target must collapse to 'MCP: <tool_name>'"
	)


func test_format_action_name_falls_back_when_tool_name_empty() -> void:
	assert_eq(
		UNDO_REDO_WRAPPER_SCRIPT.format_action_name("", ""),
		"MCP: batch",
		"Empty tool_name and target must fall back to the TransactionManager default 'MCP: batch'"
	)


# ---------------------------------------------------------------------------
# 2) Standalone wrap() opens + commits a single EditorUndoRedoManager action.
# ---------------------------------------------------------------------------

func test_wrap_emits_single_create_and_commit_pair() -> void:
	var env: Dictionary = _new_wrapper_with_fake()
	var wrapper: Object = env["wrapper"]
	var fake: FakeUndoRedo = env["fake"]
	var sink: CallSink = CallSink.new()

	var result: Dictionary = wrapper.wrap(
		"node.add",
		"/root/Hero",
		Callable(sink, "record").bind("do"),
		Callable(sink, "record").bind("undo")
	)

	assert_true(result.get("wrapped", false), "Standalone wrap() must return {wrapped: true}")
	assert_eq(fake.count_calls("create_action"), 1, "Exactly one create_action must be opened for a standalone wrap")
	assert_eq(fake.count_calls("commit_action"), 1, "Exactly one commit_action must close the standalone wrap")


# ---------------------------------------------------------------------------
# 3) Wrap wires do/undo callables onto the UndoRedo so state can be restored.
# ---------------------------------------------------------------------------

func test_wrap_wires_do_and_undo_callables_onto_undo_redo() -> void:
	var env: Dictionary = _new_wrapper_with_fake()
	var wrapper: Object = env["wrapper"]
	var fake: FakeUndoRedo = env["fake"]
	var sink: CallSink = CallSink.new()

	var _r: Dictionary = wrapper.wrap(
		"node.add",
		"/root/Hero",
		Callable(sink, "record").bind("do_add"),
		Callable(sink, "record").bind("undo_add")
	)

	assert_eq(fake.count_calls("add_do_method"), 1, "wrap() must register exactly one do-method")
	assert_eq(fake.count_calls("add_undo_method"), 1, "wrap() must register exactly one undo-method")

	# Executing the recorded callables mimics EditorUndoRedoManager invoking
	# them on Ctrl+Z / Ctrl+Y; verifies the wrapper forwarded the correct ones.
	var do_call: Dictionary = fake.find_first("add_do_method")
	var undo_call: Dictionary = fake.find_first("add_undo_method")
	(do_call["callable"] as Callable).call()
	(undo_call["callable"] as Callable).call()
	assert_eq(sink.log, ["do_add", "undo_add"], "Wrapped callables must be the exact ones handed to wrap()")


# ---------------------------------------------------------------------------
# 4) Action name uses the "MCP: <tool_name> <target>" format.
# ---------------------------------------------------------------------------

func test_wrap_uses_mcp_action_name_format() -> void:
	var env: Dictionary = _new_wrapper_with_fake()
	var wrapper: Object = env["wrapper"]
	var fake: FakeUndoRedo = env["fake"]
	var sink: CallSink = CallSink.new()

	var _r: Dictionary = wrapper.wrap(
		"node.set_property",
		"/root/Hero.position",
		Callable(sink, "record").bind("do"),
		Callable(sink, "record").bind("undo")
	)

	var create_call: Dictionary = fake.find_first("create_action")
	assert_eq(
		create_call.get("name", ""),
		"MCP: node.set_property /root/Hero.position",
		"create_action must receive 'MCP: <tool_name> <target>'"
	)


# ---------------------------------------------------------------------------
# 5) wrap_property() uses add_do_property/add_undo_property with old/new values.
# ---------------------------------------------------------------------------

func test_wrap_property_records_property_pair() -> void:
	var env: Dictionary = _new_wrapper_with_fake()
	var wrapper: Object = env["wrapper"]
	var fake: FakeUndoRedo = env["fake"]
	var target_obj: Node = Node.new()
	target_obj.name = "Hero"

	var _r: Dictionary = wrapper.wrap_property(
		"node.set_property",
		"/root/Hero",
		target_obj,
		"position",
		Vector3(1, 0, 0),
		Vector3(0, 0, 0)
	)

	assert_eq(fake.count_calls("create_action"), 1, "wrap_property() must open exactly one action")
	assert_eq(fake.count_calls("commit_action"), 1, "wrap_property() must close the action")
	assert_eq(fake.count_calls("add_do_property"), 1, "wrap_property() must register do-property")
	assert_eq(fake.count_calls("add_undo_property"), 1, "wrap_property() must register undo-property")

	var do_prop: Dictionary = fake.find_first("add_do_property")
	assert_eq(do_prop.get("property", ""), "position", "do-property name must match")
	assert_eq(do_prop.get("value"), Vector3(1, 0, 0), "do-property must receive the new value")

	var undo_prop: Dictionary = fake.find_first("add_undo_property")
	assert_eq(undo_prop.get("value"), Vector3(0, 0, 0), "undo-property must receive the old value")

	target_obj.free()


# ---------------------------------------------------------------------------
# 6) Transaction integration — when a known transaction_id is supplied, the
#    wrapper delegates to TransactionManager.register_operation and does NOT
#    open its own action on the UndoRedo.
# ---------------------------------------------------------------------------

func test_wrap_with_open_transaction_delegates_to_transaction_manager() -> void:
	var fake: FakeUndoRedo = FakeUndoRedo.new()
	var mgr: Object = TRANSACTION_MANAGER_SCRIPT.new()
	mgr.set_undo_redo(fake)

	var wrapper: Object = UNDO_REDO_WRAPPER_SCRIPT.new()
	wrapper.set_undo_redo(fake)
	wrapper.set_transaction_manager(mgr)

	var tx_id: String = mgr.begin("MCP: batch")
	var sink: CallSink = CallSink.new()

	var result: Dictionary = wrapper.wrap(
		"node.add",
		"/root/Hero",
		Callable(sink, "record").bind("do"),
		Callable(sink, "record").bind("undo"),
		tx_id
	)

	assert_true(result.get("wrapped", false), "wrap() inside a transaction must still return {wrapped: true}")
	assert_eq(result.get("transaction_id", ""), tx_id, "Result must echo the transaction_id it was queued on")
	assert_eq(
		fake.count_calls("create_action"),
		0,
		"Wrapper must NOT open its own create_action while a transaction is open"
	)
	assert_eq(
		fake.count_calls("commit_action"),
		0,
		"Wrapper must NOT commit any action while a transaction is open"
	)
	assert_true(mgr.is_open(tx_id), "Transaction must still be open after wrap()")

	# Committing the transaction should collapse the single registered op into
	# exactly one create_action + one commit_action pair on the fake.
	var commit_result: Dictionary = mgr.commit(tx_id)
	assert_true(commit_result.get("committed", false), "Transaction must commit cleanly")
	assert_eq(fake.count_calls("create_action"), 1, "Transaction commit must open exactly one UndoRedo action")
	assert_eq(fake.count_calls("commit_action"), 1, "Transaction commit must close exactly one UndoRedo action")
	assert_eq(fake.count_calls("add_do_method"), 1, "Registered op must appear as one do-method on the action")
	assert_eq(fake.count_calls("add_undo_method"), 1, "Registered op must appear as one undo-method on the action")


# ---------------------------------------------------------------------------
# 7) Unknown transaction_id falls back to standalone wrapping. Keeps behaviour
#    defensive: rather than dropping the op silently, the wrapper commits it
#    as a single-entry action so the user can still Ctrl+Z it.
# ---------------------------------------------------------------------------

func test_wrap_with_unknown_transaction_id_falls_back_to_standalone() -> void:
	var fake: FakeUndoRedo = FakeUndoRedo.new()
	var mgr: Object = TRANSACTION_MANAGER_SCRIPT.new()
	mgr.set_undo_redo(fake)

	var wrapper: Object = UNDO_REDO_WRAPPER_SCRIPT.new()
	wrapper.set_undo_redo(fake)
	wrapper.set_transaction_manager(mgr)
	var sink: CallSink = CallSink.new()

	var result: Dictionary = wrapper.wrap(
		"node.add",
		"/root/Hero",
		Callable(sink, "record").bind("do"),
		Callable(sink, "record").bind("undo"),
		"does-not-exist"
	)

	assert_true(result.get("wrapped", false), "Fallback wrap must still return {wrapped: true}")
	assert_eq(fake.count_calls("create_action"), 1, "Fallback must open exactly one standalone action")
	assert_eq(fake.count_calls("commit_action"), 1, "Fallback must close exactly one standalone action")


# ---------------------------------------------------------------------------
# 8) NON_UNDOABLE_OPERATION warning envelope — code -32004, message
#    "NON_UNDOABLE_OPERATION", suggestion in data, plus contextual fields.
# ---------------------------------------------------------------------------

func test_make_non_undoable_warning_returns_expected_envelope_shape() -> void:
	var warning: Dictionary = UNDO_REDO_WRAPPER_SCRIPT.make_non_undoable_warning(
		"fs.write_outside_resource",
		"/tmp/log.txt",
		"Target lives outside the editor resource tree."
	)

	assert_eq(warning.get("code", 0), -32004, "Warning code must be -32004")
	assert_eq(warning.get("code", 0), MCP_ERROR_CODES_SCRIPT.NON_UNDOABLE_OPERATION, "Warning code must match the NON_UNDOABLE_OPERATION constant")
	assert_eq(warning.get("message", ""), "NON_UNDOABLE_OPERATION", "Warning message must be the literal 'NON_UNDOABLE_OPERATION'")

	var data: Dictionary = warning.get("data", {})
	assert_true(data.has("suggestion"), "Warning data must include a suggestion")
	assert_false(String(data.get("suggestion", "")).is_empty(), "Warning suggestion must not be empty")
	assert_eq(data.get("tool_name", ""), "fs.write_outside_resource", "Warning data must echo tool_name")
	assert_eq(data.get("target", ""), "/tmp/log.txt", "Warning data must echo target")
	assert_eq(data.get("reason", ""), "Target lives outside the editor resource tree.", "Warning data must echo reason")
