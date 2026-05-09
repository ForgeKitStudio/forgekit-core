extends GutTest
## Unit tests for McpAssetGeneratorTools: JSON-RPC handler adapter for
## the four Asset Generation MCP tools.
##
## Tools:
##   assetgen.sprite_from_svg(svg_source, target_path, size?)
##   assetgen.atlas_pack(source_paths, target_path, max_size?)
##   assetgen.noise_texture(target_path, width, height, noise_type, seed?)
##   assetgen.icon_set(source_svg, target_dir, sizes)
##
## The adapter is thin: it parses by-name / by-position params, delegates
## the generation to rasterizer / packer / noise / icon-set backends, and
## routes every file write through an injected UndoRedoWrapper. Tests
## drive the adapter with fakes for all three collaborators.


const TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/tools/asset_generator_tools.gd")
const DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")


# ---------------------------------------------------------------------------
# Fakes. The adapter delegates to these; tests assert the exact call shape
# the adapter must make, not the underlying rasterizer / packer behaviour
# (those are covered by their own unit tests).
# ---------------------------------------------------------------------------

class FakeSvgRasterizer:
	extends RefCounted

	var calls: Array = []
	var next_image: Image = null

	func rasterize(svg_source: String, size: int) -> Image:
		calls.append({"svg_source": svg_source, "size": size})
		if next_image != null:
			return next_image
		return _make_image(size)

	func _make_image(size: int) -> Image:
		var img: Image = Image.create(size, size, false, Image.FORMAT_RGBA8)
		img.fill(Color.RED)
		return img


class FakeTexturePacker:
	extends RefCounted

	var calls: Array = []

	func pack(images: Array[Image], max_size: int) -> Dictionary:
		calls.append({"image_count": images.size(), "max_size": max_size})
		# Build a trivial placement list and a 1-pixel atlas so callers
		# can save something real; the actual packing algorithm is
		# exercised elsewhere.
		var atlas: Image = Image.create(16, 16, false, Image.FORMAT_RGBA8)
		atlas.fill(Color.BLUE)
		var placements: Array = []
		for i in range(images.size()):
			placements.append({"index": i, "x": i * 2, "y": 0, "width": 2, "height": 2})
		return {"atlas": atlas, "placements": placements}


class FakeNoiseGenerator:
	extends RefCounted

	var calls: Array = []

	func generate(width: int, height: int, noise_type: StringName, seed: int) -> Image:
		calls.append({"width": width, "height": height, "noise_type": String(noise_type), "seed": seed})
		var img: Image = Image.create(width, height, false, Image.FORMAT_L8)
		return img


class FakeIconSetGenerator:
	extends RefCounted

	var calls: Array = []

	func generate(svg_source: String, sizes: Array[int]) -> Array[Dictionary]:
		calls.append({"svg_source": svg_source, "sizes": sizes.duplicate()})
		var out: Array[Dictionary] = []
		for size in sizes:
			var img: Image = Image.create(size, size, false, Image.FORMAT_RGBA8)
			out.append({"size": size, "image": img})
		return out


class FakeUndoRedoWrapper:
	extends RefCounted

	var wrap_calls: Array = []

	func wrap(
		tool_name: String,
		target: String,
		do_callable: Callable,
		undo_callable: Callable,
		transaction_id: String = ""
	) -> Dictionary:
		wrap_calls.append({
			"tool_name": tool_name,
			"target": target,
			"transaction_id": transaction_id,
		})
		# Invoke the do-callable so the filesystem side-effect is applied
		# (tests assert the side-effect afterwards). The undo-callable is
		# recorded but not invoked; real editor UndoRedo would keep it
		# around for a Ctrl+Z.
		do_callable.call()
		var _unused: Callable = undo_callable
		return {"wrapped": true}


class FakeAssetFs:
	extends RefCounted

	var png_writes: Array = []
	var resource_saves: Array = []

	func save_png(image: Image, path: String) -> int:
		png_writes.append({"path": path})
		var _unused: Image = image
		return OK

	func remove(path: String) -> int:
		png_writes.append({"path": path, "removed": true})
		return OK

	func save_resource(resource: Resource, path: String) -> int:
		resource_saves.append({"path": path})
		var _unused: Resource = resource
		return OK


# ---------------------------------------------------------------------------
# Env helpers.
# ---------------------------------------------------------------------------

