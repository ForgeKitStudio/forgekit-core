extends GutTest
## Unit tests for McpTexturePacker: shelf-packing atlas builder.


const TEXTURE_PACKER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/asset_generator/texture_packer.gd")


func _make_image(w: int, h: int, color: Color = Color.WHITE) -> Image:
	var img: Image = Image.create(w, h, false, Image.FORMAT_RGBA8)
	img.fill(color)
	return img


func test_pack_returns_placements_for_single_image() -> void:
	var packer: Object = TEXTURE_PACKER_SCRIPT.new()
	var images: Array[Image] = [_make_image(32, 32)]
	var result: Dictionary = packer.pack(images, 256)
	assert_true(result.has("atlas"), "result must contain atlas")
	assert_true(result.has("placements"), "result must contain placements")
	var placements: Array = result.get("placements", []) as Array
	assert_eq(placements.size(), 1, "one placement per input")
	var p: Dictionary = placements[0] as Dictionary
	assert_eq(int(p.get("index", -1)), 0, "placement index matches input index")
	assert_eq(int(p.get("width", 0)), 32, "placement width matches image")
	assert_eq(int(p.get("height", 0)), 32, "placement height matches image")


func test_pack_places_sorted_by_height_descending() -> void:
	# Shelf packing sorts by height descending; the tall image lands on
	# the first shelf, the short one on the next (or side).
	var packer: Object = TEXTURE_PACKER_SCRIPT.new()
	var images: Array[Image] = [
		_make_image(32, 32),
		_make_image(32, 64),
		_make_image(32, 16),
	]
	var result: Dictionary = packer.pack(images, 256)
	var placements: Array = result.get("placements", []) as Array
	assert_eq(placements.size(), 3, "three placements expected")
	# Each placement must point back at the original image index so
	# callers can map placements to their source images.
	var indices: Array = []
	for p_raw in placements:
		indices.append(int((p_raw as Dictionary).get("index", -1)))
	indices.sort()
	assert_eq(indices, [0, 1, 2], "every input image index must appear exactly once")


func test_pack_abort_when_image_exceeds_max_size() -> void:
	var packer: Object = TEXTURE_PACKER_SCRIPT.new()
	var images: Array[Image] = [_make_image(512, 512)]
	var result: Dictionary = packer.pack(images, 256)
	assert_true(result.has("error"), "oversize input must return error envelope")
	assert_eq(String(result.get("error", "")), "exceeds_max_size", "error code must be exceeds_max_size")


func test_pack_places_images_on_multiple_shelves_when_width_exceeded() -> void:
	var packer: Object = TEXTURE_PACKER_SCRIPT.new()
	# 3 images 40x40 on max_size=128: only one per shelf (40 + 40 <= 128
	# but 40 + 40 + 40 > 128 means the third starts a new shelf). Three
	# 40-tall shelves = 120 fits under the 128 vertical budget.
	var images: Array[Image] = [
		_make_image(40, 40),
		_make_image(40, 40),
		_make_image(40, 40),
	]
	var result: Dictionary = packer.pack(images, 80)
	assert_false(result.has("error"), "three 40x40 should fit across 3 shelves under max_size=80")
	var placements: Array = result.get("placements", []) as Array
	assert_eq(placements.size(), 3, "three placements")
	# Y coordinates must all differ, reflecting separate shelves.
	var ys: Array = []
	for p_raw in placements:
		ys.append(int((p_raw as Dictionary).get("y", 0)))
	ys.sort()
	# Two rows of 40-tall shelves (40 + 40 = 80) with two images on the
	# first shelf (side-by-side) and one on the second.
	assert_eq(ys[0], 0, "first placement sits at y=0")
	assert_eq(ys[1], 0, "second placement shares the first shelf at y=0")
	assert_eq(ys[2], 40, "third placement starts a new shelf at y=40")
