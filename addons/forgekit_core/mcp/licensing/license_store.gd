class_name LicenseStore
extends RefCounted
## Persists verified module license records as JSON under
## `user://licenses/<module_id>.key` and exposes a read API for the MCP
## server to consume at startup.
##
## A single entry for `module_id = "forgekit_rpg"` unlocks all four RPG
## subsystems (combat, crafting, inventory, stats); the store intentionally
## writes one file per module id, not per subsystem.
##
## The persisted record has exactly three fields:
##   - `license_id`    — the plain customer license id passed to `activate`.
##   - `activated_at`  — ISO 8601 UTC timestamp captured at write time.
##   - `fingerprint`   — short stable SHA-256 hex digest of a machine-local
##                       identifier, used to detect key sharing across
##                       machines in later checks.
##
## `activate()` is gated on the activator's HMAC verification: when
## verification fails, no file is written and the caller receives
## `license_verification_failed`. This matches the spec's requirement that
## the store's write path is driven by verify success from the start.
##
## File I/O is atomic: the store writes to `<path>.tmp` first and then
## renames over the final `.key` path via `DirAccess.rename_absolute`.


const _LICENSE_ACTIVATOR_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/licensing/license_activator.gd")

## Default directory for persisted licenses. Tests override this via
## `set_base_dir` to a scratch directory under `user://`.
const DEFAULT_BASE_DIR: String = "user://licenses/"

## Error message surfaced to callers when the HMAC check fails. Matches the
## name declared in the licensing acceptance criteria.
const ERR_LICENSE_VERIFICATION_FAILED: String = "license_verification_failed"


var _base_dir: String = DEFAULT_BASE_DIR
var _activator: Object = _LICENSE_ACTIVATOR_SCRIPT.new()
var _clock: Callable = Callable(self, "_system_iso8601_utc")


# ---------------------------------------------------------------------------
# Configuration (injection hooks)
# ---------------------------------------------------------------------------

## Replaces the default activator. Used by tests and the MCP server
## wiring to inject an activator configured with a known key.
func set_activator(activator: Object) -> void:
	_activator = activator


## Overrides the directory under which license files are written. The
## directory is created on demand during `activate()`. A trailing slash is
## tolerated but not required.
func set_base_dir(dir: String) -> void:
	_base_dir = dir if dir.ends_with("/") else dir + "/"


## Overrides the clock used for `activated_at`. The callable must return a
## String ISO 8601 timestamp. Intended for tests that need deterministic
## timestamps without sleeping the process.
func set_clock_for_testing(clock: Callable) -> void:
	_clock = clock


# ---------------------------------------------------------------------------
# Write API
# ---------------------------------------------------------------------------

## Verifies the HMAC over `license_id` and, on success, writes a license
## record to `<base_dir>/<module_id>.key`. Returns a result dictionary:
##
##   {"activated": true,  "record": {license_id, activated_at, fingerprint},
##    "path": "<base_dir>/<module_id>.key"}
##   {"activated": false, "error": "license_verification_failed"}
##
## The written file is always well-formed JSON; re-activation overwrites
## any pre-existing record atomically.
func activate(module_id: String, license_id: String, signature: String) -> Dictionary:
	if not _activator.verify(license_id, signature):
		return {
			"activated": false,
			"error": ERR_LICENSE_VERIFICATION_FAILED,
		}

	var record: Dictionary = {
		"license_id": license_id,
		"activated_at": _now_iso8601(),
		"fingerprint": _compute_fingerprint(),
	}

	var path: String = _license_path(module_id)
	_ensure_dir_exists()
	if not _atomic_write_json(path, record):
		return {
			"activated": false,
			"error": ERR_LICENSE_VERIFICATION_FAILED,
		}

	return {
		"activated": true,
		"record": record,
		"path": path,
	}


# ---------------------------------------------------------------------------
# Read API
# ---------------------------------------------------------------------------

## Returns the persisted license record for `module_id`, or `null` if no
## valid record is present. Intended for the MCP server startup flow which
## unlocks module tools after detecting a valid license entry.
func load_license(module_id: String) -> Variant:
	var path: String = _license_path(module_id)
	if not FileAccess.file_exists(path):
		return null
	var file: FileAccess = FileAccess.open(path, FileAccess.READ)
	if file == null:
		return null
	var text: String = file.get_as_text()
	file.close()
	if text.is_empty():
		return null

	var parser: JSON = JSON.new()
	var parse_err: int = parser.parse(text)
	if parse_err != OK:
		return null
	var payload: Variant = parser.data
	if not (payload is Dictionary):
		return null
	return payload


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------

func _license_path(module_id: String) -> String:
	return _base_dir + module_id + ".key"


func _ensure_dir_exists() -> void:
	if DirAccess.dir_exists_absolute(_base_dir):
		return
	DirAccess.make_dir_recursive_absolute(_base_dir)


## Atomic write: `<path>.tmp` first, then rename over the destination. If
## any step fails, any stray temp file is cleaned up so the caller does
## not observe a partial state.
func _atomic_write_json(path: String, record: Dictionary) -> bool:
	var tmp_path: String = path + ".tmp"
	var file: FileAccess = FileAccess.open(tmp_path, FileAccess.WRITE)
	if file == null:
		return false
	file.store_string(JSON.stringify(record))
	file.close()

	var rename_err: int = DirAccess.rename_absolute(
		ProjectSettings.globalize_path(tmp_path),
		ProjectSettings.globalize_path(path)
	)
	if rename_err != OK:
		if FileAccess.file_exists(tmp_path):
			DirAccess.remove_absolute(ProjectSettings.globalize_path(tmp_path))
		return false
	return true


func _now_iso8601() -> String:
	return String(_clock.call())


## Default clock: Godot's system UTC timestamp formatted as ISO 8601
## (`YYYY-MM-DDTHH:MM:SS`). The `true` argument requests UTC rather than
## local time.
func _system_iso8601_utc() -> String:
	return Time.get_datetime_string_from_system(true)


## Builds a short stable machine identifier. `OS.get_unique_id()` is
## preferred because it is stable across runs on the same device, but it
## returns an empty string on some platforms (notably the web export). In
## that case we fall back to a deterministic hash of platform + user name.
## Either way the final value is the lowercase hex SHA-256 digest so the
## downstream format is uniform.
static func _compute_fingerprint() -> String:
	var raw: String = OS.get_unique_id()
	if raw.is_empty():
		raw = "%s|%s" % [OS.get_name(), OS.get_environment("USER")]

	var ctx: HashingContext = HashingContext.new()
	var start_err: int = ctx.start(HashingContext.HASH_SHA256)
	if start_err != OK:
		return ""
	var update_err: int = ctx.update(raw.to_utf8_buffer())
	if update_err != OK:
		return ""
	return ctx.finish().hex_encode()
