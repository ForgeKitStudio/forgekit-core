extends GutTest
## Unit tests for McpJsonRpcDispatcher: schema validation of incoming JSON-RPC
## 2.0 requests before dispatch. Covers parse errors (-32700), Invalid Request
## (-32600) for malformed jsonrpc/method/id fields, Invalid params (-32602)
## for non-container params, Method not found (-32601) with a suggestion list,
## handler invocation with result wrapping, and the notification shape (no
## result envelope when `id` is absent).


const DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")


# ---------------------------------------------------------------------------
# HandlerSink — a tiny RefCounted that captures the params it was called with
# and returns a canned value. Used to verify handler registration / dispatch
# without depending on any real MCP tool.
# ---------------------------------------------------------------------------

class HandlerSink:
	extends RefCounted

	var received_params: Variant = null
	var call_count: int = 0
	var return_value: Variant = null

	func handle(params: Variant) -> Variant:
		received_params = params
		call_count += 1
		return return_value


func _new_dispatcher() -> Object:
	return DISPATCHER_SCRIPT.new()


func _new_sink(return_value: Variant = {"ok": true}) -> HandlerSink:
	var sink: HandlerSink = HandlerSink.new()
	sink.return_value = return_value
	return sink


# ---------------------------------------------------------------------------
# 1) Missing `jsonrpc` field -> -32600 Invalid Request
# ---------------------------------------------------------------------------

func test_rejects_missing_jsonrpc_field() -> void:
	var dispatcher: Object = _new_dispatcher()

	var response: Dictionary = dispatcher.dispatch({
		"method": "ping",
		"id": 1,
	})

	assert_eq(response.get("jsonrpc", ""), "2.0", "Error envelope must declare jsonrpc 2.0")
	var error: Dictionary = response.get("error", {})
	assert_eq(error.get("code", 0), -32600, "Missing 'jsonrpc' must yield Invalid Request (-32600)")
	assert_false(response.has("result"), "Error envelope must not carry a 'result' field")


# ---------------------------------------------------------------------------
# 2) Wrong `jsonrpc` version ("1.0") -> -32600
# ---------------------------------------------------------------------------

func test_rejects_wrong_jsonrpc_version() -> void:
	var dispatcher: Object = _new_dispatcher()

	var response: Dictionary = dispatcher.dispatch({
		"jsonrpc": "1.0",
		"method": "ping",
		"id": 1,
	})

	var error: Dictionary = response.get("error", {})
	assert_eq(error.get("code", 0), -32600, "Non-2.0 jsonrpc version must yield Invalid Request (-32600)")


# ---------------------------------------------------------------------------
# 3) Missing `method` -> -32600
# ---------------------------------------------------------------------------

func test_rejects_missing_method() -> void:
	var dispatcher: Object = _new_dispatcher()

	var response: Dictionary = dispatcher.dispatch({
		"jsonrpc": "2.0",
		"id": 1,
	})

	var error: Dictionary = response.get("error", {})
	assert_eq(error.get("code", 0), -32600, "Missing 'method' must yield Invalid Request (-32600)")


# ---------------------------------------------------------------------------
# 4) Non-String `method` -> -32600
# ---------------------------------------------------------------------------

func test_rejects_non_string_method() -> void:
	var dispatcher: Object = _new_dispatcher()

	var response: Dictionary = dispatcher.dispatch({
		"jsonrpc": "2.0",
		"method": 42,
		"id": 1,
	})

	var error: Dictionary = response.get("error", {})
	assert_eq(error.get("code", 0), -32600, "Non-String 'method' must yield Invalid Request (-32600)")


# ---------------------------------------------------------------------------
# 5) Empty `method` -> -32600
# ---------------------------------------------------------------------------

func test_rejects_empty_method() -> void:
	var dispatcher: Object = _new_dispatcher()

	var response: Dictionary = dispatcher.dispatch({
		"jsonrpc": "2.0",
		"method": "",
		"id": 1,
	})

	var error: Dictionary = response.get("error", {})
	assert_eq(error.get("code", 0), -32600, "Empty 'method' must yield Invalid Request (-32600)")


