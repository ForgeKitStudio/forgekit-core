extends GutTest
## Unit tests for McpVisualizerHttpServer: port scanning across 6030-6039,
## the EXTERNAL_BIND_ENABLED push_warning for non-loopback binds, default
## state, stop() port release, and the atomic active-port file write
## (temp-file + rename, merge with sibling keys, recovery on rename failure).

const VISUALIZER_HTTP_SERVER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/visualizer/http_server.gd")

const PORT_RANGE_START: int = 6030
const PORT_RANGE_END: int = 6039
const LOOPBACK: String = "127.0.0.1"
const ACTIVE_PORT_FILE: String = "user://mcp_active_port.json"
const ACTIVE_PORT_TMP: String = "user://mcp_active_port.json.tmp"


# ---------------------------------------------------------------------------
# RenameRecorder — records every rename call routed through the atomic
# active-port writer, and optionally forces a failure so tests can verify
# the recovery path without mutating the real filesystem.
# ---------------------------------------------------------------------------

class RenameRecorder:
	extends RefCounted

	var calls: Array = []
	var force_error: int = OK

	func rename(from_path: String, to_path: String) -> int:
		calls.append({"from": from_path, "to": to_path})
		if force_error != OK:
			return force_error
		return DirAccess.rename_absolute(from_path, to_path)


var _blockers: Array = []
var _server: Object = null
# Keep the recorder alive for the full test lifecycle so after_each's stop()
# path does not reference a freed Callable target.
var _rename_recorder: Object = null


func before_each() -> void:
	_blockers = []
	_server = null
	_rename_recorder = null
	_remove_active_port_files()


func after_each() -> void:
	if _server != null and _server.has_method("stop"):
		_server.stop()
	_server = null
	_rename_recorder = null
	for blocker in _blockers:
		(blocker as TCPServer).stop()
	_blockers.clear()
	_remove_active_port_files()


func _remove_active_port_files() -> void:
	if FileAccess.file_exists(ACTIVE_PORT_FILE):
		DirAccess.remove_absolute(ACTIVE_PORT_FILE)
	if FileAccess.file_exists(ACTIVE_PORT_TMP):
		DirAccess.remove_absolute(ACTIVE_PORT_TMP)


func _read_active_port_file() -> Dictionary:
	if not FileAccess.file_exists(ACTIVE_PORT_FILE):
		return {}
	var file: FileAccess = FileAccess.open(ACTIVE_PORT_FILE, FileAccess.READ)
	var text: String = file.get_as_text()
	file.close()
	var parsed: Variant = JSON.parse_string(text)
	return parsed as Dictionary if parsed is Dictionary else {}


func _write_active_port_file(data: Dictionary) -> void:
	var file: FileAccess = FileAccess.open(ACTIVE_PORT_FILE, FileAccess.WRITE)
	file.store_string(JSON.stringify(data))
	file.close()


func _read_raw_file(path: String) -> String:
	var file: FileAccess = FileAccess.open(path, FileAccess.READ)
	var text: String = file.get_as_text()
	file.close()
	return text


func _occupy_ports(ports: Array) -> void:
	for p in ports:
		var srv: TCPServer = TCPServer.new()
		var err: int = srv.listen(int(p), LOOPBACK)
		assert_eq(err, OK, "Failed to pre-occupy port %d in test setup" % int(p))
		_blockers.append(srv)


func _new_server() -> Object:
	return VISUALIZER_HTTP_SERVER_SCRIPT.new()


func test_start_picks_first_free_port_in_range() -> void:
	_occupy_ports([PORT_RANGE_START])
	_server = _new_server()
	var result: Dictionary = _server.start()
	assert_true(result.get("ok", false), "start() must succeed when at least one port in the range is free")
	assert_eq(result.get("port", -1), PORT_RANGE_START + 1, "Scanner must skip the occupied port and pick the next one")
	assert_eq(result.get("bind_address", ""), LOOPBACK, "Result must echo the bind_address")
	assert_true(_server.is_listening(), "Server must report is_listening()==true after a successful start")
	assert_eq(_server.get_port(), PORT_RANGE_START + 1, "get_port() must return the chosen port")


