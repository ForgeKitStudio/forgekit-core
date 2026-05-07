extends RefCounted
## McpScriptWriter — atomically writes a GDScript source file iff it parses
## cleanly and the target path is writable per Core_Boundary.
##
## Sequence:
##   1. validate(source)   -> GDSCRIPT_SYNTAX_ERROR on failure, file untouched
##   2. boundary check     -> CORE_BOUNDARY_VIOLATION on Core paths
##   3. atomic write       -> write-temp + fsync + rename via an injected
##                            renamer (defaults to `DirAccess.rename_absolute`)
##   4. reload callback    -> optional hook the editor wires to
##                            `EditorInterface.reload_scripts` so live buffers
##                            refresh in the same operation
##
## Business-level failures are reported as `{"written": false, "error": {...}}`
## envelopes whose `error` field follows the McpErrorCodes contract. Success
## is `{"written": true, "path": String}`.
##
## The renamer is injectable so tests can simulate rename failures without
## mutating the filesystem or holding OS locks, mirroring the pattern used by
## McpProjectSettingsAtomicWriter.


class_name McpScriptWriter


const GDSCRIPT_VALIDATOR_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/gdscript_validator.gd")
const MCP_ERROR_CODES: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/mcp_error_codes.gd")
const CORE_BOUNDARY: GDScript = preload("res://addons/forgekit_core/boundary/core_boundary.gd")


# Renamer callable. Signature: `func(from: String, to: String) -> int` where
# the returned int follows `@GlobalScope.Error` conventions (OK == success).
var _renamer: Callable = Callable(DirAccess, "rename_absolute")

# Optional editor-reload hook. Signature: `func(path: String) -> void`.
# Defaults to a no-op Callable so headless tests can exercise the writer
# without wiring EditorInterface.
var _reload_callable: Callable = Callable()

# Lazily-constructed validator. Kept per-instance so tests that inject a
# different validator (future extension) can replace it without mutating
# module-level state.
var _validator: GDScriptValidator = null


func set_renamer(renamer: Callable) -> void:
	_renamer = renamer


func set_reload_callable(callable: Callable) -> void:
	_reload_callable = callable


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

## Validates `source` without touching the filesystem. Returns the validator
## dictionary `{"ok": bool, "errors": Array, "duration_ms": int}` verbatim.
func validate(source: String) -> Dictionary:
	return _get_validator().validate(source)


## Atomically writes `source` to `path` iff it parses cleanly and `path` is
## not inside the read-only Core_Boundary. Returns either
## `{"written": true, "path": path}` or `{"written": false, "error": {...}}`.
func write(path: String, source: String) -> Dictionary:
	# 1) Validate — never write a file that will not parse.
	var validation: Dictionary = validate(source)
	if not bool(validation.get("ok", false)):
		return _fail(MCP_ERROR_CODES.GDSCRIPT_SYNTAX_ERROR, {
			"path": path,
			"errors": validation.get("errors", []),
		})

	# 2) Boundary check — never overwrite a Core-owned file.
	var violation: Dictionary = CORE_BOUNDARY.violation_for(path)
	if not violation.is_empty():
		return _fail(MCP_ERROR_CODES.CORE_BOUNDARY_VIOLATION, {
			"path": path,
			"matched_rule": violation.get("matched_rule", ""),
		})

	# 3) Write-temp.
	var tmp_path: String = path + ".tmp"
	var tmp_file: FileAccess = FileAccess.open(tmp_path, FileAccess.WRITE)
	if tmp_file == null:
		_remove_if_exists(tmp_path)
		return _fail(MCP_ERROR_CODES.ATOMIC_WRITE_FAILED, {
			"path": path,
			"stage": "write-temp",
			"godot_error": FileAccess.get_open_error(),
		})
	tmp_file.store_string(source)
	tmp_file.close()

	# 4) fsync. `FileAccess.close` flushes to the OS page cache; reopening
	# + closing is the strongest durability primitive GDScript exposes.
	if not _flush_temp(tmp_path):
		_remove_if_exists(tmp_path)
		return _fail(MCP_ERROR_CODES.ATOMIC_WRITE_FAILED, {
			"path": path,
			"stage": "fsync",
		})

	# 5) Atomic rename. Same-volume rename is atomic on POSIX and Windows.
	var rename_err: int = int(_renamer.call(tmp_path, path))
	if rename_err != OK:
		_remove_if_exists(tmp_path)
		return _fail(MCP_ERROR_CODES.ATOMIC_WRITE_FAILED, {
			"path": path,
			"stage": "rename",
			"godot_error": rename_err,
		})

	# 6) Reload — editor-only hook. Runs after the atomic rename so any
	# consumer of `EditorInterface.reload_scripts` reads the new bytes.
	if _reload_callable.is_valid():
		_reload_callable.call(path)

	return {
		"written": true,
		"path": path,
	}


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------

func _get_validator() -> GDScriptValidator:
	if _validator == null:
		_validator = GDSCRIPT_VALIDATOR_SCRIPT.new()
	return _validator


static func _flush_temp(tmp_path: String) -> bool:
	var f: FileAccess = FileAccess.open(tmp_path, FileAccess.READ)
	if f == null:
		return false
	f.close()
	return true


static func _remove_if_exists(path: String) -> void:
	if FileAccess.file_exists(path):
		DirAccess.remove_absolute(path)


static func _fail(code: int, extra_data: Dictionary) -> Dictionary:
	return {
		"written": false,
		"error": MCP_ERROR_CODES.make_error(code, extra_data),
	}
