extends GutTest
## Unit tests for McpRuntimeInfoTools: JSON-RPC handler adapter that exposes
## the runtime-channel info/introspection MCP tools on top of a duck-typed
## RuntimeInfoBackend.
##
## Covered handlers:
##   runtime.screenshot(target_path?)      → {path, size_bytes, width, height}
##   runtime.get_fps                       → {fps}
##   runtime.list_autoloads                → {autoloads: [{name, path}]}
##   runtime.get_autoload(name)            → {name, path, properties}


const INFO_TOOLS_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/runtime_bridge/tools/info_tools.gd")
const DISPATCHER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd")


class FakeRuntimeInfoBackend:
	extends RefCounted

	var calls: Array = []
	var overrides: Dictionary = {}

	func screenshot(target_path: String) -> Variant:
		calls.append({"op": "screenshot", "target_path": target_path})
		if overrides.has("screenshot"):
			return overrides["screenshot"]
		return {
			"path": target_path if not target_path.is_empty() else "user://screenshots/auto.png",
			"size_bytes": 1234,
			"width": 1280,
			"height": 720,
		}

	func get_fps() -> Variant:
		calls.append({"op": "get_fps"})
		if overrides.has("get_fps"):
			return overrides["get_fps"]
		return {"fps": 60.0}

	func list_autoloads() -> Variant:
		calls.append({"op": "list_autoloads"})
		if overrides.has("list_autoloads"):
			return overrides["list_autoloads"]
		return {
			"autoloads": [
				{"name": "GameEvents", "path": "res://addons/forgekit_core/event_bus/game_events.gd"},
				{"name": "McpBridge", "path": "res://addons/forgekit_core/mcp/runtime_bridge/mcp_bridge.gd"},
			],
		}

	func get_autoload(name: String) -> Variant:
		calls.append({"op": "get_autoload", "name": name})
		if overrides.has("get_autoload"):
			return overrides["get_autoload"]
		return {"name": name, "path": "res://addons/forgekit_core/event_bus/game_events.gd", "properties": {}}

	func find_calls(op: String) -> Array:
		var out: Array = []
		for c in calls:
			if (c as Dictionary).get("op", "") == op:
				out.append(c)
		return out


func _new_env() -> Dictionary:
	var backend: FakeRuntimeInfoBackend = FakeRuntimeInfoBackend.new()
	var tools: Object = INFO_TOOLS_SCRIPT.new(backend)
	return {"backend": backend, "tools": tools}


# ---------------------------------------------------------------------------
# 1) runtime.screenshot — forwards optional target_path, defaults to ""
# ---------------------------------------------------------------------------

func test_screenshot_forwards_target_path() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeInfoBackend = env["backend"]

	var _result: Variant = tools.screenshot({"target_path": "user://shots/frame.png"})

	var call: Dictionary = backend.find_calls("screenshot")[0]
	assert_eq(String(call.get("target_path", "")), "user://shots/frame.png", "target_path forwarded")


func test_screenshot_defaults_target_path_to_empty_string_when_absent() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeInfoBackend = env["backend"]

	var _result: Variant = tools.screenshot({})

	var call: Dictionary = backend.find_calls("screenshot")[0]
	assert_eq(String(call.get("target_path", "X")), "", "Missing target_path forwards as empty string")


func test_screenshot_accepts_positional_params() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeInfoBackend = env["backend"]

	var _result: Variant = tools.screenshot(["user://shot.png"])

	var call: Dictionary = backend.find_calls("screenshot")[0]
	assert_eq(String(call.get("target_path", "")), "user://shot.png", "positional target_path forwarded")


# ---------------------------------------------------------------------------
# 2) runtime.get_fps — calls backend and returns fps
# ---------------------------------------------------------------------------

func test_get_fps_calls_backend_and_returns_fps() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeInfoBackend = env["backend"]

	var result: Variant = tools.get_fps({})

	assert_eq(backend.find_calls("get_fps").size(), 1, "Backend called once")
	var dict: Dictionary = result as Dictionary
	assert_true(dict.has("fps"), "Result must contain 'fps'")


# ---------------------------------------------------------------------------
# 3) runtime.list_autoloads — calls backend and returns autoloads array
# ---------------------------------------------------------------------------

func test_list_autoloads_calls_backend_and_returns_autoloads_array() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeInfoBackend = env["backend"]

	var result: Variant = tools.list_autoloads({})

	assert_eq(backend.find_calls("list_autoloads").size(), 1, "Backend called once")
	var dict: Dictionary = result as Dictionary
	assert_true(dict.has("autoloads"), "Result must contain 'autoloads'")
	assert_true(dict.get("autoloads") is Array, "autoloads must be an Array")


# ---------------------------------------------------------------------------
# 4) runtime.get_autoload — forwards name
# ---------------------------------------------------------------------------

func test_get_autoload_forwards_name() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeInfoBackend = env["backend"]

	var _result: Variant = tools.get_autoload({"name": "GameEvents"})

	var call: Dictionary = backend.find_calls("get_autoload")[0]
	assert_eq(String(call.get("name", "")), "GameEvents", "name forwarded")


func test_get_autoload_accepts_positional_params() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var backend: FakeRuntimeInfoBackend = env["backend"]

	var _result: Variant = tools.get_autoload(["McpBridge"])

	var call: Dictionary = backend.find_calls("get_autoload")[0]
	assert_eq(String(call.get("name", "")), "McpBridge", "positional name forwarded")


# ---------------------------------------------------------------------------
# 5) register_on — wires all four runtime info methods on the dispatcher
# ---------------------------------------------------------------------------

func test_register_on_wires_all_four_info_methods_on_dispatcher() -> void:
	var env: Dictionary = _new_env()
	var tools: Object = env["tools"]
	var dispatcher: Object = DISPATCHER_SCRIPT.new()

	tools.register_on(dispatcher)

	var cases: Array = [
		{"method": "runtime.screenshot", "params": {}},
		{"method": "runtime.get_fps", "params": {}},
		{"method": "runtime.list_autoloads", "params": {}},
		{"method": "runtime.get_autoload", "params": {"name": "GameEvents"}},
	]
	for case in cases:
		var response: Dictionary = dispatcher.dispatch({
			"jsonrpc": "2.0",
			"method": case.get("method"),
			"params": case.get("params"),
			"id": 1,
		})
		assert_true(response.has("result"), "%s must be reachable via dispatcher" % case.get("method"))
		assert_false(response.has("error"), "%s must not produce a dispatcher error" % case.get("method"))
