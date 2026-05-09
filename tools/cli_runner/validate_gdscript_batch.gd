extends SceneTree
## Headless driver for the GDScript validator.
##
## Reads a JSON payload `{"sources": ["...", "..."]}` from stdin, validates
## each entry via `GDScriptValidator`, and emits a single JSON envelope on
## stdout fenced by `<<<FORGEKIT_VALIDATE_BEGIN>>>` /
## `<<<FORGEKIT_VALIDATE_END>>>` markers. Parse errors surfaced by the
## engine appear on stderr between matching per-entry markers
## (`<<<FORGEKIT_ENTRY_BEGIN:<i>>>>` … `<<<FORGEKIT_ENTRY_END:<i>>>>`) so a
## caller can recover the line number the engine reported without having to
## parse unrelated stderr noise.
##
## Godot 4.x does not expose parse-error line numbers to GDScript: the
## engine logs them to stderr in the form
## `gdscript://<hash>.gd:<line>`. The TypeScript client reads the fenced
## stderr, extracts that line for each entry, and merges it into the stdout
## envelope.


const GDScriptValidatorScript: GDScript = preload(
	"res://addons/forgekit_core/mcp/gdscript_validator.gd"
)


func _init() -> void:
	var raw: String = _read_all_stdin()
	var parsed: Variant = JSON.parse_string(raw)
	if typeof(parsed) != TYPE_DICTIONARY or not (parsed as Dictionary).has("sources"):
		_emit_envelope({"error": "invalid_payload", "results": []})
		quit(0)
		return

	var sources: Array = (parsed as Dictionary)["sources"]
	# Typed as `Object` rather than `GDScriptValidator` so the driver
	# compiles in headless checkouts where the editor has not yet
	# populated `.godot/global_script_class_cache.cfg`. The concrete
	# script is still loaded via the preloaded `GDScriptValidatorScript`
	# constant, so runtime behavior is identical.
	var validator: Object = GDScriptValidatorScript.new()
	var results: Array = []

	for i in range(sources.size()):
		var src: String = String(sources[i])
		# Stderr markers let the TypeScript client isolate the parse-error
		# line for this specific source entry.
		printerr("<<<FORGEKIT_ENTRY_BEGIN:%d>>>" % i)
		var result: Dictionary = validator.validate(src)
		printerr("<<<FORGEKIT_ENTRY_END:%d>>>" % i)
		results.append(result)

	_emit_envelope({"results": results})
	quit(0)


func _read_all_stdin() -> String:
	# `read_string_from_stdin` returns an empty string when the pipe closes.
	# Keep pulling until EOF so we can accept payloads larger than the
	# single-read buffer.
	var buf: String = ""
	while true:
		var chunk: String = OS.read_string_from_stdin(65_536)
		if chunk == "":
			break
		buf += chunk
	return buf


func _emit_envelope(envelope: Dictionary) -> void:
	print("<<<FORGEKIT_VALIDATE_BEGIN>>>")
	print(JSON.stringify(envelope))
	print("<<<FORGEKIT_VALIDATE_END>>>")