func test_start_fails_when_all_ports_in_use() -> void:
	var full_range: Array = []
	for p in range(PORT_RANGE_START, PORT_RANGE_END + 1):
		full_range.append(p)
	_occupy_ports(full_range)
	_server = _new_server()
	var result: Dictionary = _server.start()
	assert_false(result.get("ok", true), "start() must fail when every port in the range is occupied")
	assert_eq(result.get("error", ""), "all_ports_in_use", "Error code must be 'all_ports_in_use'")
	assert_false(_server.is_listening(), "Server must not be listening after a failed start")
	assert_eq(_server.get_port(), -1, "get_port() must return -1 when the server is not listening")
	var tried: Array = result.get("tried", [])
	assert_eq(tried.size(), full_range.size(), "tried must list every port that was probed")
	for i in range(full_range.size()):
		assert_eq(int(tried[i]), int(full_range[i]), "tried[%d] must match the probed port" % i)


func test_default_bind_address_is_loopback() -> void:
	_server = _new_server()
	assert_eq(_server.get_bind_address(), LOOPBACK, "Default bind_address must be 127.0.0.1")
	assert_false(_server.is_listening(), "A freshly constructed server must not be listening")
	assert_eq(_server.get_port(), -1, "get_port() must be -1 before start()")


func test_external_bind_emits_warning() -> void:
	_server = _new_server()
	_server.bind_address = "0.0.0.0"
	var _result: Dictionary = _server.start()
	assert_push_warning("EXTERNAL_BIND_ENABLED", "A push_warning containing EXTERNAL_BIND_ENABLED must be emitted for non-loopback binds")
	assert_push_warning_count(1, "Exactly one push_warning must be emitted for a non-loopback bind")


func test_stop_releases_port() -> void:
	_server = _new_server()
	var result: Dictionary = _server.start()
	assert_true(result.get("ok", false), "start() must succeed in this scenario")
	var chosen_port: int = int(result.get("port", 0))
	assert_true(_server.is_listening(), "Server must be listening before stop()")
	_server.stop()
	assert_false(_server.is_listening(), "is_listening() must return false after stop()")
	assert_eq(_server.get_port(), -1, "get_port() must return -1 after stop()")
	var probe: TCPServer = TCPServer.new()
	var err: int = probe.listen(chosen_port, LOOPBACK)
	assert_eq(err, OK, "stop() must release the bound port so a fresh TCPServer can re-bind it")
	probe.stop()


# ---------------------------------------------------------------------------
# Active-port file integration — the server must record the chosen
# visualizer HTTP port under the `visualizer` key in
# user://mcp_active_port.json, atomically, while preserving any sibling
# keys written by the editor / runtime / health endpoints.
# ---------------------------------------------------------------------------

func test_start_writes_chosen_port_under_visualizer_key() -> void:
	_server = _new_server()

	var result: Dictionary = _server.start()
	assert_true(result.get("ok", false), "start() must succeed in this scenario")
	var chosen_port: int = int(result.get("port", -1))

	var data: Dictionary = _read_active_port_file()
	assert_eq(int(data.get("visualizer", -1)), chosen_port, "Active port file must record the chosen visualizer port under the 'visualizer' key")


func test_start_merges_with_sibling_entries() -> void:
	_write_active_port_file({
		"editor": 6012,
		"runtime": 6024,
	})
	_server = _new_server()

	var result: Dictionary = _server.start()
	assert_true(result.get("ok", false), "start() must succeed in this scenario")
	var chosen_port: int = int(result.get("port", -1))

	var data: Dictionary = _read_active_port_file()
	assert_eq(int(data.get("visualizer", -1)), chosen_port, "Visualizer port must be inserted into the active-port file")
	assert_eq(int(data.get("editor", -1)), 6012, "Pre-existing editor key must be preserved")
	assert_eq(int(data.get("runtime", -1)), 6024, "Pre-existing runtime key must be preserved")


