extends GutTest
## Unit tests for McpHeartbeatMonitor.
##
## The monitor is transport-agnostic: it is given a `ping_sender` Callable
## that it invokes every `ping_interval_ms` with a monotonically increasing
## `ping_id`, and it advances its internal clock through an injected
## `tick(delta_ms)` method so the test suite never has to wait on real
## timers. When three consecutive pings have been sent without a matching
## pong arriving via `on_pong_received(id)`, the monitor emits the
## `connection_lost(drops_count, window_ms)` signal and increments its
## local `drops` counter.


const HEARTBEAT_MONITOR_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/editor_plugin/heartbeat_monitor.gd")

const PING_INTERVAL_MS: int = 10000
const PONG_WINDOW_MS: int = 30000


# ---------------------------------------------------------------------------
# PingRecorder — test double for the injected `ping_sender` Callable. Each
# call appends the ping id so the test can assert on the full sequence.
# ---------------------------------------------------------------------------

class PingRecorder:
	extends RefCounted

	var sent_ids: Array = []

	func send(ping_id: int) -> void:
		sent_ids.append(ping_id)


# Signal recorder — captures `connection_lost` payloads so assertions can
# check both the drop count and the window size.
class SignalRecorder:
	extends RefCounted

	var ping_events: Array = []
	var connection_lost_events: Array = []

	func on_ping_sent(ping_id: int) -> void:
		ping_events.append(ping_id)

	func on_connection_lost(drops_count: int, window_ms: int) -> void:
		connection_lost_events.append({"drops_count": drops_count, "window_ms": window_ms})


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

func _new_monitor() -> Dictionary:
	var recorder: PingRecorder = PingRecorder.new()
	var sink: SignalRecorder = SignalRecorder.new()
	var monitor: Object = HEARTBEAT_MONITOR_SCRIPT.new()
	monitor.set_ping_sender(Callable(recorder, "send"))
	monitor.ping_sent.connect(Callable(sink, "on_ping_sent"))
	monitor.connection_lost.connect(Callable(sink, "on_connection_lost"))
	return {"monitor": monitor, "recorder": recorder, "sink": sink}


# ---------------------------------------------------------------------------
# 1) Default interval exposes the 10s / 30s / 3-miss values from the spec.
# ---------------------------------------------------------------------------

func test_default_ping_interval_matches_spec_10_seconds() -> void:
	var monitor: Object = HEARTBEAT_MONITOR_SCRIPT.new()
	assert_eq(monitor.ping_interval_ms, PING_INTERVAL_MS, "Default ping interval must be 10000 ms per spec")
	assert_eq(monitor.pong_window_ms, PONG_WINDOW_MS, "Default pong window must be 30000 ms per spec")
	assert_eq(monitor.max_missed_pings, 3, "Default max missed pings must be 3 per spec")


# ---------------------------------------------------------------------------
# 2) start() triggers an immediate first ping with id=1.
# ---------------------------------------------------------------------------

func test_start_emits_first_ping_immediately_with_id_one() -> void:
	var env: Dictionary = _new_monitor()
	var monitor: Object = env["monitor"]
	var recorder: PingRecorder = env["recorder"]
	var sink: SignalRecorder = env["sink"]

	monitor.start()

	assert_eq(recorder.sent_ids, [1], "start() must send exactly one ping with id=1")
	assert_eq(sink.ping_events, [1], "start() must emit the ping_sent signal for id=1")


# ---------------------------------------------------------------------------
# 3) tick() sends the next ping after exactly 10s of elapsed time.
# ---------------------------------------------------------------------------

func test_tick_sends_next_ping_after_ten_seconds() -> void:
	var env: Dictionary = _new_monitor()
	var monitor: Object = env["monitor"]
	var recorder: PingRecorder = env["recorder"]

	monitor.start()
	monitor.tick(9999)
	assert_eq(recorder.sent_ids.size(), 1, "No second ping before the 10s interval has elapsed")

	monitor.tick(1)
	assert_eq(recorder.sent_ids, [1, 2], "Second ping must fire once 10s has elapsed")


# ---------------------------------------------------------------------------
# 4) Pong on the current ping resets the missed counter.
# ---------------------------------------------------------------------------

func test_pong_received_resets_missed_counter() -> void:
	var env: Dictionary = _new_monitor()
	var monitor: Object = env["monitor"]

	monitor.start()                  # ping 1
	monitor.tick(PING_INTERVAL_MS)   # ping 2 (ping 1 never pong'd → miss)
	assert_eq(monitor.consecutive_missed_pings, 1, "Second ping without pong for the first must mark one miss")

	monitor.on_pong_received(2)      # pong arrives for current ping
	assert_eq(monitor.consecutive_missed_pings, 0, "Pong must reset the missed counter to zero")


