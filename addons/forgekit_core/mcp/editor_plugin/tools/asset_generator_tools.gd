extends RefCounted
## McpAssetGeneratorTools — JSON-RPC handler adapter for the four
## Asset Generation MCP tools.
##
##   assetgen.sprite_from_svg(svg_source, target_path, size?)
##   assetgen.atlas_pack(source_paths, target_path, max_size?)
##   assetgen.noise_texture(target_path, width, height, noise_type, seed?)
##   assetgen.icon_set(source_svg, target_dir, sizes)
##
## The adapter is intentionally thin. It rasterizes / packs / noise-fills
## through injected backends (McpSvgRasterizer, McpTexturePacker,
## McpNoiseGenerator, McpIconSetGenerator) and routes every file write
## through an injected McpUndoRedoWrapper so a single Ctrl+Z reverts the
## mutation. A small McpAssetFs facade decouples the adapter from Image's
## save_png / ResourceSaver.save so tests can assert the exact side-effect
## without touching the filesystem.


class_name McpAssetGeneratorTools


const _SVG_RASTERIZER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/asset_generator/svg_rasterizer.gd")
const _TEXTURE_PACKER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/asset_generator/texture_packer.gd")
const _NOISE_GENERATOR_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/asset_generator/noise_generator.gd")
const _ICON_SET_GENERATOR_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/asset_generator/icon_set_generator.gd")

const _DEFAULT_SPRITE_SIZE: int = 64
const _DEFAULT_ATLAS_MAX_SIZE: int = 1024


var _svg_rasterizer: Object = null
var _texture_packer: Object = null
var _noise_generator: Object = null
var _icon_set_generator: Object = null
var _undo_redo_wrapper: Object = null
var _asset_fs: Object = null


# ---------------------------------------------------------------------------
# Setters / injection. Each collaborator is optional at construction so the
# adapter remains a plain data holder; in production wiring the editor
# plugin hands in real instances through the setters below.
# ---------------------------------------------------------------------------

func set_svg_rasterizer(rasterizer: Object) -> void:
	_svg_rasterizer = rasterizer


func set_texture_packer(packer: Object) -> void:
	_texture_packer = packer


func set_noise_generator(generator: Object) -> void:
	_noise_generator = generator


func set_icon_set_generator(generator: Object) -> void:
	_icon_set_generator = generator


func set_undo_redo_wrapper(wrapper: Object) -> void:
	_undo_redo_wrapper = wrapper


func set_asset_fs(fs: Object) -> void:
	_asset_fs = fs


# ---------------------------------------------------------------------------
# MCP handlers.
# ---------------------------------------------------------------------------

func sprite_from_svg(params: Variant) -> Variant:
	var svg_source: String = _get_string_param(params, "svg_source", 0, "")
	var target_path: String = _get_string_param(params, "target_path", 1, "")
	var size: int = _get_int_param(params, "size", 2, _DEFAULT_SPRITE_SIZE)

	var rasterizer: Object = _svg_rasterizer if _svg_rasterizer != null else _SVG_RASTERIZER_SCRIPT.new()
	var image: Image = rasterizer.rasterize(svg_source, size) as Image
	if image == null:
		return {
			"error": {
				"code": -32011,
				"message": "SVG_RASTERIZE_FAILED",
				"data": {"suggestion": "Verify the SVG source is well-formed and non-empty."},
			},
		}

	var fs: Object = _asset_fs if _asset_fs != null else _default_fs()
	var do_c: Callable = func() -> void:
		fs.save_png(image, target_path)
	var undo_c: Callable = func() -> void:
		fs.remove(target_path)
	_wrap("assetgen.sprite_from_svg", target_path, do_c, undo_c)

	return {"target_path": target_path, "size": size}


