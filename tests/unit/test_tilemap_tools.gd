extends GutTest
## Unit tests for McpTileMapTools: JSON-RPC handler adapter that exposes
## the six editor-channel TileMap MCP tools on top of a duck-typed
## TileMapBackend.
##
##   tilemap.set_cell(node_path, layer, coords, source_id?, atlas_coords?)  → {set: true}
##   tilemap.get_cell(node_path, layer, coords)                             → {source_id, atlas_coords}
##   tilemap.fill_rect(node_path, layer, rect, source_id, atlas_coords)     → {cells_written}
##   tilemap.clear_layer(node_path, layer)                                  → {cleared: true}
##   tilemap.import_from_json(node_path, json_path)                         → {imported_cells}
##   tilemap.export_to_json(node_path, target_path)                         → {target_path, bytes_written}


const TILEMAP_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/tools/tilemap_tools.gd")
const DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")


class FakeTileMapBackend:
	extends RefCounted

	var calls: Array = []

	func set_cell(node_path: String, layer: int, coords: Variant, source_id: int, atlas_coords: Variant) -> Variant:
		calls.append({
			"op": "set_cell",
			"node_path": node_path,
			"layer": layer,
			"coords": coords,
			"source_id": source_id,
			"atlas_coords": atlas_coords,
		})
		return {"set": true}

	func get_cell(node_path: String, layer: int, coords: Variant) -> Variant:
		calls.append({"op": "get_cell", "node_path": node_path, "layer": layer, "coords": coords})
		return {"source_id": 0, "atlas_coords": [0, 0]}

	func fill_rect(node_path: String, layer: int, rect: Variant, source_id: int, atlas_coords: Variant) -> Variant:
		calls.append({
			"op": "fill_rect",
			"node_path": node_path,
			"layer": layer,
			"rect": rect,
			"source_id": source_id,
			"atlas_coords": atlas_coords,
		})
		return {"cells_written": 4}

	func clear_layer(node_path: String, layer: int) -> Variant:
		calls.append({"op": "clear_layer", "node_path": node_path, "layer": layer})
		return {"cleared": true}

	func import_from_json(node_path: String, json_path: String) -> Variant:
		calls.append({"op": "import_from_json", "node_path": node_path, "json_path": json_path})
		return {"imported_cells": 10}

	func export_to_json(node_path: String, target_path: String) -> Variant:
		calls.append({"op": "export_to_json", "node_path": node_path, "target_path": target_path})
		return {"target_path": target_path, "bytes_written": 42}

	func find_calls(op: String) -> Array:
		var out: Array = []
		for c in calls:
			if (c as Dictionary).get("op", "") == op:
				out.append(c)
		return out


func _new_env() -> Dictionary:
	var backend: FakeTileMapBackend = FakeTileMapBackend.new()
	var tools: Object = TILEMAP_TOOLS_SCRIPT.new(backend)
	return {"backend": backend, "tools": tools}


func test_set_cell_forwards_all_params() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).set_cell({
		"node_path": "/root/Map",
		"layer": 0,
		"coords": [2, 3],
		"source_id": 1,
		"atlas_coords": [0, 1],
	})
	var call: Dictionary = (env["backend"] as FakeTileMapBackend).find_calls("set_cell")[0]
	assert_eq(call.get("layer", -1), 0, "layer forwarded")
	assert_eq(call.get("source_id", -1), 1, "source_id forwarded")


func test_set_cell_defaults_source_id_and_atlas_coords() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).set_cell({
		"node_path": "/root/Map",
		"layer": 0,
		"coords": [2, 3],
	})
	var call: Dictionary = (env["backend"] as FakeTileMapBackend).find_calls("set_cell")[0]
	assert_eq(call.get("source_id", -99), -1, "source_id defaults to -1 (erase) when absent")
	assert_true(call.get("atlas_coords", null) == null or (call.get("atlas_coords", []) as Array).size() == 0,
		"atlas_coords defaults to empty when absent")


func test_get_cell_forwards_layer_and_coords() -> void:
	var env: Dictionary = _new_env()
	var result: Variant = (env["tools"] as Object).get_cell({"node_path": "/r/M", "layer": 1, "coords": [5, 6]})
	var call: Dictionary = (env["backend"] as FakeTileMapBackend).find_calls("get_cell")[0]
	assert_eq(call.get("layer", -1), 1, "layer forwarded")
	assert_true((result as Dictionary).has("source_id"), "source_id returned")


func test_fill_rect_forwards_all_params() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).fill_rect({
		"node_path": "/r/M",
		"layer": 0,
		"rect": [0, 0, 4, 4],
		"source_id": 1,
		"atlas_coords": [0, 0],
	})
	var call: Dictionary = (env["backend"] as FakeTileMapBackend).find_calls("fill_rect")[0]
	assert_eq((call.get("rect", []) as Array).size(), 4, "rect forwarded as 4-element array")


func test_clear_layer_forwards_layer() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).clear_layer({"node_path": "/r/M", "layer": 2})
	var call: Dictionary = (env["backend"] as FakeTileMapBackend).find_calls("clear_layer")[0]
	assert_eq(call.get("layer", -1), 2, "layer forwarded")


func test_import_from_json_forwards_json_path() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).import_from_json({
		"node_path": "/r/M",
		"json_path": "res://levels/1.json",
	})
	var call: Dictionary = (env["backend"] as FakeTileMapBackend).find_calls("import_from_json")[0]
	assert_eq(call.get("json_path", ""), "res://levels/1.json", "json_path forwarded")


func test_export_to_json_forwards_target_path() -> void:
	var env: Dictionary = _new_env()
	var result: Variant = (env["tools"] as Object).export_to_json({
		"node_path": "/r/M",
		"target_path": "res://levels/out.json",
	})
	assert_eq((result as Dictionary).get("target_path", ""), "res://levels/out.json",
		"target_path returned")


func test_register_on_wires_all_six_tilemap_methods() -> void:
	var env: Dictionary = _new_env()
	var dispatcher: Object = DISPATCHER_SCRIPT.new()
	(env["tools"] as Object).register_on(dispatcher)
	var expected: Array = [
		"tilemap.set_cell",
		"tilemap.get_cell",
		"tilemap.fill_rect",
		"tilemap.clear_layer",
		"tilemap.import_from_json",
		"tilemap.export_to_json",
	]
	var req_id: int = 1
	for method in expected:
		var resp: Dictionary = dispatcher.dispatch({
			"jsonrpc": "2.0",
			"method": method,
			"params": {},
			"id": req_id,
		})
		assert_true(resp.has("result"), "Method %s must reach the adapter" % method)
		req_id += 1