# ---------------------------------------------------------------------------
# 6) Non-container `params` (e.g. number) -> -32602 Invalid params
# ---------------------------------------------------------------------------

func test_rejects_invalid_params_type() -> void:
	var dispatcher: Object = _new_dispatcher()

	var response: Dictionary = dispatcher.dispatch({
		"jsonrpc": "2.0",
		"method": "ping",
		"params": 123,
		"id": 1,
	})

	var error: Dictionary = response.get("error", {})
	assert_eq(error.get("code", 0), -32602, "Non-container params must yield Invalid params (-32602)")


# ---------------------------------------------------------------------------
# 7) Dictionary params (by-name) are accepted and forwarded to the handler.
# ---------------------------------------------------------------------------

func test_accepts_dictionary_params() -> void:
	var dispatcher: Object = _new_dispatcher()
	var sink: HandlerSink = _new_sink({"echo": "dict"})
	dispatcher.register_handler("ping", Callable(sink, "handle"))

	var response: Dictionary = dispatcher.dispatch({
		"jsonrpc": "2.0",
		"method": "ping",
		"params": {"a": 1, "b": 2},
		"id": 1,
	})

	assert_eq(sink.call_count, 1, "Handler must be invoked once for a valid dictionary-params request")
	assert_true(sink.received_params is Dictionary, "Handler must receive a Dictionary when params is by-name")
	assert_eq((sink.received_params as Dictionary).get("a", 0), 1, "Params must be forwarded verbatim to the handler")
	assert_eq(response.get("result", null), {"echo": "dict"}, "Dispatcher must wrap the handler return value as result")


# ---------------------------------------------------------------------------
# 8) Array params (by-position) are accepted and forwarded to the handler.
# ---------------------------------------------------------------------------

func test_accepts_array_params() -> void:
	var dispatcher: Object = _new_dispatcher()
	var sink: HandlerSink = _new_sink({"echo": "arr"})
	dispatcher.register_handler("ping", Callable(sink, "handle"))

	var response: Dictionary = dispatcher.dispatch({
		"jsonrpc": "2.0",
		"method": "ping",
		"params": [1, 2, 3],
		"id": 1,
	})

	assert_eq(sink.call_count, 1, "Handler must be invoked once for a valid array-params request")
	assert_true(sink.received_params is Array, "Handler must receive an Array when params is by-position")
	assert_eq((sink.received_params as Array).size(), 3, "Array params must be forwarded verbatim to the handler")
	assert_eq(response.get("result", null), {"echo": "arr"}, "Dispatcher must wrap the handler return value as result")


# ---------------------------------------------------------------------------
# 9) Missing `params` is accepted; handler receives an empty dictionary.
# ---------------------------------------------------------------------------

func test_accepts_missing_params_as_notification_or_default() -> void:
	var dispatcher: Object = _new_dispatcher()
	var sink: HandlerSink = _new_sink({"echo": "none"})
	dispatcher.register_handler("ping", Callable(sink, "handle"))

	var response: Dictionary = dispatcher.dispatch({
		"jsonrpc": "2.0",
		"method": "ping",
		"id": 1,
	})

	assert_eq(sink.call_count, 1, "Handler must be invoked when params is absent")
	assert_true(sink.received_params is Dictionary, "Handler must receive a Dictionary default when params is absent")
	assert_eq((sink.received_params as Dictionary).size(), 0, "Default params must be an empty Dictionary")
	assert_eq(response.get("result", null), {"echo": "none"}, "Dispatcher must wrap the handler return value as result")


# ---------------------------------------------------------------------------
# 10) `id` of Dictionary type -> -32600 Invalid Request
# ---------------------------------------------------------------------------

func test_rejects_invalid_id_type() -> void:
	var dispatcher: Object = _new_dispatcher()

	var response: Dictionary = dispatcher.dispatch({
		"jsonrpc": "2.0",
		"method": "ping",
		"id": {"bad": "id"},
	})

	var error: Dictionary = response.get("error", {})
	assert_eq(error.get("code", 0), -32600, "Dictionary id must yield Invalid Request (-32600)")


# ---------------------------------------------------------------------------
# 11) Broken JSON string -> -32700 Parse error with id: null
# ---------------------------------------------------------------------------

