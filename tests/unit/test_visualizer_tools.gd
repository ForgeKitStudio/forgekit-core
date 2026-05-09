extends GutTest
## Unit tests for McpVisualizerTools: JSON-RPC handler adapter that
## exposes the five visualizer MCP tools on top of an injected
## McpVisualizerHttpServer instance.
##
## Tools:
##   visualizer.start(port?)                     → {url, port, already_running?}
##   visualizer.stop()                           → {stopped: true}
##   visualizer.render_scene_tree(scene_path?, format?)
##   visualizer.render_module_graph(format?)
##   visualizer.render_event_bus(format?)
##
## The HTTP server is injected so every tool can be exercised without
## opening a real TCP socket. The fake server records calls and returns
## canned documents.


const VISUALIZER_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/tools/visualizer_tools.gd")
const DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")


# ---------------------------------------------------------------------------
# FakeHttpServer — records invocations and hands back canned documents.
# ---------------------------------------------------------------------------

class FakeHttpServer:
	extends RefCounted

	var calls: Array = []
	var _is_listening: bool = false
	var _port: int = -1
	var port_range_start: int = 6030
	var port_range_end: int = 6039

	# Canned documents returned from the "_build_*_document" hooks.
	var scene_tree_doc: Dictionary = {"nodes": [], "edges": []}
	var module_graph_doc: Dictionary = {"nodes": [], "edges": []}
	var event_bus_doc: Dictionary = {"signals": []}

	# When set, start() returns this port; otherwise picks port_range_start.
	var start_result_port: int = -1

	func start() -> Dictionary:
		calls.append({"op": "start"})
		_is_listening = true
		_port = start_result_port if start_result_port != -1 else port_range_start
		return {"ok": true, "port": _port, "bind_address": "127.0.0.1"}

	func stop() -> void:
		calls.append({"op": "stop"})
		_is_listening = false
		_port = -1

	func is_listening() -> bool:
		return _is_listening

	func get_port() -> int:
		return _port

	func _build_scene_tree_document() -> Dictionary:
		calls.append({"op": "_build_scene_tree_document"})
		return scene_tree_doc

	func _build_module_graph_document() -> Dictionary:
		calls.append({"op": "_build_module_graph_document"})
		return module_graph_doc

	func _build_event_bus_document() -> Dictionary:
		calls.append({"op": "_build_event_bus_document"})
		return event_bus_doc


func _new_env() -> Dictionary:
	var server: FakeHttpServer = FakeHttpServer.new()
	var tools: Object = VISUALIZER_TOOLS_SCRIPT.new(server)
	return {"server": server, "tools": tools}


# ---------------------------------------------------------------------------
# visualizer.start — returns url + port, records already_running on repeat
# ---------------------------------------------------------------------------

func test_start_returns_url_and_port() -> void:
	var env: Dictionary = _new_env()
	var result: Variant = env["tools"].start({})
	var dict: Dictionary = result as Dictionary
	assert_eq(int(dict.get("port", -1)), 6030, "port must echo the server's chosen port")
	assert_eq(String(dict.get("url", "")), "http://127.0.0.1:6030", "url must embed the chosen port")


func test_start_returns_already_running_on_second_call() -> void:
	var env: Dictionary = _new_env()
	var _first: Variant = env["tools"].start({})
	var second: Variant = env["tools"].start({})
	var dict: Dictionary = second as Dictionary
	assert_true(dict.get("already_running", false), "second start() must return already_running=true")
	assert_eq(int(dict.get("port", -1)), 6030, "port must still echo the running port")


func test_start_forces_single_port_when_port_override_given() -> void:
	var env: Dictionary = _new_env()
	var server: FakeHttpServer = env["server"]
	server.start_result_port = 6035
	var _result: Variant = env["tools"].start({"port": 6035})
	assert_eq(server.port_range_start, 6035, "port override must set port_range_start")
	assert_eq(server.port_range_end, 6035, "port override must set port_range_end")


# ---------------------------------------------------------------------------
# visualizer.stop
# ---------------------------------------------------------------------------

func test_stop_returns_stopped_true() -> void:
	var env: Dictionary = _new_env()
	var _ignored: Variant = env["tools"].start({})
	var result: Variant = env["tools"].stop({})
	var dict: Dictionary = result as Dictionary
	assert_true(dict.get("stopped", false), "stop() must return stopped=true")
	var server: FakeHttpServer = env["server"]
	assert_false(server.is_listening(), "server must no longer be listening after stop()")


# ---------------------------------------------------------------------------
# visualizer.render_scene_tree
# ---------------------------------------------------------------------------

func test_render_scene_tree_json_returns_document_verbatim() -> void:
	var env: Dictionary = _new_env()
	var server: FakeHttpServer = env["server"]
	server.scene_tree_doc = {
		"nodes": [{"id": "/root/Main", "label": "Main", "type": "Node"}],
		"edges": [],
	}
	var result: Variant = env["tools"].render_scene_tree({"format": "json"})
	var dict: Dictionary = result as Dictionary
	assert_true(dict.has("nodes"), "json render must echo nodes")
	assert_true(dict.has("edges"), "json render must echo edges")
	assert_eq((dict.get("nodes", []) as Array).size(), 1, "node count preserved")


