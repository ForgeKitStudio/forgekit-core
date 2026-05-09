extends RefCounted
## McpRetryCounter — per-session in-memory retry counter tracking how many
## times a given `resource_path` has been through `healing.apply_and_retest`
## without a passing test run.
##
## The counter is in-memory only so restarting the editor resets every
## attempt count; long-lived failures are captured instead by the
## suggested_action escalation rule (Property 22) which returns
## `manual_review` once the counter hits the limit of 3.
##
## Emits `retry_exhausted(path: String)` exactly once when the counter
## for a given path first reaches the limit.


class_name McpRetryCounter


signal retry_exhausted(path: String)


const _LIMIT: int = 3


var _counts: Dictionary = {}
var _exhausted_notified: Dictionary = {}


## Hard-coded limit. Exposed as a method so callers can introspect it
## without importing the class.
func limit() -> int:
	return _LIMIT


## Increment the counter for `path`. Emits `retry_exhausted(path)` once
## when the post-increment count first reaches the limit.
func increment(path: String) -> void:
	var current: int = int(_counts.get(path, 0)) + 1
	_counts[path] = current
	if current >= _LIMIT and not _exhausted_notified.has(path):
		_exhausted_notified[path] = true
		retry_exhausted.emit(path)


## Return the current attempt count for `path`. Unknown paths return 0.
func get_attempts(path: String) -> int:
	return int(_counts.get(path, 0))


## Zero the counter for `path`. Clears the retry-exhausted latch so
## future `increment()` calls can refire the signal if the limit is hit
## again.
func reset(path: String) -> void:
	_counts.erase(path)
	_exhausted_notified.erase(path)


## True once `get_attempts(path) >= limit()`.
func is_exhausted(path: String) -> bool:
	return int(_counts.get(path, 0)) >= _LIMIT
