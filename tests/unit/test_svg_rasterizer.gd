extends GutTest
## Unit tests for McpSvgRasterizer: rasterizes an SVG source string to an
## Image at the requested square size using Godot's built-in SVG loader.


const SVG_RASTERIZER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/asset_generator/svg_rasterizer.gd")


const _VALID_SVG: String = """<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" fill="#ff0000"/></svg>"""


func test_rasterize_returns_image_at_requested_size() -> void:
	var rasterizer: Object = SVG_RASTERIZER_SCRIPT.new()
	var image: Image = rasterizer.rasterize(_VALID_SVG, 64)
	assert_true(image != null, "rasterize() must return an Image for valid SVG")
	assert_eq(image.get_width(), 64, "image width must match requested size")
	assert_eq(image.get_height(), 64, "image height must match requested size")


func test_rasterize_honours_custom_size() -> void:
	var rasterizer: Object = SVG_RASTERIZER_SCRIPT.new()
	var image: Image = rasterizer.rasterize(_VALID_SVG, 128)
	assert_true(image != null, "rasterize() must return an Image for valid SVG")
	assert_eq(image.get_width(), 128, "image width must match requested size")
	assert_eq(image.get_height(), 128, "image height must match requested size")


func test_rasterize_returns_null_on_invalid_svg() -> void:
	var rasterizer: Object = SVG_RASTERIZER_SCRIPT.new()
	var image: Image = rasterizer.rasterize("not an svg", 64)
	assert_true(image == null, "rasterize() must return null for invalid SVG input")
	assert_push_warning("SVG_RASTERIZE_FAILED", "push_warning must explain the failure")
	# load_svg_from_buffer emits Image::load engine errors on parse
	# failure; mark them handled so GUT does not flag them as unexpected.
	for err in get_errors():
		if err.is_engine_error():
			err.handled = true


func test_rasterize_returns_null_for_empty_source() -> void:
	var rasterizer: Object = SVG_RASTERIZER_SCRIPT.new()
	var image: Image = rasterizer.rasterize("", 64)
	assert_true(image == null, "rasterize() must return null for empty SVG input")
	assert_push_warning("SVG_RASTERIZE_FAILED", "push_warning must explain the failure")
	for err in get_errors():
		if err.is_engine_error():
			err.handled = true