func test_start_uses_tmp_sidecar_and_rename() -> void:
	_rename_recorder = RenameRecorder.new()
	var recorder: RenameRecorder = _rename_recorder as RenameRecorder
	_server = _new_server()
	_server.set_renamer(Callable(recorder, "rename"))

	var result: Dictionary = _server.start()
	assert_true(result.get("ok", false), "start() must succeed in this scenario")

	assert_eq(recorder.calls.size(), 1, "Exactly one rename must be performed when writing the active-port file")
	var call: Dictionary = recorder.calls[0]
	assert_eq(String(call.get("from", "")), ACTIVE_PORT_TMP, "Rename source must be the sibling .tmp file")
	assert_eq(String(call.get("to", "")), ACTIVE_PORT_FILE, "Rename target must be the active-port file")


func test_start_recovers_when_rename_fails() -> void:
	var original: Dictionary = {"editor": 6010, "runtime": 6020}
	_write_active_port_file(original)
	var original_bytes: String = _read_raw_file(ACTIVE_PORT_FILE)

	_rename_recorder = RenameRecorder.new()
	var recorder: RenameRecorder = _rename_recorder as RenameRecorder
	recorder.force_error = FAILED
	_server = _new_server()
	_server.set_renamer(Callable(recorder, "rename"))

	var _result: Dictionary = _server.start()

	# Existing file must be byte-for-byte intact.
	var after_bytes: String = _read_raw_file(ACTIVE_PORT_FILE)
	assert_eq(after_bytes, original_bytes, "Existing active-port file must be byte-for-byte unchanged when the rename fails")

	# Temp sidecar must be cleaned up.
	assert_false(FileAccess.file_exists(ACTIVE_PORT_TMP), "Temp sidecar must be removed after a failed rename")

	# A push_warning explaining the failure must be emitted.
	assert_push_warning("ACTIVE_PORT_FILE_WRITE_FAILED", "A push_warning containing ACTIVE_PORT_FILE_WRITE_FAILED must be emitted when the atomic write fails")


func test_start_ignores_corrupt_active_port_file() -> void:
	var file: FileAccess = FileAccess.open(ACTIVE_PORT_FILE, FileAccess.WRITE)
	file.store_string("not json{")
	file.close()
	_server = _new_server()

	var result: Dictionary = _server.start()
	assert_true(result.get("ok", false), "start() must succeed even when the active-port file is corrupt")
	var chosen_port: int = int(result.get("port", -1))

	var data: Dictionary = _read_active_port_file()
	assert_eq(data.size(), 1, "Corrupt file must be replaced with a dictionary containing only the visualizer key")
	assert_eq(int(data.get("visualizer", -1)), chosen_port, "Corrupt file must be replaced with {\"visualizer\": <chosen_port>}")


# ---------------------------------------------------------------------------
# HTTP request handling (task 5.1.3): static HTML page + JSON scene-tree API
# backed by an injectable scene provider Callable. The server exposes a
# non-blocking poll() method that accepts pending connections and services
# fully-buffered HTTP/1.1 GET requests.
# ---------------------------------------------------------------------------

const _POLL_BUDGET_ITERATIONS: int = 200


## Synthetic nodes held across a single test so after_each can free them.
var _synthetic_nodes: Array = []


func _new_detached_node(name: String) -> Node:
	var node: Node = Node.new()
	node.name = name
	_synthetic_nodes.append(node)
	return node


func _free_synthetic_nodes() -> void:
	for n in _synthetic_nodes:
		if is_instance_valid(n):
			# Detached Nodes (never added to any SceneTree) are freed with
			# free() directly. queue_free() would be a no-op here because
			# there is no SceneTree to service the deferred queue.
			(n as Node).free()
	_synthetic_nodes.clear()


