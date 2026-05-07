class_name TresLoader
extends RefCounted
## Loader that validates a .tres file against an expected class schema.
## Returns either { ok = true, resource } or { ok = false, errors } where each
## error dictionary has keys { path, field, expected_type }.


# Top-level .tres keys that the Godot resource format always allows and that
# must not be reported as unknown fields. Declared as a plain Array literal
# because Godot 4 does not accept PackedStringArray(...) as a constant
# expression; Array.has() and Array iteration provide the same semantics the
# callers rely on.
const _SYSTEM_KEYS: Array = [
	"script",
	"resource_path",
	"resource_name",
	"resource_local_to_scene",
]

# Regex matching a single-line `key = value` declaration. Keys are ASCII
# identifiers; values are everything on the rest of the line.
const _ASSIGNMENT_PATTERN: String = "^([A-Za-z_][A-Za-z0-9_]*)\\s*=\\s*(.+)$"


## Loads `path` and validates it against the declared schema of `expected_class`.
static func load_validated(path: String, expected_class: String) -> Dictionary:
	var errors: Array = []

	var text: String = _read_text(path)
	if text.is_empty():
		errors.append({
			"path": path,
			"field": "",
			"expected_type": "<file>",
		})
		return {"ok": false, "errors": errors}

	var schema: Dictionary = _build_schema(expected_class)

	var raw_fields: Array = _extract_resource_fields(text)
	for pair in raw_fields:
		var field: String = pair["field"]
		var literal: String = pair["literal"]

		if _SYSTEM_KEYS.has(field):
			continue

		if not schema.has(field):
			errors.append({
				"path": path,
				"field": field,
				"expected_type": "<unknown>",
			})
			continue

		var expected_type_name: String = schema[field]
		var literal_type_name: String = _infer_literal_type_name(literal)
		if literal_type_name != "" and not _types_match(expected_type_name, literal_type_name):
			errors.append({
				"path": path,
				"field": field,
				"expected_type": expected_type_name,
			})

	if errors.size() > 0:
		return {"ok": false, "errors": errors}

	var loaded: Resource = load(path)
	if loaded == null:
		errors.append({
			"path": path,
			"field": "",
			"expected_type": "<load-failed>",
		})
		return {"ok": false, "errors": errors}

	return {"ok": true, "resource": loaded}


## Reads the file at `path` as UTF-8 text; returns an empty string if unreadable.
static func _read_text(path: String) -> String:
	if not FileAccess.file_exists(path):
		return ""
	var file: FileAccess = FileAccess.open(path, FileAccess.READ)
	if file == null:
		return ""
	var text: String = file.get_as_text()
	file.close()
	return text


## Builds a {field_name: type_name} map for `expected_class` by instantiating a
## fresh object and inspecting its storage-eligible property list.
static func _build_schema(expected_class: String) -> Dictionary:
	var schema: Dictionary = {}
	var script_path: String = _resolve_class_script(expected_class)
	if script_path.is_empty():
		return schema
	var script: Script = load(script_path) as Script
	if script == null:
		return schema
	var instance: Object = script.new()
	if instance == null:
		return schema
	for property in instance.get_property_list():
		var usage: int = int(property.get("usage", 0))
		if (usage & PROPERTY_USAGE_STORAGE) == 0:
			continue
		var property_name: String = String(property.get("name", ""))
		if property_name.is_empty():
			continue
		if _SYSTEM_KEYS.has(property_name):
			continue
		schema[property_name] = _property_type_name(property)
	return schema


## Returns the script path for a class registered via class_name, or empty
## string if the class is unknown. Uses the global script class list so new
## resources pick up automatically without a manual registration step.
static func _resolve_class_script(expected_class: String) -> String:
	var classes: Array = ProjectSettings.get_global_class_list()
	for entry in classes:
		if String(entry.get("class", "")) == expected_class:
			return String(entry.get("path", ""))
	return ""


## Converts a property-list entry to a human-readable type name. Prefers the
## hint_string for typed objects so Texture2D is reported as "Texture2D"
## rather than the generic "Object".
static func _property_type_name(property: Dictionary) -> String:
	var variant_type: int = int(property.get("type", TYPE_NIL))
	if variant_type == TYPE_OBJECT:
		var hint_string: String = String(property.get("hint_string", ""))
		if not hint_string.is_empty():
			return hint_string
		return "Object"
	return type_string(variant_type)


