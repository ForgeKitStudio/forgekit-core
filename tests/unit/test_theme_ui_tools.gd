extends GutTest
## Unit tests for McpThemeUiTools: JSON-RPC handler adapter that exposes
## the six editor-channel Theme and UI MCP tools on top of a duck-typed
## ThemeUiBackend.
##
##   theme.create(path)                                                     (UndoRedo)
##   theme.set_default_font(path, font_path, size)                          (UndoRedo)
##   theme.set_color(path, class_name, color_name, value)                   (UndoRedo)
##   theme.set_stylebox(path, class_name, stylebox_name, stylebox_resource_path)  (UndoRedo)
##   ui.build_control_tree(scene_path, spec)                                (UndoRedo)
##   ui.apply_layout_preset(node_path, preset)                              (UndoRedo)


const THEME_UI_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/tools/theme_ui_tools.gd")
const DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")


class FakeThemeUiBackend:
	extends RefCounted

	var calls: Array = []

	func create_theme(path: String) -> Variant:
		calls.append({"op": "create_theme", "path": path})
		return {"path": path}

	func set_default_font(path: String, font_path: String, size: int) -> Variant:
		calls.append({"op": "set_default_font", "path": path, "font_path": font_path, "size": size})
		return {"applied": true}

	func set_color(path: String, class_name_: String, color_name: String, value: Variant) -> Variant:
		calls.append({
			"op": "set_color",
			"path": path,
			"class_name": class_name_,
			"color_name": color_name,
			"value": value,
		})
		return {"applied": true}

	func set_stylebox(path: String, class_name_: String, stylebox_name: String, stylebox_resource_path: String) -> Variant:
		calls.append({
			"op": "set_stylebox",
			"path": path,
			"class_name": class_name_,
			"stylebox_name": stylebox_name,
			"stylebox_resource_path": stylebox_resource_path,
		})
		return {"applied": true}

	func build_control_tree(scene_path: String, spec: Dictionary) -> Variant:
		calls.append({"op": "build_control_tree", "scene_path": scene_path, "spec": spec})
		return {"root_path": "/root/UI"}

	func apply_layout_preset(node_path: String, preset: String) -> Variant:
		calls.append({"op": "apply_layout_preset", "node_path": node_path, "preset": preset})
		return {"applied": true, "preset": preset}

	func find_calls(op: String) -> Array:
		var out: Array = []
		for c in calls:
			if (c as Dictionary).get("op", "") == op:
				out.append(c)
		return out


func _new_env() -> Dictionary:
	var backend: FakeThemeUiBackend = FakeThemeUiBackend.new()
	var tools: Object = THEME_UI_TOOLS_SCRIPT.new(backend)
	return {"backend": backend, "tools": tools}


func test_theme_create_forwards_path() -> void:
	var env: Dictionary = _new_env()
	var result: Variant = (env["tools"] as Object).create({"path": "res://theme.tres"})
	var call: Dictionary = (env["backend"] as FakeThemeUiBackend).find_calls("create_theme")[0]
	assert_eq(call.get("path", ""), "res://theme.tres", "path forwarded")
	assert_eq((result as Dictionary).get("path", ""), "res://theme.tres", "path returned")


func test_theme_set_default_font_forwards_all_params() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).set_default_font({
		"path": "res://theme.tres",
		"font_path": "res://fonts/a.ttf",
		"size": 16,
	})
	var call: Dictionary = (env["backend"] as FakeThemeUiBackend).find_calls("set_default_font")[0]
	assert_eq(call.get("size", -1), 16, "size forwarded")
	assert_eq(call.get("font_path", ""), "res://fonts/a.ttf", "font_path forwarded")


func test_theme_set_color_forwards_value_verbatim() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).set_color({
		"path": "res://theme.tres",
		"class_name": "Button",
		"color_name": "font_color",
		"value": "#ff0000",
	})
	var call: Dictionary = (env["backend"] as FakeThemeUiBackend).find_calls("set_color")[0]
	assert_eq(call.get("class_name", ""), "Button", "class_name forwarded")
	assert_eq(call.get("value", null), "#ff0000", "value forwarded verbatim for Smart_Type_Parser")


func test_theme_set_stylebox_forwards_all_params() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).set_stylebox({
		"path": "res://theme.tres",
		"class_name": "Panel",
		"stylebox_name": "panel",
		"stylebox_resource_path": "res://stylebox/a.tres",
	})
	var call: Dictionary = (env["backend"] as FakeThemeUiBackend).find_calls("set_stylebox")[0]
	assert_eq(call.get("stylebox_name", ""), "panel", "stylebox_name forwarded")
	assert_eq(call.get("stylebox_resource_path", ""), "res://stylebox/a.tres",
		"stylebox_resource_path forwarded")


func test_ui_build_control_tree_forwards_spec() -> void:
	var env: Dictionary = _new_env()
	var spec: Dictionary = {"type": "Control", "children": [{"type": "Label", "text": "Hi"}]}
	var _r: Variant = (env["tools"] as Object).build_control_tree({
		"scene_path": "res://scenes/ui.tscn",
		"spec": spec,
	})
	var call: Dictionary = (env["backend"] as FakeThemeUiBackend).find_calls("build_control_tree")[0]
	assert_eq(call.get("spec", {}), spec, "spec forwarded verbatim")


func test_ui_apply_layout_preset_forwards_preset() -> void:
	var env: Dictionary = _new_env()
	var _r: Variant = (env["tools"] as Object).apply_layout_preset({
		"node_path": "/root/UI/Panel",
		"preset": "full_rect",
	})
	var call: Dictionary = (env["backend"] as FakeThemeUiBackend).find_calls("apply_layout_preset")[0]
	assert_eq(call.get("preset", ""), "full_rect", "preset forwarded")


func test_register_on_wires_all_six_theme_ui_methods() -> void:
	var env: Dictionary = _new_env()
	var dispatcher: Object = DISPATCHER_SCRIPT.new()
	(env["tools"] as Object).register_on(dispatcher)
	var expected: Array = [
		"theme.create",
		"theme.set_default_font",
		"theme.set_color",
		"theme.set_stylebox",
		"ui.build_control_tree",
		"ui.apply_layout_preset",
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
