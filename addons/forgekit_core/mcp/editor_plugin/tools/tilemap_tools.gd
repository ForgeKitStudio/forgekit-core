extends RefCounted
## McpTileMapTools — JSON-RPC handler adapter for the six editor-channel
## TileMap MCP tools.
##
##   tilemap.set_cell(node_path, layer, coords, source_id?, atlas_coords?)  (UndoRedo)
##   tilemap.get_cell(node_path, layer, coords)                             → {source_id, atlas_coords}
##   tilemap.fill_rect(node_path, layer, rect, source_id, atlas_coords)     (UndoRedo)
##   tilemap.clear_layer(node_path, layer)                                  (UndoRedo)
##   tilemap.import_from_json(node_path, json_path)                         (UndoRedo)
##   tilemap.export_to_json(node_path, target_path)                         → {target_path, bytes_written}
##
## The adapter is thin — it marshals params and calls into the injected
## TileMapBackend. UndoRedo wrapping for the five mutating tools lives
## inside the backend; the `coords`, `atlas_coords`, and `rect` values are
## forwarded verbatim as Arrays (2-element for coords, 4-element for rect)
## and the backend converts them into `Vector2i` / `Rect2i`.


class_name McpTileMapTools


# Sentinel source_id meaning "erase cell" matching Godot's TileMap API.
const ERASE_SOURCE_ID: int = -1


var _backend: Object = null


func _init(backend: Object = null) -> void:
	_backend = backend


func set_backend(backend: Object) -> void:
	_backend = backend


# ---------------------------------------------------------------------------
# MCP tool handlers.
# ---------------------------------------------------------------------------

func set_cell(params: Variant) -> Variant:
	var node_path: String = _get_string_param(params, "node_path", 0, "")
	var layer: int = _get_int_param(params, "layer", 1, 0)
	var coords: Variant = _get_variant_param(params, "coords", 2, [0, 0])
	var source_id: int = _get_int_param(params, "source_id", 3, ERASE_SOURCE_ID)
	var atlas_coords: Variant = _get_variant_param(params, "atlas_coords", 4, [])
	return _backend.set_cell(node_path, layer, coords, source_id, atlas_coords)


func get_cell(params: Variant) -> Variant:
	var node_path: String = _get_string_param(params, "node_path", 0, "")
	var layer: int = _get_int_param(params, "layer", 1, 0)
	var coords: Variant = _get_variant_param(params, "coords", 2, [0, 0])
	return _backend.get_cell(node_path, layer, coords)


func fill_rect(params: Variant) -> Variant:
	var node_path: String = _get_string_param(params, "node_path", 0, "")
	var layer: int = _get_int_param(params, "layer", 1, 0)
	var rect: Variant = _get_variant_param(params, "rect", 2, [0, 0, 0, 0])
	var source_id: int = _get_int_param(params, "source_id", 3, ERASE_SOURCE_ID)
	var atlas_coords: Variant = _get_variant_param(params, "atlas_coords", 4, [])
	return _backend.fill_rect(node_path, layer, rect, source_id, atlas_coords)


func clear_layer(params: Variant) -> Variant:
	var node_path: String = _get_string_param(params, "node_path", 0, "")
	var layer: int = _get_int_param(params, "layer", 1, 0)
	return _backend.clear_layer(node_path, layer)


func import_from_json(params: Variant) -> Variant:
	var node_path: String = _get_string_param(params, "node_path", 0, "")
	var json_path: String = _get_string_param(params, "json_path", 1, "")
	return _backend.import_from_json(node_path, json_path)


func export_to_json(params: Variant) -> Variant:
	var node_path: String = _get_string_param(params, "node_path", 0, "")
	var target_path: String = _get_string_param(params, "target_path", 1, "")
	return _backend.export_to_json(node_path, target_path)


## Bulk-register all six editor-channel TileMap MCP methods on the
## supplied dispatcher. Returns `self` so the caller can chain.
func register_on(dispatcher: Object) -> Object:
	dispatcher.register_handler("tilemap.set_cell", Callable(self, "set_cell"))
	dispatcher.register_handler("tilemap.get_cell", Callable(self, "get_cell"))
	dispatcher.register_handler("tilemap.fill_rect", Callable(self, "fill_rect"))
	dispatcher.register_handler("tilemap.clear_layer", Callable(self, "clear_layer"))
	dispatcher.register_handler("tilemap.import_from_json", Callable(self, "import_from_json"))
	dispatcher.register_handler("tilemap.export_to_json", Callable(self, "export_to_json"))
	return self


# ---------------------------------------------------------------------------
# Internals.
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
			if typeof(v) == TYPE_INT:
				return int(v)
			if typeof(v) == TYPE_FLOAT:
				return int(v)
	elif params is Array:
		var arr: Array = params as Array
		if index >= 0 and index < arr.size():
			var v: Variant = arr[index]
			if typeof(v) == TYPE_INT:
				return int(v)
			if typeof(v) == TYPE_FLOAT:
				return int(v)
	return default_value


static func _get_variant_param(params: Variant, key: String, index: int, default_value: Variant) -> Variant:
	if params is Dictionary:
		var dict: Dictionary = params as Dictionary
		if dict.has(key):
			return dict[key]
	elif params is Array:
		var arr: Array = params as Array
		if index >= 0 and index < arr.size():
			return arr[index]
	return default_value