func _tear_down_synthetic_nodes() -> void:
	_free_synthetic_nodes()


func _make_scene_provider(root: Node) -> Callable:
	# The provider contract accepted by set_scene_provider(): a Callable
	# returning the current scene root Node, or null when none is available.
	return func() -> Node:
		return root


## Open a TCP client and dispatch a GET request, driving the server's
## poll() loop until the response bytes arrive, then parse the reply into
## { status: int, headers: Dictionary, body: String }.
func _http_get(server: Object, path: String) -> Dictionary:
	var port: int = server.get_port()
	var client: StreamPeerTCP = StreamPeerTCP.new()
	var connect_err: int = client.connect_to_host(LOOPBACK, port)
	assert_eq(connect_err, OK, "Client must be able to connect to 127.0.0.1:%d" % port)

	# Drive the client socket until the OS reports STATUS_CONNECTED.
	for _i in range(_POLL_BUDGET_ITERATIONS):
		client.poll()
		if client.get_status() == StreamPeerTCP.STATUS_CONNECTED:
			break
		server.poll()

	var request: String = "GET %s HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n" % path
	var bytes: PackedByteArray = request.to_utf8_buffer()
	var put_err: int = client.put_data(bytes)
	assert_eq(put_err, OK, "Client must be able to write the request body")

	var received: PackedByteArray = PackedByteArray()
	for _i in range(_POLL_BUDGET_ITERATIONS):
		server.poll()
		client.poll()
		var client_status: int = client.get_status()
		if client_status == StreamPeerTCP.STATUS_CONNECTED or client_status == StreamPeerTCP.STATUS_CONNECTING:
			var available: int = client.get_available_bytes()
			if available > 0:
				var chunk_result: Array = client.get_data(available)
				if int(chunk_result[0]) == OK:
					received.append_array(chunk_result[1] as PackedByteArray)
		else:
			# Peer hung up. Drain whatever the socket buffered before the
			# FIN arrived, then stop.
			break
	client.disconnect_from_host()

	var text: String = received.get_string_from_utf8()
	var header_end: int = text.find("\r\n\r\n")
	assert_ne(header_end, -1, "Response must contain a CRLFCRLF header/body separator: got %d bytes" % text.length())

	var header_block: String = text.substr(0, header_end)
	var body: String = text.substr(header_end + 4)

	var lines: PackedStringArray = header_block.split("\r\n")
	var status_line: String = lines[0]
	var status_parts: PackedStringArray = status_line.split(" ")
	var status_code: int = int(status_parts[1]) if status_parts.size() >= 2 else 0

	var headers: Dictionary = {}
	for i in range(1, lines.size()):
		var colon: int = lines[i].find(":")
		if colon == -1:
			continue
		var key: String = lines[i].substr(0, colon).strip_edges().to_lower()
		var val: String = lines[i].substr(colon + 1).strip_edges()
		headers[key] = val

	return {"status": status_code, "headers": headers, "body": body}


func test_http_get_root_returns_html_page() -> void:
	_server = _new_server()
	var start_result: Dictionary = _server.start()
	assert_true(start_result.get("ok", false), "start() must succeed in this scenario")

	var response: Dictionary = _http_get(_server, "/")

	assert_eq(int(response.get("status", 0)), 200, "GET / must return 200 OK")
	var content_type: String = String(response.get("headers", {}).get("content-type", ""))
	assert_true(content_type.begins_with("text/html"), "GET / must set Content-Type: text/html (got %s)" % content_type)
	var body: String = String(response.get("body", ""))
	assert_true(body.contains("<svg"), "GET / body must contain an inline <svg element")
	assert_true(body.contains("/api/scene_tree"), "GET / body must reference /api/scene_tree endpoint")
	assert_true(body.contains("/api/module_graph"), "GET / body must reference /api/module_graph endpoint")
	assert_true(body.contains("/api/event_bus"), "GET / body must reference /api/event_bus endpoint")
	_tear_down_synthetic_nodes()