func test_parse_error_returns_minus_32700_with_null_id() -> void:
	var dispatcher: Object = _new_dispatcher()

	var response: Dictionary = dispatcher.dispatch("{ this is not valid json ")

	assert_eq(response.get("jsonrpc", ""), "2.0", "Parse-error envelope must declare jsonrpc 2.0")
	var error: Dictionary = response.get("error", {})
	assert_eq(error.get("code", 0), -32700, "Broken JSON must yield Parse error (-32700)")
	assert_true(response.has("id"), "Parse-error envelope must include an id field")
	assert_eq(response.get("id"), null, "Parse-error envelope must set id to null")


# ---------------------------------------------------------------------------
# 12) Unknown method -> -32601 Method not found with a non-empty suggestion.
# ---------------------------------------------------------------------------

func test_method_not_found_returns_minus_32601_with_suggestion() -> void:
	var dispatcher: Object = _new_dispatcher()
	dispatcher.register_handler("ping", Callable(_new_sink(), "handle"))
	dispatcher.register_handler("pong", Callable(_new_sink(), "handle"))

	var response: Dictionary = dispatcher.dispatch({
		"jsonrpc": "2.0",
		"method": "does.not.exist",
		"id": 7,
	})

	var error: Dictionary = response.get("error", {})
	assert_eq(error.get("code", 0), -32601, "Unknown method must yield Method not found (-32601)")
	var data: Dictionary = error.get("data", {})
	var suggestion: String = data.get("suggestion", "")
	assert_false(suggestion.is_empty(), "Method-not-found data.suggestion must be a non-empty String")
	assert_true(suggestion.contains("ping") or suggestion.contains("pong"), "Suggestion should reference at least one registered method")


# ---------------------------------------------------------------------------
# 13) Registered handler is invoked and its return value is wrapped.
# ---------------------------------------------------------------------------

func test_registered_handler_is_invoked_and_result_wrapped() -> void:
	var dispatcher: Object = _new_dispatcher()
	var sink: HandlerSink = _new_sink({"value": 99})
	dispatcher.register_handler("compute", Callable(sink, "handle"))

	var response: Dictionary = dispatcher.dispatch({
		"jsonrpc": "2.0",
		"method": "compute",
		"params": {},
		"id": "abc",
	})

	assert_eq(sink.call_count, 1, "Registered handler must be invoked exactly once")
	assert_eq(response.get("jsonrpc", ""), "2.0", "Result envelope must declare jsonrpc 2.0")
	assert_eq(response.get("id", null), "abc", "Result envelope must echo the request id")
	assert_eq(response.get("result", null), {"value": 99}, "Result envelope must wrap the handler return value")
	assert_false(response.has("error"), "Successful result envelope must not include an 'error' field")


# ---------------------------------------------------------------------------
# 14) Notification (id absent) on success: dispatcher returns an empty
#     dictionary, not a `result` envelope.
# ---------------------------------------------------------------------------

func test_notification_without_id_does_not_return_result_envelope_on_success() -> void:
	var dispatcher: Object = _new_dispatcher()
	var sink: HandlerSink = _new_sink({"ignored": true})
	dispatcher.register_handler("notify", Callable(sink, "handle"))

	var response: Dictionary = dispatcher.dispatch({
		"jsonrpc": "2.0",
		"method": "notify",
		"params": {},
	})

	assert_eq(sink.call_count, 1, "Notification handler must still be invoked")
	assert_false(response.has("result"), "Successful notification must not return a result envelope")
	assert_false(response.has("error"), "Successful notification must not return an error envelope")


# ---------------------------------------------------------------------------
# 15) Error envelope echoes a valid id when present; defaults to null when
#     the id itself is invalid or missing.
# ---------------------------------------------------------------------------

