@tool
extends RefCounted
## Browser Visualizer HTTP server — port-scanning TCP listener with a
## minimal HTTP/1.1 request loop.
##
## Binds a TCPServer on the first free port in 6030-6039. On a successful
## bind, the chosen port is recorded under the "visualizer" key in
## user://mcp_active_port.json, merging with any sibling entries written by
## the editor plugin WebSocket server, the runtime UDP bridge, and the
## health endpoint. The write follows an atomic read → parse → modify →
## write-temp → flush → rename sequence so a crash or power loss between
## the write and the rename leaves the original file byte-for-byte intact.
##
## Callers must invoke `poll()` each frame (or each idle tick) to accept
## pending connections and dispatch HTTP/1.1 GET requests. Two endpoints
## are served: `GET /` returns a static HTML page that renders the scene
## tree as a force-directed graph, and `GET /api/scene_tree` returns a
## JSON document derived from a Callable registered via
## `set_scene_provider()`. Any other path returns 404.

class_name McpVisualizerHttpServer


const DEFAULT_BIND_ADDRESS: String = "127.0.0.1"
const DEFAULT_PORT_RANGE_START: int = 6030
const DEFAULT_PORT_RANGE_END: int = 6039
const ACTIVE_PORT_FILE: String = "user://mcp_active_port.json"
const ACTIVE_PORT_KEY: String = "visualizer"
const INDEX_HTML_PATH: String = "res://addons/forgekit_core/mcp/editor_plugin/visualizer/ui/index.html"
const MAX_REQUEST_BYTES: int = 8192
const MAX_SCENE_TREE_NODES: int = 1000


var bind_address: String = DEFAULT_BIND_ADDRESS
var port_range_start: int = DEFAULT_PORT_RANGE_START
var port_range_end: int = DEFAULT_PORT_RANGE_END

var _server: TCPServer = null
var _active_port: int = -1

# Pending client connections, each { peer: StreamPeerTCP, buffer: String }.
# Built up across poll() calls until a complete request header has been
# received, at which point the response is written and the peer is closed.
var _pending: Array = []

# Injectable scene tree provider — a Callable returning a Node (the scene
# root) or null. Defaults to a no-op provider that returns null so the
# /api/scene_tree endpoint returns an empty document until the editor
# plugin wires up EditorInterface.get_edited_scene_root() in a later task.
var _scene_provider: Callable = Callable()

# Injectable module-graph provider — a Callable returning an Array of
# module-manifest-like entries (Dictionaries or ModuleManifest instances
# exposing id / version / depends_on). Defaults to a no-op provider so the
# /api/module_graph endpoint returns an empty document until the editor
# plugin wires up ModuleLoader.scan() results.
var _module_provider: Callable = Callable()

# Injectable event-bus provider — a Callable returning an Object duck-typed
# against GameEvents.list_signals() + get_signal_connection_list(name).
# Defaults to a no-op provider so the /api/event_bus endpoint returns an
# empty document until the editor plugin wires up the GameEvents autoload.
var _event_bus_provider: Callable = Callable()

# Renamer callable — `func(from_path: String, to_path: String) -> int` where
# the returned int follows `@GlobalScope.Error` conventions (OK on success).
# Defaults to `DirAccess.rename_absolute` but can be overridden in tests so
# rename failures can be simulated without touching the real filesystem.
var _renamer: Callable = Callable(DirAccess, "rename_absolute")


## Override the renamer used by the atomic active-port writer. Tests use
## this to inject a recording / failing renamer without touching the real
## filesystem.
func set_renamer(renamer: Callable) -> void:
	_renamer = renamer