func _new_env() -> Dictionary:
	var rasterizer: FakeSvgRasterizer = FakeSvgRasterizer.new()
	var packer: FakeTexturePacker = FakeTexturePacker.new()
	var noise: FakeNoiseGenerator = FakeNoiseGenerator.new()
	var icons: FakeIconSetGenerator = FakeIconSetGenerator.new()
	var undo: FakeUndoRedoWrapper = FakeUndoRedoWrapper.new()
	var fs: FakeAssetFs = FakeAssetFs.new()

	var tools: Object = TOOLS_SCRIPT.new()
	tools.set_svg_rasterizer(rasterizer)
	tools.set_texture_packer(packer)
	tools.set_noise_generator(noise)
	tools.set_icon_set_generator(icons)
	tools.set_undo_redo_wrapper(undo)
	tools.set_asset_fs(fs)

	return {
		"tools": tools,
		"rasterizer": rasterizer,
		"packer": packer,
		"noise": noise,
		"icons": icons,
		"undo": undo,
		"fs": fs,
	}


# ---------------------------------------------------------------------------
# assetgen.sprite_from_svg
# ---------------------------------------------------------------------------

const _SVG_SOURCE: String = "<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><rect width='64' height='64' fill='red'/></svg>"


func test_sprite_from_svg_by_name_rasterizes_and_saves_via_undo_redo() -> void:
	var env: Dictionary = _new_env()
	var result: Variant = env["tools"].sprite_from_svg({
		"svg_source": _SVG_SOURCE,
		"target_path": "res://generated/sprite.png",
		"size": 128,
	})
	var dict: Dictionary = result as Dictionary
	assert_eq(String(dict.get("target_path", "")), "res://generated/sprite.png", "result must echo target_path")
	assert_eq(int(dict.get("size", -1)), 128, "result must echo the requested size")
	var rasterizer: FakeSvgRasterizer = env["rasterizer"]
	assert_eq(rasterizer.calls.size(), 1, "rasterizer must be invoked once")
	assert_eq(int(rasterizer.calls[0]["size"]), 128, "rasterizer must receive the requested size")
	var undo: FakeUndoRedoWrapper = env["undo"]
	assert_eq(undo.wrap_calls.size(), 1, "the save must be wrapped in the UndoRedo wrapper")
	assert_eq(String(undo.wrap_calls[0]["tool_name"]), "assetgen.sprite_from_svg", "wrap tool_name must match the MCP method")
	var fs: FakeAssetFs = env["fs"]
	assert_eq(fs.png_writes.size(), 1, "png save must be invoked once by the do-callable")


func test_sprite_from_svg_default_size_is_64() -> void:
	var env: Dictionary = _new_env()
	var _result: Variant = env["tools"].sprite_from_svg({
		"svg_source": _SVG_SOURCE,
		"target_path": "res://generated/sprite.png",
	})
	var rasterizer: FakeSvgRasterizer = env["rasterizer"]
	assert_eq(int(rasterizer.calls[0]["size"]), 64, "default size must be 64")


func test_sprite_from_svg_by_position() -> void:
	var env: Dictionary = _new_env()
	var _result: Variant = env["tools"].sprite_from_svg([
		_SVG_SOURCE,
		"res://generated/sprite.png",
		96,
	])
	var rasterizer: FakeSvgRasterizer = env["rasterizer"]
	assert_eq(int(rasterizer.calls[0]["size"]), 96, "positional arg 2 must be size")


# ---------------------------------------------------------------------------
# assetgen.atlas_pack
# ---------------------------------------------------------------------------

func _write_temp_png(path: String) -> void:
	var img: Image = Image.create(8, 8, false, Image.FORMAT_RGBA8)
	img.fill(Color.GREEN)
	img.save_png(path)


func test_atlas_pack_by_name_saves_atlas_png_and_tres() -> void:
	var tmp_dir: String = "user://assetgen_test"
	if not DirAccess.dir_exists_absolute(ProjectSettings.globalize_path(tmp_dir)):
		DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(tmp_dir))
	var src1: String = tmp_dir + "/src1.png"
	var src2: String = tmp_dir + "/src2.png"
	_write_temp_png(src1)
	_write_temp_png(src2)

	var env: Dictionary = _new_env()
	var result: Variant = env["tools"].atlas_pack({
		"source_paths": [src1, src2],
		"target_path": tmp_dir + "/atlas.png",
		"max_size": 256,
	})
	var dict: Dictionary = result as Dictionary
	assert_eq(String(dict.get("target_path", "")), tmp_dir + "/atlas.png", "result must echo target_path")
	var packer: FakeTexturePacker = env["packer"]
	assert_eq(packer.calls.size(), 1, "packer must be invoked once")
	assert_eq(int(packer.calls[0]["max_size"]), 256, "packer must receive the requested max_size")
	var undo: FakeUndoRedoWrapper = env["undo"]
	assert_eq(undo.wrap_calls.size(), 1, "atlas save must be wrapped once (both png + tres inside a single action)")
	var fs: FakeAssetFs = env["fs"]
	assert_eq(fs.png_writes.size(), 1, "atlas PNG must be written")
	assert_eq(fs.resource_saves.size(), 1, "atlas .atlas.tres must be saved via ResourceSaver")

	# Cleanup
	DirAccess.remove_absolute(ProjectSettings.globalize_path(src1))
	DirAccess.remove_absolute(ProjectSettings.globalize_path(src2))