func test_error_envelope_echoes_id_when_possible_else_null() -> void:
	var dispatcher: Object = _new_dispatcher()

	# Echoes the request id when it is a valid scalar, even if another field
	# (here: method) is invalid.
	var with_id: Dictionary = dispatcher.dispatch({
		"jsonrpc": "2.0",
		"method": "",
		"id": 42,
	})
	assert_true(with_id.has("id"), "Error envelope must include an id field")
	assert_eq(with_id.get("id"), 42, "Error envelope must echo the request id when it is a valid scalar")

	# When the id itself fails validation, the envelope must fall back to
	# null rather than propagate an invalid value.
	var bad_id: Dictionary = dispatcher.dispatch({
		"jsonrpc": "2.0",
		"method": "ping",
		"id": {"bad": "id"},
	})
	assert_true(bad_id.has("id"), "Error envelope must include an id field even when the request id was invalid")
	assert_eq(bad_id.get("id"), null, "Error envelope must set id to null when the request id is invalid")


# ---------------------------------------------------------------------------
# 16) Error data.suggestion is present and non-empty for every validation
#     failure path, so callers always get an actionable hint.
# ---------------------------------------------------------------------------

func test_error_data_suggestion_is_present_and_non_empty() -> void:
	var dispatcher: Object = _new_dispatcher()

	var responses: Array = [
		dispatcher.dispatch({"method": "ping", "id": 1}),                                      # missing jsonrpc
		dispatcher.dispatch({"jsonrpc": "1.0", "method": "ping", "id": 1}),                    # wrong version
		dispatcher.dispatch({"jsonrpc": "2.0", "id": 1}),                                      # missing method
		dispatcher.dispatch({"jsonrpc": "2.0", "method": "ping", "params": 3, "id": 1}),       # bad params
		dispatcher.dispatch({"jsonrpc": "2.0", "method": "nope", "id": 1}),                    # unknown method
		dispatcher.dispatch("{ broken "),                                                      # parse error
	]

	for i in range(responses.size()):
		var response: Dictionary = responses[i]
		var error: Dictionary = response.get("error", {})
		assert_true(error.has("data"), "Response %d must include error.data" % i)
		var data: Dictionary = error.get("data", {})
		var suggestion: String = data.get("suggestion", "")
		assert_false(suggestion.is_empty(), "Response %d must include a non-empty error.data.suggestion" % i)


# ---------------------------------------------------------------------------
# 17) Multi-handler dispatch: with several tools registered, a request for
#     method X only invokes handler X, and the other handlers remain
#     untouched. This is the "dispatch per tool" contract — it is what
#     makes it safe to register hundreds of MCP tools on the same
#     dispatcher instance.
# ---------------------------------------------------------------------------

func test_dispatch_routes_only_the_matching_handler() -> void:
	var dispatcher: Object = _new_dispatcher()

	var scene_open_sink: HandlerSink = _new_sink({"tool": "scene.open"})
	var node_add_sink: HandlerSink = _new_sink({"tool": "node.add"})
	var crafting_sink: HandlerSink = _new_sink({"tool": "crafting.execute"})

	dispatcher.register_handler("scene.open", Callable(scene_open_sink, "handle"))
	dispatcher.register_handler("node.add", Callable(node_add_sink, "handle"))
	dispatcher.register_handler("crafting.execute", Callable(crafting_sink, "handle"))

	var response: Dictionary = dispatcher.dispatch({
		"jsonrpc": "2.0",
		"method": "node.add",
		"params": {"scene_path": "res://levels/forest.tscn", "parent_path": "/root/Forest", "type": "Node3D", "name": "Waypoint"},
		"id": 11,
	})

	assert_eq(node_add_sink.call_count, 1, "Request for 'node.add' must invoke the node.add handler exactly once")
	assert_eq(scene_open_sink.call_count, 0, "Unrelated handler 'scene.open' must not be invoked")
	assert_eq(crafting_sink.call_count, 0, "Unrelated handler 'crafting.execute' must not be invoked")
	assert_eq(response.get("result", null), {"tool": "node.add"}, "Result envelope must carry the matching handler's return value")


# ---------------------------------------------------------------------------
# 18) Params are forwarded verbatim to each per-tool handler — the
#     dispatcher must not merge, mutate, or share state across handlers.
# ---------------------------------------------------------------------------

