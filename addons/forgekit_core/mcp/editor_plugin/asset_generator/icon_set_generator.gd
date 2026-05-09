extends RefCounted
## McpIconSetGenerator — rasterizes a single SVG source into multiple
## sizes by delegating to McpSvgRasterizer per size.


class_name McpIconSetGenerator


const _SVG_RASTERIZER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/asset_generator/svg_rasterizer.gd")


var _rasterizer: Object = null


func _init(rasterizer: Object = null) -> void:
	_rasterizer = rasterizer if rasterizer != null else _SVG_RASTERIZER_SCRIPT.new()


## Generate one Image per requested pixel size. Returns an array of
## `{size, image}` dictionaries preserving the input ordering. If a size
## fails to rasterize, its `image` field is null and a push_warning has
## already been emitted by the rasterizer.
func generate(svg_source: String, sizes: Array[int]) -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	for size in sizes:
		var image: Image = _rasterizer.rasterize(svg_source, size)
		out.append({"size": size, "image": image})
	return out
