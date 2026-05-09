extends RefCounted
## McpVisualizerTools — JSON-RPC handler adapter for the five visualizer
## MCP tools.
##
##   visualizer.start(port?)                         → {url, port, already_running?}
##   visualizer.stop()                               → {stopped: true}
##   visualizer.render_scene_tree(scene_path?, format?)
##   visualizer.render_module_graph(format?)
##   visualizer.render_event_bus(format?)
##
## The adapter delegates data collection to an injected
## McpVisualizerHttpServer (duck-typed against the server's public API
## plus the `_build_*_document` hooks). When `format` is `"json"` the
## adapter returns the server's document verbatim; when it is `"svg"`
## the adapter renders a simple grid-placed SVG from the same nodes /
## edges, without running any physics simulation. `scene_path` on
## `render_scene_tree` is accepted for forward compatibility but is
## currently ignored — the server's scene provider is the authoritative
## source.


class_name McpVisualizerTools


const _DEFAULT_FORMAT: String = "json"
const _GRID_CELL_PX: int = 120
const _GRID_MARGIN_PX: int = 40
const _GRID_COLUMNS: int = 6
const _NODE_RADIUS_PX: int = 8


var _http_server: Object = null


func _init(http_server: Object = null) -> void:
	_http_server = http_server


func set_http_server(http_server: Object) -> void:
	_http_server = http_server


# ---------------------------------------------------------------------------
# MCP tool handlers.
# ---------------------------------------------------------------------------

func start(params: Variant) -> Variant:
	if _http_server.is_listening():
		var running_port: int = int(_http_server.get_port())
		return {
			"url": "http://127.0.0.1:%d" % running_port,
			"port": running_port,
			"already_running": true,
		}
	# Optional `port` overrides the scan range to a single slot so the
	# caller gets the exact port they asked for or a start() failure.
	var port_override: int = _get_int_param(params, "port", 0, -1)
	if port_override > 0:
		_http_server.port_range_start = port_override
		_http_server.port_range_end = port_override
	var _result: Dictionary = _http_server.start() as Dictionary
	var chosen_port: int = int(_http_server.get_port())
	return {
		"url": "http://127.0.0.1:%d" % chosen_port,
		"port": chosen_port,
	}


func stop(_params: Variant) -> Variant:
	_http_server.stop()
	return {"stopped": true}


## `scene_path` is accepted for forward compatibility; the server's
## scene provider is authoritative. The only honoured flag is `format`,
## `"json"` (default) or `"svg"`.
func render_scene_tree(params: Variant) -> Variant:
	var format: String = _get_string_param(params, "format", 1, _DEFAULT_FORMAT)
	var doc: Dictionary = _http_server._build_scene_tree_document()
	if format == "svg":
		return {"svg": _render_graph_svg(doc.get("nodes", []) as Array, doc.get("edges", []) as Array, "label")}
	return doc


func render_module_graph(params: Variant) -> Variant:
	var format: String = _get_string_param(params, "format", 0, _DEFAULT_FORMAT)
	var doc: Dictionary = _http_server._build_module_graph_document()
	if format == "svg":
		return {"svg": _render_graph_svg(doc.get("nodes", []) as Array, doc.get("edges", []) as Array, "id")}
	return doc


func render_event_bus(params: Variant) -> Variant:
	var format: String = _get_string_param(params, "format", 0, _DEFAULT_FORMAT)
	var doc: Dictionary = _http_server._build_event_bus_document()
	if format == "svg":
		# Project {signals:[{name, subscribers}]} into the same
		# {nodes, edges} shape so the shared renderer works unchanged.
		var graph: Dictionary = _event_bus_to_graph(doc.get("signals", []) as Array)
		return {"svg": _render_graph_svg(graph["nodes"], graph["edges"], "label")}
	return doc


## Bulk-register all five visualizer MCP methods on the supplied dispatcher.
## Returns `self` so the caller can chain.
func register_on(dispatcher: Object) -> Object:
	dispatcher.register_handler("visualizer.start", Callable(self, "start"))
	dispatcher.register_handler("visualizer.stop", Callable(self, "stop"))
	dispatcher.register_handler("visualizer.render_scene_tree", Callable(self, "render_scene_tree"))
	dispatcher.register_handler("visualizer.render_module_graph", Callable(self, "render_module_graph"))
	dispatcher.register_handler("visualizer.render_event_bus", Callable(self, "render_event_bus"))
	return self


# ---------------------------------------------------------------------------
# SVG rendering — grid-placed, no physics simulation.
# ---------------------------------------------------------------------------

