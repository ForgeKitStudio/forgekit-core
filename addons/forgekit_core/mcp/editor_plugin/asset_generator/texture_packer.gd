extends RefCounted
## McpTexturePacker — shelf packing for texture atlases.
##
## `pack(images, max_size)` sorts images by height descending, then walks
## them left-to-right into rows ("shelves") whose height is the tallest
## image on that row. When an image won't fit horizontally on the current
## shelf, a new shelf opens below. When any single image (or the running
## vertical offset) exceeds `max_size`, `pack` aborts and returns an
## `{error: "exceeds_max_size"}` envelope so the caller can surface a
## deterministic failure rather than silently clipping the atlas.


class_name McpTexturePacker


## Pack `images` into a single atlas no larger than `max_size` x `max_size`.
## Returns either `{atlas, placements}` or `{error}`.
func pack(images: Array[Image], max_size: int = 2048) -> Dictionary:
	if images.is_empty():
		var empty_atlas: Image = Image.create(1, 1, false, Image.FORMAT_RGBA8)
		return {"atlas": empty_atlas, "placements": []}

	# Build an array of {index, image, width, height} then sort by
	# height descending — shelf packing's standard pre-pass. Keep the
	# original index so placements can be reported against the caller's
	# input ordering.
	var ordered: Array = []
	for i in range(images.size()):
		var img: Image = images[i]
		if img.get_width() > max_size or img.get_height() > max_size:
			return {"error": "exceeds_max_size"}
		ordered.append({
			"index": i,
			"image": img,
			"width": img.get_width(),
			"height": img.get_height(),
		})
	ordered.sort_custom(func(a, b) -> bool:
		return int((a as Dictionary).get("height", 0)) > int((b as Dictionary).get("height", 0))
	)

	# Walk the ordered list placing each image into the current shelf.
	var shelf_x: int = 0
	var shelf_y: int = 0
	var shelf_height: int = 0
	var max_used_width: int = 0
	var placements: Array = []
	for entry_raw in ordered:
		var entry: Dictionary = entry_raw as Dictionary
		var w: int = int(entry["width"])
		var h: int = int(entry["height"])
		if shelf_x + w > max_size:
			# Shelf is full; move to a fresh one below.
			shelf_y += shelf_height
			shelf_x = 0
			shelf_height = 0
		if shelf_y + h > max_size:
			return {"error": "exceeds_max_size"}
		placements.append({
			"index": int(entry["index"]),
			"x": shelf_x,
			"y": shelf_y,
			"width": w,
			"height": h,
		})
		shelf_x += w
		if w > 0 and shelf_x > max_used_width:
			max_used_width = shelf_x
		if h > shelf_height:
			shelf_height = h

	var atlas_width: int = max_used_width if max_used_width > 0 else 1
	var atlas_height: int = (shelf_y + shelf_height) if shelf_height > 0 else 1
	var atlas: Image = Image.create(atlas_width, atlas_height, false, Image.FORMAT_RGBA8)
	for p_raw in placements:
		var p: Dictionary = p_raw as Dictionary
		var src: Image = images[int(p["index"])]
		atlas.blit_rect(src, Rect2i(0, 0, src.get_width(), src.get_height()), Vector2i(int(p["x"]), int(p["y"])))

	# Sort placements back into input-index order for callers that want
	# a stable mapping from input to placement.
	placements.sort_custom(func(a, b) -> bool:
		return int((a as Dictionary).get("index", 0)) < int((b as Dictionary).get("index", 0))
	)

	return {"atlas": atlas, "placements": placements}
