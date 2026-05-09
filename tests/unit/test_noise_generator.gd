extends GutTest
## Unit tests for McpNoiseGenerator: FastNoiseLite-backed grayscale image
## producer.


const NOISE_GENERATOR_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/asset_generator/noise_generator.gd")


func test_generate_perlin_returns_image_at_requested_size() -> void:
	var gen: Object = NOISE_GENERATOR_SCRIPT.new()
	var image: Image = gen.generate(32, 32, &"perlin", 42)
	assert_true(image != null, "generate() must return a non-null Image")
	assert_eq(image.get_width(), 32, "image width must match requested width")
	assert_eq(image.get_height(), 32, "image height must match requested height")


func test_generate_simplex_and_cellular_supported() -> void:
	var gen: Object = NOISE_GENERATOR_SCRIPT.new()
	var simplex_image: Image = gen.generate(16, 16, &"simplex", 1)
	assert_true(simplex_image != null, "simplex noise must produce an image")
	var cellular_image: Image = gen.generate(16, 16, &"cellular", 1)
	assert_true(cellular_image != null, "cellular noise must produce an image")


func test_generate_deterministic_for_same_seed() -> void:
	var gen: Object = NOISE_GENERATOR_SCRIPT.new()
	var a: Image = gen.generate(16, 16, &"perlin", 7)
	var b: Image = gen.generate(16, 16, &"perlin", 7)
	assert_eq(a.get_data(), b.get_data(), "same seed must produce identical output")


func test_generate_differs_for_different_seeds() -> void:
	var gen: Object = NOISE_GENERATOR_SCRIPT.new()
	var a: Image = gen.generate(16, 16, &"perlin", 1)
	var b: Image = gen.generate(16, 16, &"perlin", 2)
	assert_ne(a.get_data(), b.get_data(), "different seeds must produce different output")