static func _event_bus_to_graph(signals: Array) -> Dictionary:
	var nodes: Array = []
	var edges: Array = []
	for s_raw in signals:
		var s: Dictionary = s_raw as Dictionary
		var sig_name: String = String(s.get("name", ""))
		nodes.append({"id": sig_name, "label": sig_name})
		for sub_raw in (s.get("subscribers", []) as Array):
			var sub: Dictionary = sub_raw as Dictionary
			var sub_id: String = "%s::%s.%s" % [sig_name, String(sub.get("object_class", "")), String(sub.get("method", ""))]
			var sub_label: String = "%s.%s" % [String(sub.get("object_class", "")), String(sub.get("method", ""))]
			nodes.append({"id": sub_id, "label": sub_label})
			edges.append({"from": sig_name, "to": sub_id})
	return {"nodes": nodes, "edges": edges}


static func _render_graph_svg(nodes: Array, edges: Array, label_field: String) -> String:
	var positions: Dictionary = {}
	for i in range(nodes.size()):
		var n: Dictionary = nodes[i] as Dictionary
		var col: int = i % _GRID_COLUMNS
		var row: int = i / _GRID_COLUMNS
		positions[String(n.get("id", ""))] = {
			"x": _GRID_MARGIN_PX + col * _GRID_CELL_PX,
			"y": _GRID_MARGIN_PX + row * _GRID_CELL_PX,
		}
	var width: int = _GRID_MARGIN_PX * 2 + _GRID_COLUMNS * _GRID_CELL_PX
	var rows: int = int(ceil(float(nodes.size()) / float(_GRID_COLUMNS)))
	var height: int = _GRID_MARGIN_PX * 2 + max(rows, 1) * _GRID_CELL_PX

	var svg: String = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 %d %d\" width=\"%d\" height=\"%d\">" % [width, height, width, height]
	# Edges first so nodes render on top.
	for e_raw in edges:
		var e: Dictionary = e_raw as Dictionary
		var from_id: String = String(e.get("from", ""))
		var to_id: String = String(e.get("to", ""))
		if not positions.has(from_id) or not positions.has(to_id):
			continue
		var p: Dictionary = positions[from_id]
		var q: Dictionary = positions[to_id]
		svg += "<line x1=\"%d\" y1=\"%d\" x2=\"%d\" y2=\"%d\" stroke=\"#4a5362\" stroke-width=\"1\"/>" % [int(p["x"]), int(p["y"]), int(q["x"]), int(q["y"])]
	for n_raw in nodes:
		var n: Dictionary = n_raw as Dictionary
		var pos: Dictionary = positions[String(n.get("id", ""))]
		var label: String = String(n.get(label_field, n.get("id", "")))
		svg += "<g transform=\"translate(%d,%d)\">" % [int(pos["x"]), int(pos["y"])]
		svg += "<circle r=\"%d\" fill=\"#4c8df6\" stroke=\"#0b1220\" stroke-width=\"1.5\"/>" % _NODE_RADIUS_PX
		svg += "<text x=\"%d\" y=\"4\" fill=\"#e4e7ea\" font-size=\"10\">%s</text>" % [_NODE_RADIUS_PX + 3, _escape_xml(label)]
		svg += "</g>"
	svg += "</svg>"
	return svg


static func _escape_xml(s: String) -> String:
	return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


# ---------------------------------------------------------------------------
# Param helpers — accept both by-name (Dictionary) and by-position (Array).
# ---------------------------------------------------------------------------

static func _get_string_param(params: Variant, key: String, index: int, default_value: String) -> String:
	if params is Dictionary:
		var dict: Dictionary = params as Dictionary
		if dict.has(key):
			var v: Variant = dict[key]
			if v is String:
				return String(v)
	elif params is Array:
		var arr: Array = params as Array
		if index >= 0 and index < arr.size():
			var v: Variant = arr[index]
			if v is String:
				return String(v)
	return default_value


static func _get_int_param(params: Variant, key: String, index: int, default_value: int) -> int:
	if params is Dictionary:
		var dict: Dictionary = params as Dictionary
		if dict.has(key):
			var v: Variant = dict[key]
			if typeof(v) == TYPE_INT or typeof(v) == TYPE_FLOAT:
				return int(v)
	elif params is Array:
		var arr: Array = params as Array
		if index >= 0 and index < arr.size():
			var v: Variant = arr[index]
			if typeof(v) == TYPE_INT or typeof(v) == TYPE_FLOAT:
				return int(v)
	return default_value