## Scan the configured port range and bind the first free port.
## Returns { ok: true, port: int, bind_address: String } on success, or
## { ok: false, error: "all_ports_in_use", tried: Array[int] } on failure.
func start() -> Dictionary:
	if bind_address != DEFAULT_BIND_ADDRESS:
		push_warning("EXTERNAL_BIND_ENABLED: visualizer HTTP server bound to %s" % bind_address)

	var tried: Array = []
	for port in range(port_range_start, port_range_end + 1):
		tried.append(port)
		var tcp: TCPServer = TCPServer.new()
		var err: int = tcp.listen(port, bind_address)
		if err == OK:
			_server = tcp
			_active_port = port
			_write_active_port(port)
			return {
				"ok": true,
				"port": port,
				"bind_address": bind_address,
			}
		tcp.stop()

	return {
		"ok": false,
		"error": "all_ports_in_use",
		"tried": tried,
	}


## Stop the server and release the bound port.
func stop() -> void:
	if _server != null:
		_server.stop()
		_server = null
	if _active_port != -1:
		_clear_active_port()
		_active_port = -1
	for entry in _pending:
		var peer: StreamPeerTCP = entry.get("peer") as StreamPeerTCP
		if peer != null:
			peer.disconnect_from_host()
	_pending.clear()


## Register a scene-tree provider. The Callable is invoked on each
## `/api/scene_tree` request and must return a `Node` root (any subtree is
## serialized) or `null` when no scene is available. Clearing the provider
## with `Callable()` reverts to the default empty-document behaviour.
func set_scene_provider(provider: Callable) -> void:
	_scene_provider = provider


## Register a module-graph provider. The Callable is invoked on each
## `/api/module_graph` request and must return an Array of entries where
## each entry exposes `id`, `version`, and `depends_on` — either as a
## Dictionary or as a ModuleManifest-like Object (the serializer reads both
## shapes). Clearing with `Callable()` reverts to the empty-document default.
func set_module_provider(provider: Callable) -> void:
	_module_provider = provider


## Register an event-bus provider. The Callable is invoked on each
## `/api/event_bus` request and must return an Object duck-typed against
## `GameEvents.list_signals()` + `get_signal_connection_list(name)`. Clearing
## with `Callable()` reverts to the empty-document default.
func set_event_bus_provider(provider: Callable) -> void:
	_event_bus_provider = provider


## Accept any pending TCP connections and service fully-buffered HTTP/1.1
## GET requests. Safe to call each frame — short-circuits cheaply when no
## clients are connected and the accept queue is empty.
func poll() -> void:
	if _server == null:
		return
	while _server.is_connection_available():
		var peer: StreamPeerTCP = _server.take_connection()
		if peer != null:
			_pending.append({"peer": peer, "buffer": ""})

	var kept: Array = []
	for entry in _pending:
		if _service_pending(entry):
			kept.append(entry)
	_pending = kept


# ---------------------------------------------------------------------------
# HTTP/1.1 request handling. Only the method + path header is parsed; the
# server dispatches `GET /` to the static HTML page, `GET /api/scene_tree`
# to the JSON serializer, and everything else to 404.
# ---------------------------------------------------------------------------

func _service_pending(entry: Dictionary) -> bool:
	# Returns true when the connection should be retained for another poll.
	var peer: StreamPeerTCP = entry.get("peer") as StreamPeerTCP
	if peer == null:
		return false
	peer.poll()
	var status: int = peer.get_status()
	if status != StreamPeerTCP.STATUS_CONNECTED and status != StreamPeerTCP.STATUS_CONNECTING:
		peer.disconnect_from_host()
		return false

	var available: int = peer.get_available_bytes()
	if available > 0:
		var read_result: Array = peer.get_data(available)
		if int(read_result[0]) == OK:
			var chunk: PackedByteArray = read_result[1] as PackedByteArray
			entry["buffer"] = String(entry.get("buffer", "")) + chunk.get_string_from_utf8()

	var buffer: String = String(entry.get("buffer", ""))
	var header_end: int = buffer.find("\r\n\r\n")
	if header_end == -1:
		if buffer.length() > MAX_REQUEST_BYTES:
			_send_response(peer, 400, "text/plain; charset=utf-8", "Bad Request\n".to_utf8_buffer())
			peer.disconnect_from_host()
			return false
		return true

	var request_line: String = buffer.substr(0, buffer.find("\r\n"))
	var parts: PackedStringArray = request_line.split(" ")
	if parts.size() < 2:
		_send_response(peer, 400, "text/plain; charset=utf-8", "Bad Request\n".to_utf8_buffer())
		peer.disconnect_from_host()
		return false

	var method: String = parts[0]
	var path: String = parts[1]
	if method != "GET":
		_send_response(peer, 405, "text/plain; charset=utf-8", "Method Not Allowed\n".to_utf8_buffer())
		peer.disconnect_from_host()
		return false

	_dispatch_get(peer, path)
	peer.disconnect_from_host()
	return false


