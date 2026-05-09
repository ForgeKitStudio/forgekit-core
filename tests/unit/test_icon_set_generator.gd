extends GutTest
## Unit tests for McpIconSetGenerator: multi-size rasterizer.


const ICON_SET_GENERATOR_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/asset_generator/icon_set_generator.gd")


const _VALID_SVG: String = """<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" fill="#00ff00"/></svg>"""


func test_generate_returns_one_image_per_size() -> void:
	var gen: Object = ICON_SET_GENERATOR_SCRIPT.new()
	var sizes: Array[int] = [16, 32, 64]
	var icons: Array = gen.generate(_VALID_SVG, sizes)
	assert_eq(icons.size(), 3, "one icon per requested size")
	for i in range(icons.size()):
		var icon: Dictionary = icons[i] as Dictionary
		assert_eq(int(icon.get("size", -1)), sizes[i], "size must match input")
		var image: Image = icon.get("image") as Image
		assert_true(image != null, "image must be non-null")
		assert_eq(image.get_width(), sizes[i], "width must match size")
		assert_eq(image.get_height(), sizes[i], "height must match size")


func test_generate_handles_empty_sizes() -> void:
	var gen: Object = ICON_SET_GENERATOR_SCRIPT.new()
	var empty_sizes: Array[int] = []
	var icons: Array = gen.generate(_VALID_SVG, empty_sizes)
	assert_eq(icons.size(), 0, "empty sizes must produce empty output")