func test_http_get_scene_tree_empty_when_no_provider() -> void:
	_server = _new_server()
	var start_result: Dictionary = _server.start()
	assert_true(start_result.get("ok", false), "start() must succeed in this scenario")

	var response: Dictionary = _http_get(_server, "/api/scene_tree")

	assert_eq(int(response.get("status", 0)), 200, "GET /api/scene_tree must return 200 OK when no provider is set")
	var content_type: String = String(response.get("headers", {}).get("content-type", ""))
	assert_true(content_type.begins_with("application/json"), "GET /api/scene_tree must set Content-Type: application/json (got %s)" % content_type)
	var parsed: Variant = JSON.parse_string(String(response.get("body", "")))
	assert_true(parsed is Dictionary, "Body must parse to a JSON object")
	var doc: Dictionary = parsed as Dictionary
	assert_true(doc.has("nodes"), "Response must contain a 'nodes' array")
	assert_true(doc.has("edges"), "Response must contain an 'edges' array")
	assert_eq((doc.get("nodes", []) as Array).size(), 0, "nodes must be empty when no provider is set")
	assert_eq((doc.get("edges", []) as Array).size(), 0, "edges must be empty when no provider is set")
	_tear_down_synthetic_nodes()


func test_http_get_scene_tree_serializes_node_hierarchy() -> void:
	# Root -> ChildA
	# Root -> ChildB -> Leaf  (4 nodes, 3 edges)
	var root: Node = _new_detached_node("Root")
	var child_a: Node = _new_detached_node("ChildA")
	var child_b: Node = _new_detached_node("ChildB")
	var leaf: Node = _new_detached_node("Leaf")
	root.add_child(child_a)
	root.add_child(child_b)
	child_b.add_child(leaf)

	_server = _new_server()
	_server.set_scene_provider(_make_scene_provider(root))
	var start_result: Dictionary = _server.start()
	assert_true(start_result.get("ok", false), "start() must succeed in this scenario")

	var response: Dictionary = _http_get(_server, "/api/scene_tree")
	assert_eq(int(response.get("status", 0)), 200, "GET /api/scene_tree must return 200 OK")

	var parsed: Variant = JSON.parse_string(String(response.get("body", "")))
	assert_true(parsed is Dictionary, "Body must parse to a JSON object")
	var doc: Dictionary = parsed as Dictionary
	var nodes: Array = doc.get("nodes", []) as Array
	var edges: Array = doc.get("edges", []) as Array
	assert_eq(nodes.size(), 4, "Hierarchy must serialize to exactly 4 nodes")
	assert_eq(edges.size(), 3, "Hierarchy must serialize to exactly 3 edges")

	# Each node must carry id / label / type with the right types and values.
	var ids: Array = []
	for n_raw in nodes:
		var n: Dictionary = n_raw as Dictionary
		assert_true(n.has("id"), "Each node must have an 'id' field")
		assert_true(n.has("label"), "Each node must have a 'label' field")
		assert_true(n.has("type"), "Each node must have a 'type' field")
		assert_eq(String(n.get("type", "")), "Node", "Synthetic Node instances must serialize with type=Node")
		ids.append(String(n.get("id", "")))
	var labels: Array = []
	for n_raw in nodes:
		labels.append(String((n_raw as Dictionary).get("label", "")))
	assert_true(labels.has("Root"), "Labels must include 'Root'")
	assert_true(labels.has("ChildA"), "Labels must include 'ChildA'")
	assert_true(labels.has("ChildB"), "Labels must include 'ChildB'")
	assert_true(labels.has("Leaf"), "Labels must include 'Leaf'")

	# Each edge references parent/child ids that are present in `nodes`.
	for e_raw in edges:
		var e: Dictionary = e_raw as Dictionary
		assert_true(e.has("from"), "Each edge must have a 'from' field")
		assert_true(e.has("to"), "Each edge must have a 'to' field")
		assert_true(ids.has(String(e.get("from", ""))), "Edge 'from' must reference a node id in the 'nodes' array")
		assert_true(ids.has(String(e.get("to", ""))), "Edge 'to' must reference a node id in the 'nodes' array")

	_tear_down_synthetic_nodes()


