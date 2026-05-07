extends GutTest
## Unit tests for the MCP editor plugin scaffolding. Verify that the script
## compiles as GDScript, declares @tool, extends EditorPlugin, and registers
## the McpEditorPlugin autoload inside _enter_tree (and removes it in
## _exit_tree) so the runtime bridge singleton is available while the plugin
## is active in the editor.


const MCP_EDITOR_PLUGIN_PATH: String = "res://addons/forgekit_core/mcp/editor_plugin/plugin.gd"


func _load_source_text() -> String:
	var file: FileAccess = FileAccess.open(MCP_EDITOR_PLUGIN_PATH, FileAccess.READ)
	assert_not_null(file, "Plugin script must exist at %s" % MCP_EDITOR_PLUGIN_PATH)
	var text: String = file.get_as_text()
	file.close()
	return text


func _first_significant_line(text: String) -> String:
	for raw_line in text.split("\n"):
		var line: String = (raw_line as String).strip_edges()
		if line.is_empty():
			continue
		if line.begins_with("#"):
			continue
		return line
	return ""


# ---------------------------------------------------------------------------
# Script loads and is typed correctly
# ---------------------------------------------------------------------------

func test_script_loads_as_gdscript() -> void:
	var script: Resource = load(MCP_EDITOR_PLUGIN_PATH)
	assert_not_null(script, "Plugin script must load via ResourceLoader")
	assert_true(script is GDScript, "Loaded resource must be a GDScript")


func test_script_declares_tool_annotation_at_top() -> void:
	var source: String = _load_source_text()
	var first: String = _first_significant_line(source)
	assert_true(
		first.begins_with("@tool"),
		"First non-blank, non-comment line must declare @tool; got: '%s'" % first
	)


func test_script_extends_editor_plugin() -> void:
	var source: String = _load_source_text()
	assert_true(
		source.find("extends EditorPlugin") != -1,
		"Plugin script must extend EditorPlugin"
	)


# ---------------------------------------------------------------------------
# Autoload lifecycle is wired into _enter_tree / _exit_tree
# ---------------------------------------------------------------------------

func _extract_function_body(source: String, func_signature: String) -> String:
	# Returns the text of a function body by slicing from the function signature
	# up to the next top-level `func ` declaration (or end of file). Good enough
	# for scaffolding assertions since the plugin.gd file is small.
	var start: int = source.find(func_signature)
	if start == -1:
		return ""
	var after_signature: int = start + func_signature.length()
	var next_func: int = source.find("\nfunc ", after_signature)
	if next_func == -1:
		return source.substr(after_signature)
	return source.substr(after_signature, next_func - after_signature)


func test_script_declares_mcp_editor_plugin_autoload_name() -> void:
	var source: String = _load_source_text()
	assert_true(
		source.find("\"McpEditorPlugin\"") != -1,
		"Plugin source must reference the autoload name \"McpEditorPlugin\" (directly or via a constant)"
	)


func test_enter_tree_registers_mcp_editor_plugin_autoload() -> void:
	var source: String = _load_source_text()
	var body: String = _extract_function_body(source, "func _enter_tree(")
	assert_false(body.is_empty(), "_enter_tree must be defined")
	assert_true(
		body.find("add_autoload_singleton(") != -1,
		"_enter_tree must call add_autoload_singleton(...)"
	)


func test_exit_tree_removes_mcp_editor_plugin_autoload() -> void:
	var source: String = _load_source_text()
	var body: String = _extract_function_body(source, "func _exit_tree(")
	assert_false(body.is_empty(), "_exit_tree must be defined")
	assert_true(
		body.find("remove_autoload_singleton(") != -1,
		"_exit_tree must call remove_autoload_singleton(...)"
	)
