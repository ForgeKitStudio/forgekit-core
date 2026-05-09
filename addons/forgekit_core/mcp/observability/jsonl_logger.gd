extends RefCounted
## McpJsonlLogger — Godot-side structured logger.
##
## Writes one JSON line per event to
## `<base_dir>/<component>/<YYYY-MM-DD>.jsonl` (default `base_dir` is
## `user://mcp_logs`). Mirrors the server-side
## `mcp-server/src/observability/jsonl_logger.ts` so a `trace_id` can be
## correlated across both streams.
##
## Line shape:
##   {ts, level, component, trace_id?, span_id?, method?, duration_ms?, data?}
##
## Level threshold:
##   debug < info < warn < error
##   Lines below the configured threshold are dropped silently.
##
## Test injection points:
##   - `base_dir`  — redirect writes to a scratch directory.
##   - `level`     — override the production default of `info`.
##   - `clock`     — Callable returning an ISO-8601 UTC string; the
##                   default uses `Time.get_datetime_string_from_system(true)`
##                   appended with a `Z` suffix so the production line
##                   timestamps are timezone-explicit.
##
## Configuration via env var:
##   FORGEKIT_MCP_LOG_LEVEL overrides the default level at construction
##   time when set to one of `debug | info | warn | error`.


class_name McpJsonlLogger


const DEFAULT_BASE_DIR: String = "user://mcp_logs"

const _LEVEL_ORDER: Dictionary = {
	&"debug": 0,
	&"info": 1,
	&"warn": 2,
	&"error": 3,
}

const _RESERVED_FIELDS: Array = ["trace_id", "span_id", "method", "duration_ms"]


var base_dir: String = DEFAULT_BASE_DIR
var level: StringName = &"info"

# Callable returning an ISO-8601 UTC timestamp as a `String`.
var clock: Callable = Callable()


func _init() -> void:
	# Apply environment-variable override once at construction time so
	# a later `set_level()` call by the caller can still win.
	var env_level: String = OS.get_environment("FORGEKIT_MCP_LOG_LEVEL").to_lower()
	if env_level != "" and _LEVEL_ORDER.has(StringName(env_level)):
		level = StringName(env_level)

	# Default clock builds an ISO-8601 UTC timestamp with millisecond
	# resolution; `Time.get_datetime_string_from_system(true)` returns
	# `YYYY-MM-DDTHH:MM:SS` in UTC, which we suffix with a `Z` and pad
	# with `.000` for millisecond granularity so the shape matches the
	# TypeScript side's `Date.toISOString()` output.
	clock = func() -> String:
		var base: String = Time.get_datetime_string_from_system(true)
		# Trim any milliseconds Godot might append in future versions;
		# always emit `YYYY-MM-DDTHH:MM:SS.000Z`.
		if base.length() == 19:
			return base + ".000Z"
		return base + "Z"


## Emit a single structured log line.
##
## `component` is the caller-supplied logical source name
## (`editor_plugin`, `runtime_bridge`, `mcp_server`, ...); it also
## selects the sub-directory under `base_dir` the line is routed to.
func log(line_level: StringName, component: StringName, data: Dictionary) -> void:
	if not _passes_threshold(line_level):
		return

	var ts: String = String(clock.call())
	var entry: Dictionary = {
		"ts": ts,
		"level": String(line_level),
		"component": String(component),
	}

	for key in _RESERVED_FIELDS:
		if data.has(key):
			entry[key] = data[key]

	var remainder: Dictionary = {}
	for key in data.keys():
		if key in _RESERVED_FIELDS:
			continue
		remainder[key] = data[key]
	if not remainder.is_empty():
		entry["data"] = remainder

	var component_dir: String = base_dir.path_join(String(component))
	var make_err: int = DirAccess.make_dir_recursive_absolute(component_dir)
	if make_err != OK and not DirAccess.dir_exists_absolute(component_dir):
		push_error("McpJsonlLogger: failed to create log directory %s (err=%d)" % [component_dir, make_err])
		return

	var file_path: String = component_dir.path_join(_date_stamp(ts) + ".jsonl")
	# Append mode keeps existing lines while adding the new one.
	# `FileAccess.WRITE_READ` re-creates the file; `FileAccess.READ_WRITE`
	# opens an existing file and `seek_end()` then appends. To support
	# first-write creation, open-or-create first:
	var file: FileAccess
	if FileAccess.file_exists(file_path):
		file = FileAccess.open(file_path, FileAccess.READ_WRITE)
		if file == null:
			push_error("McpJsonlLogger: failed to open %s for append" % file_path)
			return
		file.seek_end()
	else:
		file = FileAccess.open(file_path, FileAccess.WRITE)
		if file == null:
			push_error("McpJsonlLogger: failed to create %s" % file_path)
			return

	file.store_string(JSON.stringify(entry) + "\n")
	file.close()


func _passes_threshold(candidate: StringName) -> bool:
	if not _LEVEL_ORDER.has(candidate):
		return false
	var threshold: int = int(_LEVEL_ORDER.get(level, 1))
	var candidate_level: int = int(_LEVEL_ORDER[candidate])
	return candidate_level >= threshold


static func _date_stamp(iso_timestamp: String) -> String:
	# Expect `YYYY-MM-DDThh:mm:ss.mmmZ`; slice the date prefix.
	if iso_timestamp.length() < 10:
		return "unknown-date"
	return iso_timestamp.substr(0, 10)
