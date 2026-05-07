@tool
extends RefCounted
## Heartbeat monitor for the ForgeKit MCP editor plugin (client side of the
## WebSocket link).
##
## The monitor owns three timekeeping concerns:
##
##   1. Emit a ping every `ping_interval_ms` (10 s by default) via a caller-
##      supplied `ping_sender` Callable. Each ping is tagged with a
##      monotonically increasing integer id so the transport layer can
##      correlate pong replies without depending on wall-clock timestamps.
##   2. Track pong replies through `on_pong_received(id)`. A pong whose id
##      matches the current outstanding ping resets the missed counter;
##      pongs for unknown ids are ignored so stale replies cannot hide a
##      real disconnect.
##   3. When three consecutive pings have been sent without their pong
##      arriving (i.e. the client saw no live reply inside a 30 s window),
##      emit `connection_lost(drops_count, window_ms)` and increment the
##      local `drops` counter. The monitor stops itself at that point so
##      downstream components can safely tear the socket down without
##      racing with further ping callbacks.
##
## The clock is injected through `tick(delta_ms)` so the whole module is
## unit-testable headlessly. Wiring to a real Godot `Timer` is performed by
## the WebSocket server once the link is established.


class_name McpHeartbeatMonitor


## Ping cadence in milliseconds; defaults to 10 s per the spec.
var ping_interval_ms: int = 10000

## Window within which the monitor tolerates a lack of pongs; exceeding it
## with three consecutive missed pongs trips the disconnect signal.
var pong_window_ms: int = 30000

## Number of consecutive missed pongs that must occur before the monitor
## concludes the link is dead. Keyed to the spec wording: "three consecutive
## pong responses".
var max_missed_pings: int = 3

## Counter of back-to-back pings that have not received a matching pong
## yet. Public so tests and observers can read it without a getter.
var consecutive_missed_pings: int = 0


signal ping_sent(ping_id: int)
signal connection_lost(drops_count: int, window_ms: int)


var _ping_sender: Callable = Callable()
var _running: bool = false
var _time_since_last_ping_ms: int = 0
var _next_ping_id: int = 1
var _pending_ping_id: int = 0
var _drops: int = 0


## Install the Callable used to actually emit a ping on the transport. The
## callable is invoked as `ping_sender.call(ping_id)`; the monitor does not
## care how the transport frames the ping (WebSocket control frame, JSON-RPC
## notification, etc).
func set_ping_sender(callable: Callable) -> void:
	_ping_sender = callable


## Begin emitting pings. The first ping fires synchronously so the caller
## does not need to wait a full interval before the link is exercised.
func start() -> void:
	if _running:
		return
	_running = true
	_time_since_last_ping_ms = 0
	_send_next_ping()


## Stop emitting pings. Subsequent `tick()` calls become no-ops until
## `start()` is invoked again.
func stop() -> void:
	_running = false


## Read the local drop counter. Incremented once per `connection_lost`
## emission.
func get_drops() -> int:
	return _drops


## Advance the monitor's internal clock. Designed to be called either from
## a host Timer (`tick(int(delta * 1000.0))`) or from tests with explicit
## millisecond steps.
func tick(delta_ms: int) -> void:
	if not _running:
		return
	_time_since_last_ping_ms += delta_ms
	while _running and _time_since_last_ping_ms >= ping_interval_ms:
		_time_since_last_ping_ms -= ping_interval_ms
		_send_next_ping()


## Handle an incoming pong. Only the currently outstanding ping id resets
## the missed counter; older or unknown ids are discarded so stale replies
## cannot mask a real outage.
func on_pong_received(ping_id: int) -> void:
	if _pending_ping_id == 0 or ping_id != _pending_ping_id:
		return
	_pending_ping_id = 0
	consecutive_missed_pings = 0


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------

func _send_next_ping() -> void:
	# A still-outstanding pending ping means the previous cycle never saw a
	# pong: count it as a miss before overwriting with the new pending id.
	if _pending_ping_id != 0:
		consecutive_missed_pings += 1

	var ping_id: int = _next_ping_id
	_next_ping_id += 1
	_pending_ping_id = ping_id

	if _ping_sender.is_valid():
		_ping_sender.call(ping_id)
	ping_sent.emit(ping_id)

	if consecutive_missed_pings >= max_missed_pings:
		_drops += 1
		_running = false
		connection_lost.emit(consecutive_missed_pings, pong_window_ms)
