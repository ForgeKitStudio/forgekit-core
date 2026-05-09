extends RefCounted
## McpSvgRasterizer — rasterizes an SVG source string to an Image at the
## requested square size via Godot's built-in SVG loader.
##
## The rasterizer is intentionally thin: it wraps
## `Image.load_svg_from_buffer(...)` with a size argument that maps the
## default 64px authoring size to the caller-provided target pixel size.
## A null return indicates the loader rejected the input; the caller can
## treat that as an assetgen tool failure.


class_name McpSvgRasterizer


const _AUTHORING_SIZE_PX: int = 64


## Rasterize `svg_source` to an Image of `size` by `size` pixels. Returns
## `null` and emits `push_warning("SVG_RASTERIZE_FAILED: ...")` when the
## loader rejects the input. `size` values <= 0 are coerced to the
## authoring default so the method is robust against stray zeros.
func rasterize(svg_source: String, size: int = 64) -> Image:
	if svg_source.is_empty():
		push_warning("SVG_RASTERIZE_FAILED: empty SVG source")
		return null
	var effective_size: int = size if size > 0 else _AUTHORING_SIZE_PX
	var scale: float = float(effective_size) / float(_AUTHORING_SIZE_PX)
	var image: Image = Image.new()
	var err: int = image.load_svg_from_buffer(svg_source.to_utf8_buffer(), scale)
	if err != OK:
		push_warning("SVG_RASTERIZE_FAILED: load_svg_from_buffer returned error %d" % err)
		return null
	# Godot rasterizes the SVG at (source_size * scale). For source size
	# 64 and a caller-requested effective_size, the rasterized image is
	# already effective_size x effective_size. Guard against SVG sources
	# whose intrinsic size differs from 64 by forcing a resize to the
	# requested square.
	if image.get_width() != effective_size or image.get_height() != effective_size:
		image.resize(effective_size, effective_size, Image.INTERPOLATE_BILINEAR)
	return image