func test_render_scene_tree_default_format_is_json() -> void:
	var env: Dictionary = _new_env()
	var server: FakeHttpServer = env["server"]
	server.scene_tree_doc = {"nodes": [], "edges": []}
	var result: Variant = env["tools"].render_scene_tree({})
	var dict: Dictionary = result as Dictionary
	assert_true(dict.has("nodes"), "default format must be json")


func test_render_scene_tree_svg_returns_svg_markup() -> void:
	var env: Dictionary = _new_env()
	var server: FakeHttpServer = env["server"]
	server.scene_tree_doc = {
		"nodes": [
			{"id": "/root/Main", "label": "Main", "type": "Node"},
			{"id": "/root/Main/Child", "label": "Child", "type": "Node"},
		],
		"edges": [{"from": "/root/Main", "to": "/root/Main/Child"}],
	}
	var result: Variant = env["tools"].render_scene_tree({"format": "svg"})
	var dict: Dictionary = result as Dictionary
	var svg: String = String(dict.get("svg", ""))
	assert_true(svg.contains("<svg"), "svg render must contain an <svg root element")
	assert_true(svg.contains("Main"), "svg markup must contain the node labels")
	assert_true(svg.contains("Child"), "svg markup must contain every node label")


# ---------------------------------------------------------------------------
# visualizer.render_module_graph
# ---------------------------------------------------------------------------

func test_render_module_graph_json_returns_document() -> void:
	var env: Dictionary = _new_env()
	var server: FakeHttpServer = env["server"]
	server.module_graph_doc = {
		"nodes": [
			{"id": "forgekit_core", "version": "0.5.0", "depends_on": []},
			{"id": "forgekit_rpg", "version": "0.4.0", "depends_on": ["forgekit_core"]},
		],
		"edges": [{"from": "forgekit_rpg", "to": "forgekit_core"}],
	}
	var result: Variant = env["tools"].render_module_graph({"format": "json"})
	var dict: Dictionary = result as Dictionary
	assert_eq((dict.get("nodes", []) as Array).size(), 2, "module count preserved")
	assert_eq((dict.get("edges", []) as Array).size(), 1, "dependency count preserved")


func test_render_module_graph_svg_returns_markup() -> void:
	var env: Dictionary = _new_env()
	var server: FakeHttpServer = env["server"]
	server.module_graph_doc = {
		"nodes": [{"id": "forgekit_core", "version": "0.5.0", "depends_on": []}],
		"edges": [],
	}
	var result: Variant = env["tools"].render_module_graph({"format": "svg"})
	var dict: Dictionary = result as Dictionary
	var svg: String = String(dict.get("svg", ""))
	assert_true(svg.contains("<svg"), "svg output must start with an <svg element")
	assert_true(svg.contains("forgekit_core"), "svg must contain the module id")


# ---------------------------------------------------------------------------
# visualizer.render_event_bus
# ---------------------------------------------------------------------------

func test_render_event_bus_json_returns_document() -> void:
	var env: Dictionary = _new_env()
	var server: FakeHttpServer = env["server"]
	server.event_bus_doc = {
		"signals": [
			{"name": "item_added", "subscribers": [{"object_class": "Inventory", "method": "_on_added"}]},
		],
	}
	var result: Variant = env["tools"].render_event_bus({"format": "json"})
	var dict: Dictionary = result as Dictionary
	assert_eq((dict.get("signals", []) as Array).size(), 1, "signals list passed through")


func test_render_event_bus_svg_returns_markup() -> void:
	var env: Dictionary = _new_env()
	var server: FakeHttpServer = env["server"]
	server.event_bus_doc = {
		"signals": [
			{"name": "item_added", "subscribers": [{"object_class": "Inventory", "method": "_on_added"}]},
		],
	}
	var result: Variant = env["tools"].render_event_bus({"format": "svg"})
	var dict: Dictionary = result as Dictionary
	var svg: String = String(dict.get("svg", ""))
	assert_true(svg.contains("<svg"), "svg output must start with an <svg element")
	assert_true(svg.contains("item_added"), "svg must contain the signal name")


# ---------------------------------------------------------------------------
# register_on — wires all five visualizer methods on the dispatcher
# ---------------------------------------------------------------------------

func test_register_on_wires_all_five_visualizer_methods() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var dispatcher: Object = DISPATCHER_SCRIPT.new()

	tools.register_on(dispatcher)

	var expected: Array = [
		{"method": "visualizer.start", "params": {}},
		{"method": "visualizer.render_scene_tree", "params": {}},
		{"method": "visualizer.render_module_graph", "params": {}},
		{"method": "visualizer.render_event_bus", "params": {}},
		{"method": "visualizer.stop", "params": {}},
	]
	assert_eq(expected.size(), 5, "Visualizer MCP surface must be five methods")

	var req_id: int = 1
	for entry in expected:
		var e: Dictionary = entry
		var response: Dictionary = dispatcher.dispatch({
			"jsonrpc": "2.0",
			"method": e["method"],
			"params": e["params"],
			"id": req_id,
		})
		assert_true(response.has("result"), "Method %s must be reachable via dispatcher" % e["method"])
		assert_false(response.has("error"), "Method %s must not produce a dispatcher error" % e["method"])
		req_id += 1