## Returns true when an inferred literal type is an acceptable substitute for
## the declared type. Integer literals are allowed for float fields because
## Godot coerces `1` to `1.0` transparently. Object-typed fields accept any
## resource reference literal; Godot's own loader validates the concrete class.
static func _types_match(expected_type_name: String, literal_type_name: String) -> bool:
	if expected_type_name == literal_type_name:
		return true
	if expected_type_name == "float" and literal_type_name == "int":
		return true
	if expected_type_name == "StringName" and literal_type_name == "String":
		return true
	if literal_type_name == "Object" and _looks_like_object_type(expected_type_name):
		return true
	if literal_type_name == "Nil":
		return true
	return false


## Returns true if the declared type name looks like an object/resource class
## (starts with an uppercase letter). Variant primitives use lowercase names
## such as "int", "float", "bool".
static func _looks_like_object_type(type_name: String) -> bool:
	if type_name.is_empty():
		return false
	var first: String = type_name.substr(0, 1)
	return first == first.to_upper() and first != first.to_lower()


## Scans `text` for the first `[resource]` section header and returns the
## `key = value` pairs declared inside it. Subsequent `[sub_resource]` or
## `[ext_resource]` sections are ignored.
static func _extract_resource_fields(text: String) -> Array:
	var results: Array = []
	var lines: PackedStringArray = text.split("\n", false)
	var in_resource_section: bool = false
	var regex: RegEx = RegEx.new()
	regex.compile(_ASSIGNMENT_PATTERN)

	for raw_line in lines:
		var line: String = String(raw_line).strip_edges()
		if line.is_empty():
			continue
		if line.begins_with("["):
			in_resource_section = line.begins_with("[resource]")
			continue
		if not in_resource_section:
			continue
		if line.begins_with(";"):
			continue
		var match_result: RegExMatch = regex.search(line)
		if match_result == null:
			continue
		results.append({
			"field": match_result.get_string(1),
			"literal": match_result.get_string(2).strip_edges(),
		})
	return results


## Infers a Godot variant type name from a raw .tres literal by inspecting its
## first characters. Returns an empty string when the literal is too complex
## to classify confidently; in that case the caller skips type checking.
static func _infer_literal_type_name(literal: String) -> String:
	if literal.is_empty():
		return ""

	if literal.begins_with("&\""):
		return "StringName"
	if literal.begins_with("\""):
		return "String"
	if literal == "true" or literal == "false":
		return "bool"
	if literal == "null":
		return "Nil"
	if literal.begins_with("["):
		return "Array"
	if literal.begins_with("{"):
		return "Dictionary"
	if literal.begins_with("ExtResource") or literal.begins_with("SubResource") or literal.begins_with("Resource("):
		return "Object"

	var constructor_names: PackedStringArray = PackedStringArray([
		"Vector2", "Vector2i", "Vector3", "Vector3i", "Vector4", "Vector4i",
		"Color", "Rect2", "Rect2i", "Transform2D", "Transform3D",
		"Basis", "Quaternion", "Plane", "AABB",
		"PackedByteArray", "PackedInt32Array", "PackedInt64Array",
		"PackedFloat32Array", "PackedFloat64Array", "PackedStringArray",
		"PackedVector2Array", "PackedVector3Array", "PackedColorArray",
		"NodePath",
	])
	for constructor_name in constructor_names:
		if literal.begins_with(constructor_name + "("):
			return constructor_name

	if _looks_like_int(literal):
		return "int"
	if _looks_like_float(literal):
		return "float"

	return ""


static func _looks_like_int(literal: String) -> bool:
	var body: String = literal
	if body.begins_with("-") or body.begins_with("+"):
		body = body.substr(1)
	if body.is_empty():
		return false
	for c in body:
		if c < "0" or c > "9":
			return false
	return true


static func _looks_like_float(literal: String) -> bool:
	var body: String = literal
	if body.begins_with("-") or body.begins_with("+"):
		body = body.substr(1)
	if body.is_empty():
		return false
	var seen_digit: bool = false
	var seen_dot: bool = false
	var seen_exp: bool = false
	for i in range(body.length()):
		var c: String = body[i]
		if c >= "0" and c <= "9":
			seen_digit = true
		elif c == ".":
			if seen_dot or seen_exp:
				return false
			seen_dot = true
		elif c == "e" or c == "E":
			if seen_exp or not seen_digit:
				return false
			seen_exp = true
			seen_digit = false
		elif (c == "-" or c == "+") and i > 0 and (body[i - 1] == "e" or body[i - 1] == "E"):
			continue
		else:
			return false
	return seen_digit
