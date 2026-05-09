extends GutTest
## Unit tests for McpShaderTools: JSON-RPC handler adapter for the six
## editor-channel Shader MCP tools on top of a duck-typed ShaderBackend.
##
##   shader.create(path, template?)                               (UndoRedo)
##   shader.validate(source)                                      → {ok, errors}
##   shader.save_with_validation(path, source)                    (UndoRedo, validate-first)
##   shader.set_uniform(material_path, uniform, value)            (UndoRedo)
##   shader.list_uniforms(material_path)                          → {uniforms}
##   shader.convert_visual_to_text(visual_shader_path, target_path)  (UndoRedo)


const SHADER_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/tools/shader_tools.gd")
const DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")


class FakeShaderBackend:
	extends RefCounted

	var calls: Array = []

	func create_shader(path: String, template: String) -> Variant:
		calls.append({"op": "create_shader", "path": path, "template": template})
		return {"path": path}

	func validate_shader(source: String) -> Variant:
		calls.append({"op": "validate_shader", "source": source})
		return {"ok": true, "errors": []}

	func save_with_validation(path: String, source: String) -> Variant:
		calls.append({"op": "save_with_validation", "path": path, "source": source})
		return {"path": path, "size_bytes": source.length()}

	func set_uniform(material_path: String, uniform: String, value: Variant) -> Variant:
		calls.append({
			"op": "set_uniform",
			"material_path": material_path,
			"uniform": uniform,
			"value": value,
		})
		return {"applied": true}

	func list_uniforms(material_path: String) -> Variant:
		calls.append({"op": "list_uniforms", "material_path": material_path})
		return {"uniforms": [{"name": "tint", "type": "vec4", "default_value": [1.0, 1.0, 1.0, 1.0]}]}

	func convert_visual_to_text(visual_shader_path: String, target_path: String) -> Variant:
		calls.append({
			"op": "convert_visual_to_text",
			"visual_shader_path": visual_shader_path,
			"target_path": target_path,
		})
		return {"target_path": target_path}

	func find_calls(op: String) -> Array:
		var out: Array = []
		for c in calls:
			if (c as Dictionary).get("op", "") == op:
				out.append(c)
		return out


func _new_env() -> Dictionary:
	var backend: FakeShaderBackend = FakeShaderBackend.new()
	var tools: Object = SHADER_TOOLS_SCRIPT.new(backend)
	return {"backend": backend, "tools": tools}


func test_create_forwards_path_and_default_template() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).create({"path": "res://a.gdshader"})
	var call: Dictionary = (env["backend"] as FakeShaderBackend).find_calls("create_shader")[0]
	assert_eq(call.get("template", ""), "canvas_item",
		"template defaults to canvas_item when absent")


func test_create_forwards_explicit_template() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).create({"path": "res://a.gdshader", "template": "spatial"})
	var call: Dictionary = (env["backend"] as FakeShaderBackend).find_calls("create_shader")[0]
	assert_eq(call.get("template", ""), "spatial", "explicit template forwarded")


func test_validate_forwards_source() -> void:
	var env: Dictionary = _new_env()
	var result: Variant = (env["tools"] as Object).validate({"source": "shader_type canvas_item;"})
	var call: Dictionary = (env["backend"] as FakeShaderBackend).find_calls("validate_shader")[0]
	assert_eq(call.get("source", ""), "shader_type canvas_item;", "source forwarded")
	assert_eq((result as Dictionary).get("ok", false), true, "ok flag returned")


func test_save_with_validation_forwards_path_and_source() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).save_with_validation({
		"path": "res://a.gdshader",
		"source": "shader_type canvas_item;",
	})
	var call: Dictionary = (env["backend"] as FakeShaderBackend).find_calls("save_with_validation")[0]
	assert_eq(call.get("path", ""), "res://a.gdshader", "path forwarded")


func test_set_uniform_forwards_value_verbatim() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).set_uniform({
		"material_path": "res://m.tres",
		"uniform": "tint",
		"value": "#00ff00",
	})
	var call: Dictionary = (env["backend"] as FakeShaderBackend).find_calls("set_uniform")[0]
	assert_eq(call.get("uniform", ""), "tint", "uniform forwarded")
	assert_eq(call.get("value", null), "#00ff00", "value forwarded verbatim for Smart_Type_Parser")


func test_list_uniforms_forwards_material_path() -> void:
	var env: Dictionary = _new_env()
	var result: Variant = (env["tools"] as Object).list_uniforms({"material_path": "res://m.tres"})
	assert_true(((result as Dictionary).get("uniforms", []) as Array).size() > 0,
		"uniforms returned")


func test_convert_visual_to_text_forwards_paths() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).convert_visual_to_text({
		"visual_shader_path": "res://v.tres",
		"target_path": "res://t.gdshader",
	})
	var call: Dictionary = (env["backend"] as FakeShaderBackend).find_calls("convert_visual_to_text")[0]
	assert_eq(call.get("target_path", ""), "res://t.gdshader", "target_path forwarded")


func test_register_on_wires_all_six_shader_methods() -> void:
	var env: Dictionary = _new_env()
	var dispatcher: Object = DISPATCHER_SCRIPT.new()
	(env["tools"] as Object).register_on(dispatcher)
	var expected: Array = [
		"shader.create",
		"shader.validate",
		"shader.save_with_validation",
		"shader.set_uniform",
		"shader.list_uniforms",
		"shader.convert_visual_to_text",
	]
	var req_id: int = 1
	for method in expected:
		var resp: Dictionary = dispatcher.dispatch({
			"jsonrpc": "2.0",
			"method": method,
			"params": {},
			"id": req_id,
		})
		assert_true(resp.has("result"), "Method %s must reach the adapter" % method)
		req_id += 1
