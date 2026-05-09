extends GutTest
## Unit tests for McpRetryCounter: per-session per-resource retry counter
## with a hard limit of 3 attempts.


const RETRY_COUNTER_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/healing/retry_counter.gd")


func test_limit_is_three() -> void:
	var counter: Object = RETRY_COUNTER_SCRIPT.new()
	assert_eq(int(counter.limit()), 3, "Retry limit must be 3")


func test_fresh_path_returns_zero_attempts() -> void:
	var counter: Object = RETRY_COUNTER_SCRIPT.new()
	assert_eq(int(counter.get_attempts("res://unseen.tres")), 0, "Fresh path must report zero attempts")


func test_increment_advances_counter() -> void:
	var counter: Object = RETRY_COUNTER_SCRIPT.new()
	counter.increment("res://a.tres")
	assert_eq(int(counter.get_attempts("res://a.tres")), 1, "First increment must go from 0 to 1")
	counter.increment("res://a.tres")
	assert_eq(int(counter.get_attempts("res://a.tres")), 2, "Second increment must go from 1 to 2")


func test_increment_is_per_path() -> void:
	var counter: Object = RETRY_COUNTER_SCRIPT.new()
	counter.increment("res://a.tres")
	counter.increment("res://b.tres")
	counter.increment("res://b.tres")
	assert_eq(int(counter.get_attempts("res://a.tres")), 1, "Counter for a.tres must not leak into b.tres")
	assert_eq(int(counter.get_attempts("res://b.tres")), 2, "Each path must maintain its own count")


func test_reset_clears_specific_path() -> void:
	var counter: Object = RETRY_COUNTER_SCRIPT.new()
	counter.increment("res://a.tres")
	counter.increment("res://a.tres")
	counter.reset("res://a.tres")
	assert_eq(int(counter.get_attempts("res://a.tres")), 0, "reset() must zero the counter for the given path")


func test_exhausted_is_true_at_limit() -> void:
	var counter: Object = RETRY_COUNTER_SCRIPT.new()
	counter.increment("res://a.tres")
	counter.increment("res://a.tres")
	counter.increment("res://a.tres")
	assert_true(counter.is_exhausted("res://a.tres"), "is_exhausted must be true when attempts >= limit")


func test_exhausted_is_false_below_limit() -> void:
	var counter: Object = RETRY_COUNTER_SCRIPT.new()
	counter.increment("res://a.tres")
	counter.increment("res://a.tres")
	assert_false(counter.is_exhausted("res://a.tres"), "is_exhausted must be false when attempts < limit")


func test_retry_exhausted_signal_fires_once_at_limit() -> void:
	var counter: Object = RETRY_COUNTER_SCRIPT.new()
	var received: Array = []
	counter.retry_exhausted.connect(func(path: String) -> void:
		received.append(path)
	)
	counter.increment("res://a.tres")
	counter.increment("res://a.tres")
	assert_eq(received.size(), 0, "signal must not fire before the limit is reached")
	counter.increment("res://a.tres")
	assert_eq(received.size(), 1, "signal must fire exactly once when attempts reaches the limit")
	assert_eq(String(received[0]), "res://a.tres", "signal must carry the resource path")
	counter.increment("res://a.tres")
	assert_eq(received.size(), 1, "signal must not refire for additional attempts past the limit")