func test_dispatch_forwards_per_tool_params_without_cross_contamination() -> void:
	var dispatcher: Object = _new_dispatcher()

	var add_sink: HandlerSink = _new_sink({"ok": "add"})
	var remove_sink: HandlerSink = _new_sink({"ok": "remove"})
	dispatcher.register_handler("inventory.add_item", Callable(add_sink, "handle"))
	dispatcher.register_handler("inventory.remove_item", Callable(remove_sink, "handle"))

	var _add_response: Dictionary = dispatcher.dispatch({
		"jsonrpc": "2.0",
		"method": "inventory.add_item",
		"params": {"item_id": "iron_ore", "amount": 2},
		"id": 1,
	})
	var _remove_response: Dictionary = dispatcher.dispatch({
		"jsonrpc": "2.0",
		"method": "inventory.remove_item",
		"params": {"item_id": "iron_ingot", "amount": 1},
		"id": 2,
	})

	assert_eq(add_sink.call_count, 1, "inventory.add_item handler must be invoked exactly once")
	assert_eq(remove_sink.call_count, 1, "inventory.remove_item handler must be invoked exactly once")

	var add_params: Dictionary = add_sink.received_params as Dictionary
	var remove_params: Dictionary = remove_sink.received_params as Dictionary
	assert_eq(add_params.get("item_id", ""), "iron_ore", "add_item handler must receive its own item_id")
	assert_eq(add_params.get("amount", 0), 2, "add_item handler must receive its own amount")
	assert_eq(remove_params.get("item_id", ""), "iron_ingot", "remove_item handler must receive its own item_id")
	assert_eq(remove_params.get("amount", 0), 1, "remove_item handler must receive its own amount")


# ---------------------------------------------------------------------------
# 19) unregister_handler() makes a previously-registered method unroutable:
#     subsequent requests for it yield -32601 Method not found, while the
#     remaining handlers continue to dispatch normally.
# ---------------------------------------------------------------------------

func test_unregister_handler_makes_method_unroutable_without_affecting_others() -> void:
	var dispatcher: Object = _new_dispatcher()

	var kept_sink: HandlerSink = _new_sink({"tool": "kept"})
	var removed_sink: HandlerSink = _new_sink({"tool": "removed"})
	dispatcher.register_handler("kept.method", Callable(kept_sink, "handle"))
	dispatcher.register_handler("removed.method", Callable(removed_sink, "handle"))

	dispatcher.unregister_handler("removed.method")

	var removed_response: Dictionary = dispatcher.dispatch({
		"jsonrpc": "2.0",
		"method": "removed.method",
		"params": {},
		"id": 1,
	})
	var kept_response: Dictionary = dispatcher.dispatch({
		"jsonrpc": "2.0",
		"method": "kept.method",
		"params": {},
		"id": 2,
	})

	var removed_error: Dictionary = removed_response.get("error", {})
	assert_eq(int(removed_error.get("code", 0)), -32601, "Unregistered method must now yield Method not found (-32601)")
	assert_eq(removed_sink.call_count, 0, "The unregistered handler must not be invoked")

	assert_eq(kept_sink.call_count, 1, "The remaining handler must still be reachable")
	assert_eq(kept_response.get("result", null), {"tool": "kept"}, "The remaining handler's return value must be wrapped as result")


# ---------------------------------------------------------------------------
# 20) Re-registering the same method replaces the previous handler. The
#     dispatcher must route subsequent requests to the new handler and
#     never to the old one.
# ---------------------------------------------------------------------------

func test_register_handler_overwrites_previous_handler_for_same_method() -> void:
	var dispatcher: Object = _new_dispatcher()

	var old_sink: HandlerSink = _new_sink({"version": "old"})
	var new_sink: HandlerSink = _new_sink({"version": "new"})

	dispatcher.register_handler("tool.v", Callable(old_sink, "handle"))
	dispatcher.register_handler("tool.v", Callable(new_sink, "handle"))

	var response: Dictionary = dispatcher.dispatch({
		"jsonrpc": "2.0",
		"method": "tool.v",
		"params": {},
		"id": 1,
	})

	assert_eq(old_sink.call_count, 0, "Overwritten handler must not be invoked")
	assert_eq(new_sink.call_count, 1, "Replacement handler must be invoked exactly once")
	assert_eq(response.get("result", null), {"version": "new"}, "Result envelope must carry the replacement handler's return value")
