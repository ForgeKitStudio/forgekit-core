class_name GDScriptValidator
extends RefCounted
## Validates GDScript source code without writing to disk.
##
## Uses GDScript.new() + source_code assignment + reload() to detect parse
## errors. Returns a JSON-RPC-friendly dictionary so MCP tooling can forward
## the result to the agent without reshaping.


## Validates a GDScript source string.
##
## Result shape:
##   {
##     "ok": bool,                 # true iff the source parses cleanly
##     "errors": Array[Dictionary] # each entry has { line: int, col: int, msg: String }
##     "duration_ms": int          # wall-clock validation time in milliseconds
##   }
func validate(source: String) -> Dictionary:
	var start_usec: int = Time.get_ticks_usec()
	var script: GDScript = GDScript.new()
	script.source_code = source
	var err: int = script.reload()
	var elapsed_usec: int = Time.get_ticks_usec() - start_usec
	var duration_ms: int = int(elapsed_usec / 1000.0)
	if duration_ms < 0:
		duration_ms = 0

	var errors: Array = []
	var ok: bool = err == OK
	if not ok:
		# GDScript.reload() returns only an Error code; per-token line/col info
		# is not exposed to GDScript in Godot 4.x. We surface a single
		# diagnostic with a stable shape so downstream JSON-RPC consumers can
		# always rely on the {line, col, msg} contract.
		errors.append({
			"line": 1,
			"col": 1,
			"msg": "GDScript parse error (code %d)" % err,
		})

	return {
		"ok": ok,
		"errors": errors,
		"duration_ms": duration_ms,
	}
