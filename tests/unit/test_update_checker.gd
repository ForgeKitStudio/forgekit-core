extends GutTest
## Unit tests for McpUpdateChecker — periodically checks the GitHub
## `releases/latest` endpoint of `ForgeKitStudio/forgekit-core` and
## surfaces a `UPDATE_AVAILABLE` log line when a newer version is
## available. Rate-limited to once per hour through a timestamp cache
## stored under `user://mcp_update_check.json`.


const UPDATE_CHECKER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/update_checker.gd")


# Fake HTTP client implementing `fetch_json(url) -> Dictionary` so the
# checker never touches the network.
class FakeHttpClient:
	extends RefCounted

	var calls: Array = []
	var response: Dictionary = {"ok": true, "data": {}}

	func fetch_json(url: String) -> Dictionary:
		calls.append(url)
		return response.duplicate(true)


var _scratch_cache: String = ""


func before_each() -> void:
	_scratch_cache = "user://test_update_checker_%d.json" % Time.get_ticks_usec()


func after_each() -> void:
	if FileAccess.file_exists(_scratch_cache):
		DirAccess.remove_absolute(_scratch_cache)


func _new_checker(current_version: String = "0.7.0") -> Object:
	var checker: Object = UPDATE_CHECKER_SCRIPT.new()
	checker.current_version = current_version
	checker.cache_path = _scratch_cache
	return checker


# ---------------------------------------------------------------------------
# 1) Newer release available -> returns an update-available record.
# ---------------------------------------------------------------------------

func test_reports_update_available_when_remote_is_newer() -> void:
	var checker: Object = _new_checker("0.7.0")
	var client: FakeHttpClient = FakeHttpClient.new()
	client.response = {"ok": true, "data": {"tag_name": "v0.8.0"}}

	var result: Dictionary = checker.check(client, 0)

	assert_true(result.get("update_available", false), "Expected update_available=true when remote is newer")
	assert_eq(String(result.get("latest_version", "")), "0.8.0", "latest_version must be echoed without the leading 'v'")
	assert_eq(String(result.get("current_version", "")), "0.7.0", "current_version must echo the running version")


# ---------------------------------------------------------------------------
# 2) Same version -> no update advertised.
# ---------------------------------------------------------------------------

func test_reports_no_update_when_remote_equals_current() -> void:
	var checker: Object = _new_checker("0.7.0")
	var client: FakeHttpClient = FakeHttpClient.new()
	client.response = {"ok": true, "data": {"tag_name": "v0.7.0"}}

	var result: Dictionary = checker.check(client, 0)

	assert_false(result.get("update_available", true), "No update should be reported when remote equals current")
	assert_eq(String(result.get("latest_version", "")), "0.7.0", "latest_version still echoes the remote tag")


# ---------------------------------------------------------------------------
# 3) Remote older -> no update advertised.
# ---------------------------------------------------------------------------

func test_reports_no_update_when_remote_is_older() -> void:
	var checker: Object = _new_checker("0.7.0")
	var client: FakeHttpClient = FakeHttpClient.new()
	client.response = {"ok": true, "data": {"tag_name": "v0.6.0"}}

	var result: Dictionary = checker.check(client, 0)

	assert_false(result.get("update_available", true), "No update should be reported when remote is older than current")


# ---------------------------------------------------------------------------
# 4) Network failure -> no error, no update advertised; no cache write.
# ---------------------------------------------------------------------------

func test_gracefully_ignores_network_failure() -> void:
	var checker: Object = _new_checker("0.7.0")
	var client: FakeHttpClient = FakeHttpClient.new()
	client.response = {"ok": false, "error": "ENOTFOUND"}

	var result: Dictionary = checker.check(client, 0)

	assert_false(result.get("update_available", true), "Network failure must not advertise an update")
	assert_false(result.get("checked", false), "Network failure must not advertise a successful check")


# ---------------------------------------------------------------------------
# 5) Rate limit: a second check inside the same hour is skipped.
# ---------------------------------------------------------------------------

func test_rate_limits_to_once_per_hour() -> void:
	var checker: Object = _new_checker("0.7.0")
	var client: FakeHttpClient = FakeHttpClient.new()
	client.response = {"ok": true, "data": {"tag_name": "v0.8.0"}}

	# First call at unix_time=0 populates the cache.
	var _first: Dictionary = checker.check(client, 0)
	# Second call 30 minutes later must reuse the cache without calling the client.
	var second: Dictionary = checker.check(client, 1800)

	assert_eq(client.calls.size(), 1, "Client must not be called again inside the rate-limit window")
	# The second call should still report the cached outcome.
	assert_true(second.get("update_available", false), "Cached update_available must be surfaced to the caller")


# ---------------------------------------------------------------------------
# 6) Rate limit window elapsed: a new fetch happens.
# ---------------------------------------------------------------------------

func test_refetches_after_rate_limit_window() -> void:
	var checker: Object = _new_checker("0.7.0")
	var client: FakeHttpClient = FakeHttpClient.new()
	client.response = {"ok": true, "data": {"tag_name": "v0.8.0"}}

	var _first: Dictionary = checker.check(client, 0)
	# 2 hours later (window is 1 hour) → must refetch.
	var _second: Dictionary = checker.check(client, 7200)

	assert_eq(client.calls.size(), 2, "Client must be re-invoked once the rate-limit window elapses")


# ---------------------------------------------------------------------------
# 7) format_log_line() produces the documented UPDATE_AVAILABLE string.
# ---------------------------------------------------------------------------

func test_format_log_line_emits_update_available_template() -> void:
	var checker: Object = _new_checker("0.7.0")
	var line: String = checker.format_log_line("0.8.0")
	assert_true(line.begins_with("UPDATE_AVAILABLE:"), "Line must start with the UPDATE_AVAILABLE prefix")
	assert_true(line.contains("v0.8.0"), "Line must mention the new version with a leading 'v'")
	assert_true(line.contains("v0.7.0"), "Line must mention the running version with a leading 'v'")
	assert_true(line.contains("npx -y @forgekitstudio/core-mcp@latest"), "Line must point the user at the npx upgrade command")