func atlas_pack(params: Variant) -> Variant:
	var source_paths: Array = _get_array_param(params, "source_paths", 0, [])
	var target_path: String = _get_string_param(params, "target_path", 1, "")
	var max_size: int = _get_int_param(params, "max_size", 2, _DEFAULT_ATLAS_MAX_SIZE)

	var images: Array[Image] = []
	var load_errors: Array = []
	for path_raw in source_paths:
		var path: String = String(path_raw)
		var img: Image = Image.new()
		var err: int = img.load(path)
		if err != OK:
			load_errors.append(path)
			continue
		images.append(img)
	if not load_errors.is_empty():
		return {
			"error": {
				"code": -32012,
				"message": "ASSET_LOAD_FAILED",
				"data": {"paths": load_errors, "suggestion": "Ensure every source PNG exists and is readable."},
			},
		}

	var packer: Object = _texture_packer if _texture_packer != null else _TEXTURE_PACKER_SCRIPT.new()
	var pack_result: Dictionary = packer.pack(images, max_size) as Dictionary
	if pack_result.has("error"):
		return {
			"error": {
				"code": -32013,
				"message": "ATLAS_PACK_FAILED",
				"data": {"reason": String(pack_result.get("error", "")), "suggestion": "Increase max_size or drop oversized inputs."},
			},
		}

	var atlas_image: Image = pack_result.get("atlas") as Image
	var placements: Array = pack_result.get("placements", []) as Array
	var tres_path: String = _atlas_tres_path(target_path)
	var atlas_resource: Resource = _build_atlas_resource(placements, source_paths)

	var fs: Object = _asset_fs if _asset_fs != null else _default_fs()
	var do_c: Callable = func() -> void:
		fs.save_png(atlas_image, target_path)
		fs.save_resource(atlas_resource, tres_path)
	var undo_c: Callable = func() -> void:
		fs.remove(target_path)
		fs.remove(tres_path)
	_wrap("assetgen.atlas_pack", target_path, do_c, undo_c)

	return {
		"target_path": target_path,
		"tres_path": tres_path,
		"placements": placements,
	}


func noise_texture(params: Variant) -> Variant:
	var target_path: String = _get_string_param(params, "target_path", 0, "")
	var width: int = _get_int_param(params, "width", 1, 64)
	var height: int = _get_int_param(params, "height", 2, 64)
	var noise_type: String = _get_string_param(params, "noise_type", 3, "perlin")
	var requested_seed: int = _get_int_param(params, "seed", 4, 0)

	var effective_seed: int = requested_seed
	if effective_seed == 0:
		var rng: RandomNumberGenerator = RandomNumberGenerator.new()
		rng.randomize()
		# Clamp away from zero so subsequent runs see a non-zero seed and
		# the caller can reproduce the texture.
		effective_seed = rng.randi_range(1, 0x7FFFFFFF)

	var generator: Object = _noise_generator if _noise_generator != null else _NOISE_GENERATOR_SCRIPT.new()
	var image: Image = generator.generate(width, height, StringName(noise_type), effective_seed) as Image

	var fs: Object = _asset_fs if _asset_fs != null else _default_fs()
	var do_c: Callable = func() -> void:
		fs.save_png(image, target_path)
	var undo_c: Callable = func() -> void:
		fs.remove(target_path)
	_wrap("assetgen.noise_texture", target_path, do_c, undo_c)

	return {
		"target_path": target_path,
		"width": width,
		"height": height,
		"noise_type": noise_type,
		"seed": effective_seed,
	}