func test_http_get_unknown_path_returns_404() -> void:
	_server = _new_server()
	var start_result: Dictionary = _server.start()
	assert_true(start_result.get("ok", false), "start() must succeed in this scenario")

	var response: Dictionary = _http_get(_server, "/nope")

	assert_eq(int(response.get("status", 0)), 404, "Unknown path must return 404")
	assert_true(String(response.get("body", "")).contains("Not Found"), "404 body must contain 'Not Found'")
	_tear_down_synthetic_nodes()


func test_scene_tree_traversal_is_bounded() -> void:
	# Build a root with > 1000 direct children. The traversal cap is 1000.
	# A wide fan-out (rather than a deep linear chain) avoids the recursive
	# Node destructor overhead when the hierarchy is freed in after_each.
	var root: Node = _new_detached_node("Root")
	for i in range(1200):
		var child: Node = _new_detached_node("N%d" % i)
		root.add_child(child)

	_server = _new_server()
	_server.set_scene_provider(_make_scene_provider(root))
	var start_result: Dictionary = _server.start()
	assert_true(start_result.get("ok", false), "start() must succeed in this scenario")

	var response: Dictionary = _http_get(_server, "/api/scene_tree")
	assert_eq(int(response.get("status", 0)), 200, "GET /api/scene_tree must return 200 OK")

	var parsed: Variant = JSON.parse_string(String(response.get("body", "")))
	assert_true(parsed is Dictionary, "Body must parse to a JSON object")
	var doc: Dictionary = parsed as Dictionary
	var nodes: Array = doc.get("nodes", []) as Array
	assert_true(nodes.size() <= 1000, "Node list must be bounded to 1000 entries (got %d)" % nodes.size())
	assert_eq(bool(doc.get("truncated", false)), true, "truncated flag must be true when the cap is hit")

	_tear_down_synthetic_nodes()



# ---------------------------------------------------------------------------
# Module graph endpoint (task 5.1.4) — /api/module_graph
# Injected module-provider Callable returns Array[ModuleManifest]-like
# dictionaries (duck-typed) so tests do not need the real filesystem.
# ---------------------------------------------------------------------------

func _make_module_provider(modules: Array) -> Callable:
	return func() -> Array:
		return modules


func test_http_get_module_graph_empty_when_no_provider() -> void:
	_server = _new_server()
	var start_result: Dictionary = _server.start()
	assert_true(start_result.get("ok", false), "start() must succeed in this scenario")

	var response: Dictionary = _http_get(_server, "/api/module_graph")

	assert_eq(int(response.get("status", 0)), 200, "GET /api/module_graph must return 200 OK")
	var content_type: String = String(response.get("headers", {}).get("content-type", ""))
	assert_true(content_type.begins_with("application/json"), "GET /api/module_graph must set Content-Type: application/json")
	var parsed: Variant = JSON.parse_string(String(response.get("body", "")))
	assert_true(parsed is Dictionary, "Body must parse to a JSON object")
	var doc: Dictionary = parsed as Dictionary
	assert_eq((doc.get("nodes", []) as Array).size(), 0, "nodes must be empty when no module provider is set")
	assert_eq((doc.get("edges", []) as Array).size(), 0, "edges must be empty when no module provider is set")
	_tear_down_synthetic_nodes()