# ---------------------------------------------------------------------------
# 5) Three consecutive missed pongs emit connection_lost(3, 30000).
# ---------------------------------------------------------------------------

func test_three_consecutive_missed_pongs_emits_connection_lost() -> void:
	var env: Dictionary = _new_monitor()
	var monitor: Object = env["monitor"]
	var sink: SignalRecorder = env["sink"]

	monitor.start()                  # ping 1 at t=0
	monitor.tick(PING_INTERVAL_MS)   # ping 2 at t=10s — miss count=1
	monitor.tick(PING_INTERVAL_MS)   # ping 3 at t=20s — miss count=2
	monitor.tick(PING_INTERVAL_MS)   # ping 4 at t=30s — miss count=3 → connection_lost

	assert_eq(sink.connection_lost_events.size(), 1, "connection_lost must fire exactly once when 3 pings are missed in a row")
	var event: Dictionary = sink.connection_lost_events[0]
	assert_eq(event.get("drops_count", 0), 3, "drops_count payload must equal 3")
	assert_eq(event.get("window_ms", 0), PONG_WINDOW_MS, "window_ms payload must equal the 30s monitor window")


# ---------------------------------------------------------------------------
# 6) On connection loss the `drops` counter increments.
# ---------------------------------------------------------------------------

func test_connection_lost_increments_drops_counter() -> void:
	var env: Dictionary = _new_monitor()
	var monitor: Object = env["monitor"]

	assert_eq(monitor.get_drops(), 0, "drops counter must start at 0")

	monitor.start()
	monitor.tick(PING_INTERVAL_MS)
	monitor.tick(PING_INTERVAL_MS)
	monitor.tick(PING_INTERVAL_MS)

	assert_eq(monitor.get_drops(), 1, "drops must be incremented once when the threshold is reached")


# ---------------------------------------------------------------------------
# 7) A pong received between pings prevents the disconnect.
# ---------------------------------------------------------------------------

func test_intermediate_pong_prevents_disconnect() -> void:
	var env: Dictionary = _new_monitor()
	var monitor: Object = env["monitor"]
	var sink: SignalRecorder = env["sink"]

	monitor.start()                  # ping 1
	monitor.tick(PING_INTERVAL_MS)   # ping 2 — miss=1
	monitor.on_pong_received(2)      # pong arrives, miss=0
	monitor.tick(PING_INTERVAL_MS)   # ping 3 — miss=1 again (ping 3 has no pong yet)
	monitor.tick(PING_INTERVAL_MS)   # ping 4 — miss=2

	assert_eq(sink.connection_lost_events.size(), 0, "No connection_lost signal must be fired when a pong landed in the middle")


# ---------------------------------------------------------------------------
# 8) Stale pongs (unknown ids) do not reset the missed counter.
# ---------------------------------------------------------------------------

func test_stale_pong_is_ignored() -> void:
	var env: Dictionary = _new_monitor()
	var monitor: Object = env["monitor"]

	monitor.start()                  # ping 1
	monitor.tick(PING_INTERVAL_MS)   # ping 2 — miss=1, pending=2
	monitor.on_pong_received(99)     # stale: no such ping id
	assert_eq(monitor.consecutive_missed_pings, 1, "An unknown pong id must not reset the missed counter")


# ---------------------------------------------------------------------------
# 9) stop() prevents subsequent ticks from emitting pings.
# ---------------------------------------------------------------------------

func test_stop_halts_further_pings() -> void:
	var env: Dictionary = _new_monitor()
	var monitor: Object = env["monitor"]
	var recorder: PingRecorder = env["recorder"]

	monitor.start()                  # ping 1
	monitor.stop()
	monitor.tick(PING_INTERVAL_MS * 5)

	assert_eq(recorder.sent_ids, [1], "No pings must be sent after stop()")


# ---------------------------------------------------------------------------
# 10) connection_lost fires only once and stops the monitor — further ticks
#    do not keep firing it.
# ---------------------------------------------------------------------------

func test_connection_lost_fires_only_once() -> void:
	var env: Dictionary = _new_monitor()
	var monitor: Object = env["monitor"]
	var sink: SignalRecorder = env["sink"]

	monitor.start()
	monitor.tick(PING_INTERVAL_MS)
	monitor.tick(PING_INTERVAL_MS)
	monitor.tick(PING_INTERVAL_MS)           # threshold reached
	monitor.tick(PING_INTERVAL_MS * 10)      # many more ticks

	assert_eq(sink.connection_lost_events.size(), 1, "connection_lost must fire exactly once per disconnect event")