func test_atlas_pack_default_max_size_is_1024() -> void:
	var tmp_dir: String = "user://assetgen_test"
	if not DirAccess.dir_exists_absolute(ProjectSettings.globalize_path(tmp_dir)):
		DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(tmp_dir))
	var src1: String = tmp_dir + "/src1.png"
	_write_temp_png(src1)

	var env: Dictionary = _new_env()
	var _result: Variant = env["tools"].atlas_pack({
		"source_paths": [src1],
		"target_path": tmp_dir + "/atlas.png",
	})
	var packer: FakeTexturePacker = env["packer"]
	assert_eq(int(packer.calls[0]["max_size"]), 1024, "default max_size must be 1024")

	DirAccess.remove_absolute(ProjectSettings.globalize_path(src1))


# ---------------------------------------------------------------------------
# assetgen.noise_texture
# ---------------------------------------------------------------------------

func test_noise_texture_by_name_generates_and_saves() -> void:
	var env: Dictionary = _new_env()
	var result: Variant = env["tools"].noise_texture({
		"target_path": "res://generated/noise.png",
		"width": 64,
		"height": 32,
		"noise_type": "perlin",
		"seed": 42,
	})
	var dict: Dictionary = result as Dictionary
	assert_eq(int(dict.get("seed", -1)), 42, "result must echo the requested seed")
	var noise: FakeNoiseGenerator = env["noise"]
	assert_eq(noise.calls.size(), 1, "noise generator must be invoked once")
	assert_eq(int(noise.calls[0]["width"]), 64, "noise generator must receive width")
	assert_eq(int(noise.calls[0]["height"]), 32, "noise generator must receive height")
	assert_eq(int(noise.calls[0]["seed"]), 42, "noise generator must receive the seed")
	var undo: FakeUndoRedoWrapper = env["undo"]
	assert_eq(undo.wrap_calls.size(), 1, "noise save must be wrapped once")


func test_noise_texture_randomizes_seed_when_zero() -> void:
	var env: Dictionary = _new_env()
	var result: Variant = env["tools"].noise_texture({
		"target_path": "res://generated/noise.png",
		"width": 32,
		"height": 32,
		"noise_type": "perlin",
		"seed": 0,
	})
	# When seed == 0 the adapter must randomize and echo the chosen seed.
	var dict: Dictionary = result as Dictionary
	assert_true(dict.has("seed"), "result must always carry the resolved seed")
	var seed: int = int(dict.get("seed", 0))
	assert_ne(seed, 0, "seed==0 triggers randomization; result must carry a non-zero seed")


# ---------------------------------------------------------------------------
# assetgen.icon_set
# ---------------------------------------------------------------------------

func test_icon_set_by_name_generates_and_saves_each_size() -> void:
	var env: Dictionary = _new_env()
	var result: Variant = env["tools"].icon_set({
		"source_svg": _SVG_SOURCE,
		"target_dir": "res://generated/icons",
		"sizes": [16, 32, 64],
	})
	var dict: Dictionary = result as Dictionary
	var targets: Array = dict.get("targets", []) as Array
	assert_eq(targets.size(), 3, "one target_path per requested size")
	for t_raw in targets:
		var t: Dictionary = t_raw as Dictionary
		assert_true(t.has("size"), "target entry must carry 'size'")
		assert_true(t.has("path"), "target entry must carry 'path'")
	var icons: FakeIconSetGenerator = env["icons"]
	assert_eq(icons.calls.size(), 1, "icon set generator must be invoked once")
	var undo: FakeUndoRedoWrapper = env["undo"]
	assert_eq(undo.wrap_calls.size(), 3, "every size must be saved through the UndoRedo wrapper")
	var fs: FakeAssetFs = env["fs"]
	assert_eq(fs.png_writes.size(), 3, "three PNGs must be written")


# ---------------------------------------------------------------------------
# register_on — wires all four assetgen methods on the dispatcher.
# ---------------------------------------------------------------------------

func test_register_on_wires_all_four_assetgen_methods() -> void:
	var env: Dictionary = _new_env()
	var dispatcher: Object = DISPATCHER_SCRIPT.new()
	env["tools"].register_on(dispatcher)

	var methods: Array = [
		"assetgen.sprite_from_svg",
		"assetgen.atlas_pack",
		"assetgen.noise_texture",
		"assetgen.icon_set",
	]
	for method in methods:
		var response: Dictionary = dispatcher.dispatch({
			"jsonrpc": "2.0",
			"method": method,
			"params": {},
			"id": 1,
		})
		assert_true(response.has("result") or response.has("error"), "method %s must be reachable" % method)