func test_http_get_module_graph_serializes_provider_output() -> void:
	var modules: Array = [
		{"id": "forgekit_core", "version": "0.5.0", "depends_on": []},
		{"id": "forgekit_rpg", "version": "0.4.0", "depends_on": ["forgekit_core"]},
	]
	_server = _new_server()
	_server.set_module_provider(_make_module_provider(modules))
	var start_result: Dictionary = _server.start()
	assert_true(start_result.get("ok", false), "start() must succeed in this scenario")

	var response: Dictionary = _http_get(_server, "/api/module_graph")
	assert_eq(int(response.get("status", 0)), 200, "GET /api/module_graph must return 200 OK")

	var parsed: Variant = JSON.parse_string(String(response.get("body", "")))
	var doc: Dictionary = parsed as Dictionary
	var nodes: Array = doc.get("nodes", []) as Array
	var edges: Array = doc.get("edges", []) as Array
	assert_eq(nodes.size(), 2, "Two modules must serialize to two nodes")
	assert_eq(edges.size(), 1, "A single dependency must serialize to one edge")

	# Each node carries id / version / depends_on.
	var ids: Array = []
	for n_raw in nodes:
		var n: Dictionary = n_raw as Dictionary
		assert_true(n.has("id"), "Each module node must have an 'id' field")
		assert_true(n.has("version"), "Each module node must have a 'version' field")
		assert_true(n.has("depends_on"), "Each module node must have a 'depends_on' field")
		ids.append(String(n.get("id", "")))
	assert_true(ids.has("forgekit_core"), "nodes must contain forgekit_core")
	assert_true(ids.has("forgekit_rpg"), "nodes must contain forgekit_rpg")

	var edge: Dictionary = edges[0] as Dictionary
	assert_eq(String(edge.get("from", "")), "forgekit_rpg", "Dependency edge points from the dependent module")
	assert_eq(String(edge.get("to", "")), "forgekit_core", "Dependency edge points to the dependency")
	_tear_down_synthetic_nodes()


func test_module_graph_traversal_is_bounded() -> void:
	# Build > 1000 module entries; the serializer caps at 1000.
	var modules: Array = []
	for i in range(1200):
		modules.append({"id": "forgekit_mod_%d" % i, "version": "0.1.0", "depends_on": []})
	_server = _new_server()
	_server.set_module_provider(_make_module_provider(modules))
	var start_result: Dictionary = _server.start()
	assert_true(start_result.get("ok", false), "start() must succeed in this scenario")

	var response: Dictionary = _http_get(_server, "/api/module_graph")
	assert_eq(int(response.get("status", 0)), 200, "GET /api/module_graph must return 200 OK")

	var parsed: Variant = JSON.parse_string(String(response.get("body", "")))
	var doc: Dictionary = parsed as Dictionary
	var nodes: Array = doc.get("nodes", []) as Array
	assert_true(nodes.size() <= 1000, "Module node list must be bounded to 1000 entries (got %d)" % nodes.size())
	assert_eq(bool(doc.get("truncated", false)), true, "truncated flag must be true when the cap is hit")
	_tear_down_synthetic_nodes()


# ---------------------------------------------------------------------------
# Event bus endpoint (task 5.1.5) — /api/event_bus
# The provider Callable returns a pre-shaped
# {signals: [{name, payload_types, subscribers: [{object_id, object_class?, method}]}]}
# document. Production code inside the editor plugin assembles that shape
# from `GameEvents.list_signals()` + `get_signal_connection_list(name)`;
# tests feed the dictionary straight in to sidestep the signal machinery.
# ---------------------------------------------------------------------------

func _make_event_bus_provider(doc: Dictionary) -> Callable:
	return func() -> Dictionary:
		return doc


