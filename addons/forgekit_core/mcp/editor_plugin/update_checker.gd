extends RefCounted
## McpUpdateChecker — rate-limited GitHub release poll for the Core
## repository. Called periodically from the editor plugin lifecycle;
## when a newer ForgeKit Core version is available, the plugin
## surfaces the update via a `UPDATE_AVAILABLE:` line appended to
## `editor.get_output_log`.
##
## Contract:
##   - `check(http_client, now_unix_seconds) -> Dictionary` — returns
##     `{ok, checked, update_available, latest_version, current_version}`.
##     `ok` is false on network / parse failures (the caller should
##     treat those as "no information, no update available").
##   - `format_log_line(latest_version) -> String` — builds the
##     documented `UPDATE_AVAILABLE: ForgeKit Core v<new> available
##     (running v<current>). Run 'npx -y @forgekit/core-mcp@latest'
##     to upgrade.` string.
##
## The HTTP client is injected so the checker runs headlessly under
## tests. The production wiring passes a real
## `HTTPRequest`-backed client; tests pass a FakeHttpClient.
##
## Rate limiting: the cache file at `cache_path` stores
## `{last_unix_seconds, last_result}`; `check()` short-circuits with
## the cached result when the supplied `now_unix_seconds` is within
## `rate_limit_seconds` of the stored timestamp.


class_name McpUpdateChecker


## Default rate-limit window between HTTP fetches. Matches the task
## spec (`once per hour`).
const DEFAULT_RATE_LIMIT_SECONDS: int = 3600

## Default cache path under `user://`. Callers may override for
## tests or to relocate the cache into a project-scoped directory.
const DEFAULT_CACHE_PATH: String = "user://mcp_update_check.json"

## Default GitHub API URL for the latest release of forgekit-core.
const DEFAULT_LATEST_URL: String = "https://api.github.com/repos/ForgeKitStudio/forgekit-core/releases/latest"


# Currently installed Core version (e.g. `0.7.0`). The editor plugin
# reads this from `plugin.cfg` at startup and assigns the value here.
var current_version: String = "0.0.0"

# Rate-limit window in seconds; defaults to one hour.
var rate_limit_seconds: int = DEFAULT_RATE_LIMIT_SECONDS

# Cache path (writable). Override in tests so the production cache
# under `user://mcp_update_check.json` is never touched.
var cache_path: String = DEFAULT_CACHE_PATH

# URL polled by `check()`. Override in tests when needed.
var latest_url: String = DEFAULT_LATEST_URL


## Query the latest release and return a structured record.
##
## `http_client` duck-types as `{ fetch_json(url: String) -> Dictionary }`
## and should return `{ok: bool, data?: Dictionary, error?: String}`
## so the checker can short-circuit on network failure without
## treating the failure as "no newer version" vs. "no information".
##
## `now_unix_seconds` is injected so tests can step the clock
## deterministically.
func check(http_client: Object, now_unix_seconds: int) -> Dictionary:
	# Fast-path: honour the rate-limit cache.
	var cached: Dictionary = _read_cache()
	if not cached.is_empty():
		var last_ts: int = int(cached.get("last_unix_seconds", 0))
		if now_unix_seconds - last_ts < rate_limit_seconds:
			return cached.get("last_result", _empty_result())

	# Slow-path: fetch the latest release.
	var response: Dictionary = http_client.fetch_json(latest_url)
	if not response.get("ok", false):
		return {
			"ok": false,
			"checked": false,
			"update_available": false,
			"latest_version": "",
			"current_version": current_version,
		}

	var data: Dictionary = response.get("data", {}) as Dictionary
	var tag_name: String = String(data.get("tag_name", ""))
	var latest: String = _strip_leading_v(tag_name)

	var update_available: bool = _is_newer(latest, current_version)
	var result: Dictionary = {
		"ok": true,
		"checked": true,
		"update_available": update_available,
		"latest_version": latest,
		"current_version": current_version,
	}
	_write_cache(now_unix_seconds, result)
	return result


## Build the `UPDATE_AVAILABLE:` log line surfaced via
## `editor.get_output_log`. The template matches the text documented
## in Requirement 38.1 / task 6.22.1.
func format_log_line(latest_version: String) -> String:
	return "UPDATE_AVAILABLE: ForgeKit Core v%s available (running v%s). Run 'npx -y @forgekit/core-mcp@latest' to upgrade." % [
		_strip_leading_v(latest_version),
		_strip_leading_v(current_version),
	]


# ---------------------------------------------------------------------------
# Internals.
# ---------------------------------------------------------------------------

static func _strip_leading_v(value: String) -> String:
	if value.begins_with("v") or value.begins_with("V"):
		return value.substr(1, value.length() - 1)
	return value


static func _is_newer(candidate: String, reference: String) -> bool:
	var c: Array = _parse_semver(candidate)
	var r: Array = _parse_semver(reference)
	if c.is_empty() or r.is_empty():
		return false
	for i in range(3):
		if int(c[i]) > int(r[i]):
			return true
		if int(c[i]) < int(r[i]):
			return false
	return false


static func _parse_semver(v: String) -> Array:
	var stripped: String = _strip_leading_v(v)
	# Strip pre-release / build metadata so `0.7.0-rc1` parses cleanly.
	var hyphen: int = stripped.find("-")
	if hyphen != -1:
		stripped = stripped.substr(0, hyphen)
	var plus: int = stripped.find("+")
	if plus != -1:
		stripped = stripped.substr(0, plus)
	var parts: PackedStringArray = stripped.split(".")
	if parts.size() != 3:
		return []
	var nums: Array = []
	for p in parts:
		if not p.is_valid_int():
			return []
		nums.append(int(p))
	return nums


func _read_cache() -> Dictionary:
	if not FileAccess.file_exists(cache_path):
		return {}
	var file: FileAccess = FileAccess.open(cache_path, FileAccess.READ)
	if file == null:
		return {}
	var text: String = file.get_as_text()
	file.close()
	var parser: JSON = JSON.new()
	if parser.parse(text) != OK or not (parser.data is Dictionary):
		return {}
	return parser.data as Dictionary


func _write_cache(now_unix_seconds: int, result: Dictionary) -> void:
	var payload: Dictionary = {
		"last_unix_seconds": now_unix_seconds,
		"last_result": result,
	}
	var file: FileAccess = FileAccess.open(cache_path, FileAccess.WRITE)
	if file == null:
		return
	file.store_string(JSON.stringify(payload))
	file.close()


static func _empty_result() -> Dictionary:
	return {
		"ok": false,
		"checked": false,
		"update_available": false,
		"latest_version": "",
		"current_version": "",
	}