func _dispatch_get(peer: StreamPeerTCP, path: String) -> void:
	if path == "/" or path == "/index.html":
		_send_response(peer, 200, "text/html; charset=utf-8", _load_index_html())
		return
	if path == "/api/scene_tree":
		var scene_doc: Dictionary = _build_scene_tree_document()
		_send_response(peer, 200, "application/json; charset=utf-8", JSON.stringify(scene_doc).to_utf8_buffer())
		return
	if path == "/api/module_graph":
		var module_doc: Dictionary = _build_module_graph_document()
		_send_response(peer, 200, "application/json; charset=utf-8", JSON.stringify(module_doc).to_utf8_buffer())
		return
	if path == "/api/event_bus":
		var bus_doc: Dictionary = _build_event_bus_document()
		_send_response(peer, 200, "application/json; charset=utf-8", JSON.stringify(bus_doc).to_utf8_buffer())
		return
	_send_response(peer, 404, "text/plain; charset=utf-8", "Not Found\n".to_utf8_buffer())


func _send_response(peer: StreamPeerTCP, status: int, content_type: String, body: PackedByteArray) -> void:
	var reason: String = _status_reason(status)
	var header: String = "HTTP/1.1 %d %s\r\n" % [status, reason]
	header += "Content-Type: %s\r\n" % content_type
	header += "Content-Length: %d\r\n" % body.size()
	header += "Connection: close\r\n"
	header += "\r\n"
	var header_bytes: PackedByteArray = header.to_utf8_buffer()
	peer.put_data(header_bytes)
	if body.size() > 0:
		peer.put_data(body)


static func _status_reason(status: int) -> String:
	match status:
		200: return "OK"
		400: return "Bad Request"
		404: return "Not Found"
		405: return "Method Not Allowed"
		_: return "OK"


func _load_index_html() -> PackedByteArray:
	var file: FileAccess = FileAccess.open(INDEX_HTML_PATH, FileAccess.READ)
	if file == null:
		push_warning("VISUALIZER_INDEX_MISSING: %s" % INDEX_HTML_PATH)
		return "<!doctype html><meta charset=utf-8><title>ForgeKit Visualizer</title><p>index.html missing.</p>".to_utf8_buffer()
	var text: String = file.get_as_text()
	file.close()
	return text.to_utf8_buffer()


