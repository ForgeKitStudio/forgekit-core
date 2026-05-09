extends RefCounted
## McpNoiseGenerator — produces a single-channel grayscale noise image
## using Godot's built-in `FastNoiseLite`.
##
## `generate(width, height, noise_type, seed)` returns an Image with
## `FORMAT_L8` (one byte per pixel) where each pixel is
## `round((noise + 1) * 127.5)` mapped into [0, 255].
##
## Supported `noise_type` StringNames:
##   &"perlin"   → FastNoiseLite.TYPE_PERLIN
##   &"simplex"  → FastNoiseLite.TYPE_SIMPLEX_SMOOTH
##   &"cellular" → FastNoiseLite.TYPE_CELLULAR
## Unknown values fall back to TYPE_PERLIN with a push_warning so callers
## notice the mistake rather than silently getting default output.


class_name McpNoiseGenerator


func generate(width: int, height: int, noise_type: StringName = &"perlin", seed: int = 0) -> Image:
	var noise: FastNoiseLite = FastNoiseLite.new()
	noise.seed = seed
	noise.noise_type = _resolve_noise_type(noise_type)
	var image: Image = Image.create(max(width, 1), max(height, 1), false, Image.FORMAT_L8)
	for y in range(height):
		for x in range(width):
			var v: float = noise.get_noise_2d(float(x), float(y))
			var grayscale: int = int(round((v + 1.0) * 127.5))
			grayscale = clampi(grayscale, 0, 255)
			image.set_pixel(x, y, Color8(grayscale, grayscale, grayscale))
	return image


static func _resolve_noise_type(noise_type: StringName) -> int:
	match noise_type:
		&"perlin":
			return FastNoiseLite.TYPE_PERLIN
		&"simplex":
			return FastNoiseLite.TYPE_SIMPLEX_SMOOTH
		&"cellular":
			return FastNoiseLite.TYPE_CELLULAR
		_:
			push_warning("NOISE_TYPE_UNKNOWN: %s — falling back to TYPE_PERLIN" % String(noise_type))
			return FastNoiseLite.TYPE_PERLIN
