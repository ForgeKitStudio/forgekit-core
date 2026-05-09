extends RefCounted
## McpHealingTools — JSON-RPC handler adapter for the five Self-Healing
## MCP tools.
##
##   healing.suggest_action(report)                    → {suggested_action}
##   healing.inspect_failure(report_or_message)        → {root_cause, candidates[]}
##   healing.get_retry_count(resource_path)            → {attempts, limit: 3}
##   healing.reset_retry_count(resource_path)          → {ok: true}
##   healing.apply_and_retest(fix, test_command)       → {applied, test_status, retries_remaining}
##
## The adapter delegates data collection to four collaborators:
##   - `McpRetryCounter` — per-session retry tracker
##   - `McpHealingSuggester` — rule-based action picker
##   - `McpHealingInspector` — failure message parser
##   - resource backend (duck-typed for `apply_fix(path, fix)`)
##   - test runner (duck-typed for `run(command)`)


class_name McpHealingTools


const _RETRY_COUNTER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/healing/retry_counter.gd")
const _SUGGESTER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/healing/suggest_action.gd")
const _INSPECTOR_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/healing/inspect_failure.gd")


var _retry_counter: Object = null
var _suggester: Object = null
var _inspector: Object = null
var _resource_backend: Object = null
var _test_runner: Object = null
# Optional metrics hook — Callable invoked with the metric name on each
# retry counter increment. The editor plugin wires this to the MCP
# server's Metrics registry so `mcp.healing.retries` shows up in the
# observability surface. Left null when no metrics sink is wired.
var _metrics_sink: Callable = Callable()


func _init() -> void:
	_retry_counter = _RETRY_COUNTER_SCRIPT.new()
	_suggester = _SUGGESTER_SCRIPT.new()
	_suggester.set_retry_counter(_retry_counter)
	_inspector = _INSPECTOR_SCRIPT.new()


# ---------------------------------------------------------------------------
# Injection.
# ---------------------------------------------------------------------------

func set_retry_counter(counter: Object) -> void:
	_retry_counter = counter
	if _suggester != null:
		_suggester.set_retry_counter(counter)


func set_suggester(suggester: Object) -> void:
	_suggester = suggester
	if _retry_counter != null:
		_suggester.set_retry_counter(_retry_counter)


func set_inspector(inspector: Object) -> void:
	_inspector = inspector


func set_resource_backend(backend: Object) -> void:
	_resource_backend = backend


func set_test_runner(runner: Object) -> void:
	_test_runner = runner


## Wire a metrics sink. The Callable is invoked with a single String
## argument (the metric name) whenever the retry counter is advanced on
## a failed apply_and_retest. Pass an empty Callable to clear.
func set_metrics_sink(sink: Callable) -> void:
	_metrics_sink = sink


# ---------------------------------------------------------------------------
# MCP handlers.
# ---------------------------------------------------------------------------

func suggest_action(params: Variant) -> Variant:
	var report: Dictionary = _get_dict_param(params, "report", 0, {})
	return _suggester.suggest(report)


func inspect_failure(params: Variant) -> Variant:
	var report_variant: Variant = _get_variant_param(params, "report", 0, "")
	return _inspector.inspect(report_variant)


func get_retry_count(params: Variant) -> Variant:
	var path: String = _get_string_param(params, "resource_path", 0, "")
	return {
		"attempts": _retry_counter.get_attempts(path),
		"limit": _retry_counter.limit(),
	}


func reset_retry_count(params: Variant) -> Variant:
	var path: String = _get_string_param(params, "resource_path", 0, "")
	_retry_counter.reset(path)
	return {"ok": true}


func apply_and_retest(params: Variant) -> Variant:
	var fix: Dictionary = _get_dict_param(params, "fix", 0, {})
	var test_command: String = _get_string_param(params, "test_command", 1, "")
	var resource_path: String = String(fix.get("path", ""))

	var apply_result: Dictionary = {"applied": false}
	if _resource_backend != null:
		apply_result = _resource_backend.apply_fix(resource_path, fix) as Dictionary

	var test_result: Dictionary = {"status": "passed", "failure_message": ""}
	if _test_runner != null:
		test_result = _test_runner.run(test_command) as Dictionary

	var status: String = String(test_result.get("status", "passed"))
	if status != "passed" and not resource_path.is_empty():
		_retry_counter.increment(resource_path)
		if _metrics_sink.is_valid():
			_metrics_sink.call("mcp.healing.retries")

	var retries_remaining: int = max(0, _retry_counter.limit() - _retry_counter.get_attempts(resource_path))

	return {
		"applied": bool(apply_result.get("applied", false)),
		"test_status": status,
		"retries_remaining": retries_remaining,
	}


## Bulk-register all five healing MCP methods on the supplied dispatcher.
## Returns `self` so the caller can chain.
func register_on(dispatcher: Object) -> Object:
	dispatcher.register_handler("healing.suggest_action", Callable(self, "suggest_action"))
	dispatcher.register_handler("healing.inspect_failure", Callable(self, "inspect_failure"))
	dispatcher.register_handler("healing.get_retry_count", Callable(self, "get_retry_count"))
	dispatcher.register_handler("healing.reset_retry_count", Callable(self, "reset_retry_count"))
	dispatcher.register_handler("healing.apply_and_retest", Callable(self, "apply_and_retest"))
	return self


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


static func _get_dict_param(params: Variant, key: String, index: int, default_value: Dictionary) -> Dictionary:
	if params is Dictionary:
		var dict: Dictionary = params as Dictionary
		if dict.has(key):
			var v: Variant = dict[key]
			if v is Dictionary:
				return v as Dictionary
	elif params is Array:
		var arr: Array = params as Array
		if index >= 0 and index < arr.size():
			var v: Variant = arr[index]
			if v is Dictionary:
				return v as Dictionary
	return default_value


static func _get_variant_param(params: Variant, key: String, index: int, default_value: Variant) -> Variant:
	if params is Dictionary:
		var dict: Dictionary = params as Dictionary
		if dict.has(key):
			return dict[key]
	elif params is Array:
		var arr: Array = params as Array
		if index >= 0 and index < arr.size():
			return arr[index]
	return default_value