func _build_scene_tree_document() -> Dictionary:
	if not _scene_provider.is_valid():
		return {"nodes": [], "edges": []}
	var root_variant: Variant = _scene_provider.call()
	if not (root_variant is Node):
		return {"nodes": [], "edges": []}
	var root: Node = root_variant as Node
	var nodes: Array = []
	var edges: Array = []
	var stack: Array = [{"node": root, "parent_path": ""}]
	var truncated: bool = false
	while stack.size() > 0:
		var entry: Dictionary = stack.pop_back()
		if nodes.size() >= MAX_SCENE_TREE_NODES:
			truncated = true
			break
		var n: Node = entry.get("node") as Node
		if n == null:
			continue
		var path: String = str(n.get_path()) if n.is_inside_tree() else str(n.name)
		# Detached Node hierarchies (used in tests and previews) report no
		# `get_path()` until added to a SceneTree. Fall back to a synthetic
		# slash-joined path derived from the parent path and the node name
		# so ids remain unique and parent/child edges stay linkable.
		if not n.is_inside_tree():
			var parent_path: String = String(entry.get("parent_path", ""))
			path = parent_path + "/" + String(n.name) if parent_path != "" else String(n.name)
		nodes.append({
			"id": path,
			"label": String(n.name),
			"type": n.get_class(),
		})
		var child_count: int = n.get_child_count()
		for i in range(child_count - 1, -1, -1):
			var child: Node = n.get_child(i)
			edges.append({"from": path, "to": _child_id(path, child)})
			stack.append({"node": child, "parent_path": path})
	var doc: Dictionary = {"nodes": nodes, "edges": edges}
	if truncated:
		doc["truncated"] = true
	return doc


## Build the module-dependency graph from the injected module-provider.
## Each module entry is read as either a Dictionary (`{id, version, depends_on}`)
## or a ModuleManifest-like Object (exposing the same three properties). Output
## is a `{nodes, edges}` document bounded to MAX_SCENE_TREE_NODES entries so a
## runaway `addons/` tree cannot blow up the HTML renderer. The truncation cap
## is shared with the scene-tree serializer to keep the force-directed engine
## stable across views.
func _build_module_graph_document() -> Dictionary:
	if not _module_provider.is_valid():
		return {"nodes": [], "edges": []}
	var modules_variant: Variant = _module_provider.call()
	if not (modules_variant is Array):
		return {"nodes": [], "edges": []}
	var modules: Array = modules_variant as Array
	var nodes: Array = []
	var edges: Array = []
	var truncated: bool = false
	for module_raw in modules:
		if nodes.size() >= MAX_SCENE_TREE_NODES:
			truncated = true
			break
		var id: String = _read_module_id(module_raw)
		if id.is_empty():
			continue
		var version: String = _read_module_version(module_raw)
		var depends_on: Array = _read_module_depends_on(module_raw)
		nodes.append({
			"id": id,
			"version": version,
			"depends_on": depends_on,
		})
		for dep_raw in depends_on:
			var dep: String = String(dep_raw)
			if dep.is_empty():
				continue
			edges.append({"from": id, "to": dep})
	var doc: Dictionary = {"nodes": nodes, "edges": edges}
	if truncated:
		doc["truncated"] = true
	return doc


## Build the event-bus subscriber graph from the injected bus provider.
## The provider Callable returns a `{signals: [{name, payload_types,
## subscribers: [{object_id, object_class?, method}]}]}` document in its
## final wire shape — in production wiring inside the editor plugin the
## closure assembles the document by iterating
## `GameEvents.list_signals()` + `GameEvents.get_signal_connection_list(name)`.
## The serializer enforces the node-count cap and passes the document
## through otherwise.
func _build_event_bus_document() -> Dictionary:
	if not _event_bus_provider.is_valid():
		return {"signals": []}
	var doc_variant: Variant = _event_bus_provider.call()
	if not (doc_variant is Dictionary):
		return {"signals": []}
	var doc: Dictionary = (doc_variant as Dictionary).duplicate(true)
	var signals_variant: Variant = doc.get("signals", [])
	if not (signals_variant is Array):
		return {"signals": []}
	var signals_in: Array = signals_variant as Array
	if signals_in.size() > MAX_SCENE_TREE_NODES:
		var truncated_list: Array = []
		for i in range(MAX_SCENE_TREE_NODES):
			truncated_list.append(signals_in[i])
		doc["signals"] = truncated_list
		doc["truncated"] = true
	return doc


# ---------------------------------------------------------------------------
# Module-entry adapters: duck-typed against Dictionary or ModuleManifest.
# ---------------------------------------------------------------------------