func test_http_get_event_bus_empty_when_no_provider() -> void:
	_server = _new_server()
	var start_result: Dictionary = _server.start()
	assert_true(start_result.get("ok", false), "start() must succeed in this scenario")

	var response: Dictionary = _http_get(_server, "/api/event_bus")
	assert_eq(int(response.get("status", 0)), 200, "GET /api/event_bus must return 200 OK")
	var content_type: String = String(response.get("headers", {}).get("content-type", ""))
	assert_true(content_type.begins_with("application/json"), "GET /api/event_bus must set Content-Type: application/json")
	var parsed: Variant = JSON.parse_string(String(response.get("body", "")))
	assert_true(parsed is Dictionary, "Body must parse to a JSON object")
	var doc: Dictionary = parsed as Dictionary
	assert_eq((doc.get("signals", []) as Array).size(), 0, "signals must be empty when no provider is set")
	_tear_down_synthetic_nodes()


func test_http_get_event_bus_serializes_provider_output() -> void:
	var provider_doc: Dictionary = {
		"signals": [
			{
				"name": "item_added",
				"payload_types": ["StringName", "int"],
				"subscribers": [
					{"object_id": "12345", "object_class": "Inventory", "method": "_on_added"},
				],
			},
			{
				"name": "damage_dealt",
				"payload_types": ["Node", "Node", "float", "StringName"],
				"subscribers": [],
			},
		],
	}

	_server = _new_server()
	_server.set_event_bus_provider(_make_event_bus_provider(provider_doc))
	var start_result: Dictionary = _server.start()
	assert_true(start_result.get("ok", false), "start() must succeed in this scenario")

	var response: Dictionary = _http_get(_server, "/api/event_bus")
	assert_eq(int(response.get("status", 0)), 200, "GET /api/event_bus must return 200 OK")

	var parsed: Variant = JSON.parse_string(String(response.get("body", "")))
	var doc: Dictionary = parsed as Dictionary
	var signals_list: Array = doc.get("signals", []) as Array
	assert_eq(signals_list.size(), 2, "Two declared signals must serialize to two entries")

	var names: Array = []
	for s_raw in signals_list:
		var s: Dictionary = s_raw as Dictionary
		assert_true(s.has("name"), "Each signal entry must have 'name'")
		assert_true(s.has("subscribers"), "Each signal entry must have 'subscribers'")
		names.append(String(s.get("name", "")))
	assert_true(names.has("item_added"), "signals must contain item_added")
	assert_true(names.has("damage_dealt"), "signals must contain damage_dealt")

	# The entry for item_added has one subscriber with object_id + method.
	for s_raw in signals_list:
		var s: Dictionary = s_raw as Dictionary
		if String(s.get("name", "")) == "item_added":
			var subs: Array = s.get("subscribers", []) as Array
			assert_eq(subs.size(), 1, "item_added must have one subscriber")
			var sub: Dictionary = subs[0] as Dictionary
			assert_true(sub.has("object_id"), "subscriber must carry object_id")
			assert_true(sub.has("method"), "subscriber must carry method name")
	_tear_down_synthetic_nodes()


func test_event_bus_traversal_is_bounded() -> void:
	var many: Array = []
	for i in range(1200):
		many.append({"name": "signal_%d" % i, "payload_types": [], "subscribers": []})
	var provider_doc: Dictionary = {"signals": many}

	_server = _new_server()
	_server.set_event_bus_provider(_make_event_bus_provider(provider_doc))
	var start_result: Dictionary = _server.start()
	assert_true(start_result.get("ok", false), "start() must succeed in this scenario")

	var response: Dictionary = _http_get(_server, "/api/event_bus")
	assert_eq(int(response.get("status", 0)), 200, "GET /api/event_bus must return 200 OK")

	var parsed: Variant = JSON.parse_string(String(response.get("body", "")))
	var doc: Dictionary = parsed as Dictionary
	var signals_list: Array = doc.get("signals", []) as Array
	assert_true(signals_list.size() <= 1000, "Signal list must be bounded to 1000 entries (got %d)" % signals_list.size())
	assert_eq(bool(doc.get("truncated", false)), true, "truncated flag must be true when the cap is hit")
	_tear_down_synthetic_nodes()
