extends SceneTree
## Headless driver for Property 52 — Trace ID propagation.
##
## Reads a JSON payload from stdin of the form
##   {
##     "log_dir": "user://forgekit_pbt_trace_propagation",
##     "cases": [
##         { "trace_id": "aabbccdd", "span_id": "1234",
##           "method":   "scene.open",
##           "params":   { "path": "res://main.tscn" } },
##         ...
##     ]
##   }
##
## For every case the driver:
##   1. Builds a JSON-RPC 2.0 request envelope with
##      `_forgekit_trace = { trace_id, span_id }`.
##   2. Dispatches it through `McpJsonRpcDispatcher` so the dispatcher's
##      production trace-extraction path is exercised.
##   3. Reads `dispatcher.get_last_trace_context()` and pipes it into
##      `McpJsonlLogger.set_trace_context()` so the handler-side log
##      line inherits the same trace context (Subtask 8.11.3).
##   4. Emits one structured log line under `<log_dir>/runtime_bridge/<date>.jsonl`
##      with `method` set to the request's method name.
##
## Emits a single fenced JSON envelope on stdout so the TypeScript
## property test can read the per-case (method, observed_trace_id)
## tuples without grepping the log files itself:
##
##   <<<FORGEKIT_TRACE_BEGIN>>>
##   {"results": [ { "method": "scene.open",
##                   "trace_id": "aabbccdd",
##                   "span_id":  "1234" }, ... ]}
##   <<<FORGEKIT_TRACE_END>>>


const McpJsonRpcDispatcherScript: GDScript = preload(
	"res://addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd"
)
const McpJsonlLoggerScript: GDScript = preload(
	"res://addons/forgekit_core/mcp/observability/jsonl_logger.gd"
)


func _init() -> void:
	var raw: String = _read_all_stdin()
	var parsed: Variant = JSON.parse_string(raw)
	if typeof(parsed) != TYPE_DICTIONARY or not (parsed as Dictionary).has("cases"):
		_emit_envelope({"error": "invalid_payload", "results": []})
		quit(0)
		return

	var payload: Dictionary = parsed as Dictionary
	var log_dir: String = String(payload.get("log_dir", "user://forgekit_pbt_trace_propagation"))
	var cases: Array = payload.get("cases", []) as Array

	# Wipe any previous run so this batch's lines are the only ones in
	# the file the TypeScript test reads back.
	_remove_dir_recursive(log_dir)

	var dispatcher: Object = McpJsonRpcDispatcherScript.new()
	var logger: Object = McpJsonlLoggerScript.new()
	logger.base_dir = log_dir
	logger.level = &"debug"

	# Single test handler exercised by every case. The handler runs
	# inside `dispatch()`, so reading the dispatcher's
	# `get_last_trace_context()` from here would underestimate the
	# propagation chain — we mirror what production handlers do and
	# rely on the dispatcher having extracted the trace into its
	# `_last_trace_context` slot before calling us. That slot is
	# set up-front by `dispatch()`, so fetching it here gives the
	# same trace the next caller would see externally.
	var handler: Callable = func(_params: Variant) -> Dictionary:
		var ctx: Dictionary = dispatcher.get_last_trace_context()
		logger.set_trace_context(
			String(ctx.get("trace_id", "")),
			String(ctx.get("span_id", "")),
		)
		logger.log(&"info", &"runtime_bridge", {
			"method": "test.trace_echo",
		})
		return {"ok": true}
	dispatcher.register_handler("test.trace_echo", handler)

	var results: Array = []
	for i in range(cases.size()):
		var case: Dictionary = cases[i] as Dictionary
		var trace_id: String = String(case.get("trace_id", ""))
		var span_id: String = String(case.get("span_id", ""))
		var method: String = String(case.get("method", "test.trace_echo"))
		var params: Variant = case.get("params", {})

		# We register a single handler under "test.trace_echo" so every
		# case routes to it; the original method name is captured below
		# in the result envelope so the TS test can correlate dispatch
		# log lines (server-side) with this driver's GDScript-side log
		# lines using the trace_id.
		var request: Dictionary = {
			"jsonrpc": "2.0",
			"id": i + 1,
			"method": "test.trace_echo",
			"params": params,
			"_forgekit_trace": {
				"trace_id": trace_id,
				"span_id": span_id,
			},
		}

		var _response: Dictionary = dispatcher.dispatch(request)

		# After dispatch returns, the dispatcher exposes the trace
		# context it parsed from the envelope. We capture it here so
		# the TS test can verify the dispatcher honoured the upstream
		# trace.
		var observed: Dictionary = dispatcher.get_last_trace_context()
		results.append({
			"method": method,
			"trace_id": String(observed.get("trace_id", "")),
			"span_id": String(observed.get("span_id", "")),
		})

	_emit_envelope({
		"log_dir": log_dir,
		"results": results,
	})
	quit(0)


func _read_all_stdin() -> String:
	var buf: String = ""
	while true:
		var chunk: String = OS.read_string_from_stdin(65_536)
		if chunk == "":
			break
		buf += chunk
	return buf


func _emit_envelope(envelope: Dictionary) -> void:
	print("<<<FORGEKIT_TRACE_BEGIN>>>")
	print(JSON.stringify(envelope))
	print("<<<FORGEKIT_TRACE_END>>>")


func _remove_dir_recursive(path: String) -> void:
	if not DirAccess.dir_exists_absolute(path):
		return
	var dir: DirAccess = DirAccess.open(path)
	if dir == null:
		return
	dir.list_dir_begin()
	var entry: String = dir.get_next()
	while entry != "":
		if entry == "." or entry == "..":
			entry = dir.get_next()
			continue
		var full_path: String = path.path_join(entry)
		if dir.current_is_dir():
			_remove_dir_recursive(full_path)
		else:
			DirAccess.remove_absolute(full_path)
		entry = dir.get_next()
	dir.list_dir_end()
	DirAccess.remove_absolute(path)