func icon_set(params: Variant) -> Variant:
	var source_svg: String = _get_string_param(params, "source_svg", 0, "")
	var target_dir: String = _get_string_param(params, "target_dir", 1, "")
	var sizes_raw: Array = _get_array_param(params, "sizes", 2, [])

	var sizes_typed: Array[int] = []
	for s in sizes_raw:
		sizes_typed.append(int(s))

	var generator: Object = _icon_set_generator if _icon_set_generator != null else _ICON_SET_GENERATOR_SCRIPT.new()
	var icons: Array = generator.generate(source_svg, sizes_typed) as Array

	var targets: Array = []
	var fs: Object = _asset_fs if _asset_fs != null else _default_fs()
	for icon_raw in icons:
		var icon: Dictionary = icon_raw as Dictionary
		var size: int = int(icon.get("size", 0))
		var image: Image = icon.get("image") as Image
		if image == null:
			continue
		var icon_path: String = "%s/%d.png" % [target_dir.trim_suffix("/"), size]
		var do_c: Callable = func() -> void:
			fs.save_png(image, icon_path)
		var undo_c: Callable = func() -> void:
			fs.remove(icon_path)
		_wrap("assetgen.icon_set", icon_path, do_c, undo_c)
		targets.append({"size": size, "path": icon_path})

	return {"target_dir": target_dir, "targets": targets}


## Bulk-register all four Asset Generation MCP methods on the supplied
## dispatcher. Returns `self` so the caller can chain.
func register_on(dispatcher: Object) -> Object:
	dispatcher.register_handler("assetgen.sprite_from_svg", Callable(self, "sprite_from_svg"))
	dispatcher.register_handler("assetgen.atlas_pack", Callable(self, "atlas_pack"))
	dispatcher.register_handler("assetgen.noise_texture", Callable(self, "noise_texture"))
	dispatcher.register_handler("assetgen.icon_set", Callable(self, "icon_set"))
	return self


# ---------------------------------------------------------------------------
# Internals.
# ---------------------------------------------------------------------------

func _wrap(tool_name: String, target: String, do_callable: Callable, undo_callable: Callable) -> void:
	if _undo_redo_wrapper == null:
		# No wrapper wired — run the do-callable directly so the tool is
		# still usable for tests that deliberately skip UndoRedo wiring.
		do_callable.call()
		return
	_undo_redo_wrapper.wrap(tool_name, target, do_callable, undo_callable)


static func _atlas_tres_path(atlas_png_path: String) -> String:
	# `foo/bar.png` → `foo/bar.atlas.tres`. Falls back to appending
	# `.atlas.tres` when the input has no dot (rare).
	var last_dot: int = atlas_png_path.rfind(".")
	if last_dot == -1:
		return atlas_png_path + ".atlas.tres"
	return atlas_png_path.substr(0, last_dot) + ".atlas.tres"


static func _build_atlas_resource(placements: Array, source_paths: Array) -> Resource:
	# Produce a plain Resource carrying the atlas manifest so the file
	# saved alongside the atlas PNG is inspectable at runtime. Fields
	# follow the {source_paths, placements} shape documented in the
	# MCP API reference.
	var res: Resource = Resource.new()
	res.set_meta("source_paths", source_paths.duplicate())
	res.set_meta("placements", placements.duplicate())
	return res


func _default_fs() -> Object:
	# Default facade that writes PNGs through Image.save_png and saves
	# Resources through ResourceSaver. Tests inject a fake; production
	# wiring hands in the same helper pre-wrapped with UndoRedo.
	return _DefaultAssetFs.new()


class _DefaultAssetFs:
	extends RefCounted

	func save_png(image: Image, path: String) -> int:
		return image.save_png(path)

	func remove(path: String) -> int:
		if FileAccess.file_exists(path):
			return DirAccess.remove_absolute(ProjectSettings.globalize_path(path))
		return OK

	func save_resource(resource: Resource, path: String) -> int:
		return ResourceSaver.save(resource, path)


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


static func _get_array_param(params: Variant, key: String, index: int, default_value: Array) -> Array:
	if params is Dictionary:
		var dict: Dictionary = params as Dictionary
		if dict.has(key):
			var v: Variant = dict[key]
			if v is Array:
				return v as Array
	elif params is Array:
		var arr: Array = params as Array
		if index >= 0 and index < arr.size():
			var v: Variant = arr[index]
			if v is Array:
				return v as Array
	return default_value
