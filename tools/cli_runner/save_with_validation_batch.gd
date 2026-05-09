extends SceneTree
## Headless driver for the save_with_validation property test.
##
## Reads a JSON payload from stdin of the form
##   {"cases": [
##       {"path": "user://...", "source": "...", "pre_existing": null | "..."},
##       ...
##   ]}
## and for each case:
##   1. Ensures the target parent directory exists under user://.
##   2. If `pre_existing` is a string, seeds the file with those bytes.
##      Otherwise, removes the file so the case starts from a clean slate.
##   3. Runs `GDScriptValidator.validate(source)` and captures `ok`.
##   4. Runs `McpScriptWriter.write(path, source)` and captures the envelope.
##   5. Reads the file back (or records `exists_after == false`) and records
##      `content_after` verbatim.
##   6. Removes the file before the next case so state does not leak.
##
## Emits a single fenced JSON envelope on stdout:
##
##   <<<FORGEKIT_SAVE_BEGIN>>>
##   {"results": [ {validate_ok, written, exists_after, content_after, ...}, ... ]}
##   <<<FORGEKIT_SAVE_END>>>
##
## Engine parse errors surface on stderr; this driver does not need to
## recover them because the TypeScript property only cares about the
## validator's `ok` flag plus the writer's `{written, error.code}` envelope.


const GDScriptValidatorScript: GDScript = preload(
	"res://addons/forgekit_core/mcp/gdscript_validator.gd"
)
const McpScriptWriterScript: GDScript = preload(
	"res://addons/forgekit_core/mcp/editor_plugin/script_writer.gd"
)


func _init() -> void:
	var raw: String = _read_all_stdin()
	var parsed: Variant = JSON.parse_string(raw)
	if typeof(parsed) != TYPE_DICTIONARY or not (parsed as Dictionary).has("cases"):
		_emit_envelope({"error": "invalid_payload", "results": []})
		quit(0)
		return

	var cases: Array = (parsed as Dictionary)["cases"]
	# Typed as `Object` rather than `GDScriptValidator` so the driver
	# compiles in headless checkouts where the editor has not yet
	# populated `.godot/global_script_class_cache.cfg`. The concrete
	# script is still loaded via the preloaded `GDScriptValidatorScript`
	# constant, so runtime behavior is identical.
	var validator: Object = GDScriptValidatorScript.new()
	var results: Array = []

	for i in range(cases.size()):
		var entry: Dictionary = cases[i]
		var path: String = String(entry.get("path", ""))
		var source: String = String(entry.get("source", ""))
		var pre_variant: Variant = entry.get("pre_existing", null)
		var has_pre: bool = pre_variant != null
		var pre_existing: String = String(pre_variant) if has_pre else ""

		_ensure_parent_dir(path)
		_seed_or_clear(path, has_pre, pre_existing)

		var validate_result: Dictionary = validator.validate(source)
		# Instantiate through the preloaded script constant so this
		# driver does not depend on the global `class_name` registration
		# being populated when the SceneTree entry point runs.
		var writer: Object = McpScriptWriterScript.new()
		var write_result: Dictionary = writer.write(path, source)

		var exists_after: bool = FileAccess.file_exists(path)
		var content_after: String = ""
		if exists_after:
			var f: FileAccess = FileAccess.open(path, FileAccess.READ)
			if f != null:
				content_after = f.get_as_text()
				f.close()

		var record: Dictionary = {
			"validate_ok": bool(validate_result.get("ok", false)),
			"written": bool(write_result.get("written", false)),
			"exists_after": exists_after,
			"content_after": content_after,
		}
		if write_result.has("error"):
			var err: Dictionary = write_result["error"]
			record["error_code"] = int(err.get("code", 0))
			record["error_message"] = String(err.get("message", ""))
		results.append(record)

		# Clean up between cases so user:// does not accumulate fixtures
		# across runs and a later case cannot observe a previous case's
		# leftover file.
		if FileAccess.file_exists(path):
			DirAccess.remove_absolute(path)

	_emit_envelope({"results": results})
	quit(0)


func _ensure_parent_dir(path: String) -> void:
	var last_slash: int = path.rfind("/")
	# Skip the authority separator for `user://` and `res://`; the first
	# real subdirectory starts after the second slash.
	if last_slash <= 0:
		return
	var parent: String = path.substr(0, last_slash)
	DirAccess.make_dir_recursive_absolute(parent)


func _seed_or_clear(path: String, has_pre: bool, pre_existing: String) -> void:
	if FileAccess.file_exists(path):
		DirAccess.remove_absolute(path)
	if has_pre:
		var f: FileAccess = FileAccess.open(path, FileAccess.WRITE)
		if f != null:
			f.store_string(pre_existing)
			f.close()


func _read_all_stdin() -> String:
	# `read_string_from_stdin` returns an empty string when the pipe
	# closes. Keep pulling until EOF so we can accept payloads larger
	# than the single-read buffer.
	var buf: String = ""
	while true:
		var chunk: String = OS.read_string_from_stdin(65_536)
		if chunk == "":
			break
		buf += chunk
	return buf


func _emit_envelope(envelope: Dictionary) -> void:
	print("<<<FORGEKIT_SAVE_BEGIN>>>")
	print(JSON.stringify(envelope))
	print("<<<FORGEKIT_SAVE_END>>>")