static func _read_module_id(module: Variant) -> String:
	if module is Dictionary:
		return String((module as Dictionary).get("id", ""))
	if module is Object and (module as Object).get("id") != null:
		return String((module as Object).get("id"))
	return ""


static func _read_module_version(module: Variant) -> String:
	if module is Dictionary:
		return String((module as Dictionary).get("version", ""))
	if module is Object and (module as Object).get("version") != null:
		return String((module as Object).get("version"))
	return ""


static func _read_module_depends_on(module: Variant) -> Array:
	var out: Array = []
	var raw: Variant = null
	if module is Dictionary:
		raw = (module as Dictionary).get("depends_on", [])
	elif module is Object:
		raw = (module as Object).get("depends_on")
	if raw is Array:
		for entry in (raw as Array):
			out.append(String(entry))
	return out


static func _child_id(parent_path: String, child: Node) -> String:
	if child.is_inside_tree():
		return str(child.get_path())
	return parent_path + "/" + String(child.name)


func is_listening() -> bool:
	return _server != null and _server.is_listening()


func get_port() -> int:
	return _active_port


func get_bind_address() -> String:
	return bind_address


# ---------------------------------------------------------------------------
# Active-port file (atomic merge-write under the "visualizer" key)
# ---------------------------------------------------------------------------

func _read_active_port_file() -> Dictionary:
	if not FileAccess.file_exists(ACTIVE_PORT_FILE):
		return {}
	var file: FileAccess = FileAccess.open(ACTIVE_PORT_FILE, FileAccess.READ)
	if file == null:
		return {}
	var text: String = file.get_as_text()
	file.close()
	# JSON.new().parse() returns the error as a return code without emitting
	# a Godot engine error — corrupt or truncated files should be treated
	# as an empty dictionary without polluting the log.
	var parser: JSON = JSON.new()
	var err: int = parser.parse(text)
	if err != OK:
		return {}
	var parsed: Variant = parser.data
	if parsed is Dictionary:
		return parsed
	return {}


func _write_active_port_file(data: Dictionary) -> void:
	# Atomic write: serialize to a sibling temp file, flush it, then rename
	# it over the target. A crash or power loss between the write and the
	# rename leaves the original file byte-for-byte intact — the temp
	# sidecar is discarded on the next boot.
	var tmp_path: String = ACTIVE_PORT_FILE + ".tmp"
	var file: FileAccess = FileAccess.open(tmp_path, FileAccess.WRITE)
	if file == null:
		push_warning("ACTIVE_PORT_FILE_WRITE_FAILED: could not open temp file %s" % tmp_path)
		return
	file.store_string(JSON.stringify(data))
	file.close()

	# Flush — GDScript has no fsync(2); reopening and closing the temp
	# forces FileAccess to release any buffered writes held above the OS
	# page cache boundary.
	var probe: FileAccess = FileAccess.open(tmp_path, FileAccess.READ)
	if probe == null:
		_remove_if_exists(tmp_path)
		push_warning("ACTIVE_PORT_FILE_WRITE_FAILED: could not flush temp file %s" % tmp_path)
		return
	probe.close()

	var rename_err: int = int(_renamer.call(tmp_path, ACTIVE_PORT_FILE))
	if rename_err != OK:
		_remove_if_exists(tmp_path)
		push_warning("ACTIVE_PORT_FILE_WRITE_FAILED: rename returned error %d" % rename_err)
		return


static func _remove_if_exists(path: String) -> void:
	if FileAccess.file_exists(path):
		DirAccess.remove_absolute(path)


func _write_active_port(port: int) -> void:
	var data: Dictionary = _read_active_port_file()
	data[ACTIVE_PORT_KEY] = port
	_write_active_port_file(data)


func _clear_active_port() -> void:
	var data: Dictionary = _read_active_port_file()
	if not data.has(ACTIVE_PORT_KEY):
		return
	data.erase(ACTIVE_PORT_KEY)
	_write_active_port_file(data)
