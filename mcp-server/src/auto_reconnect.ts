/**
 * Auto-reconnect manager for the MCP server's transports.
 *
 * The manager encapsulates the exponential backoff schedule
 * `1s → 2s → 4s → 8s → 16s → 32s → 60s` (capping at 60s) used to space
 * reconnection attempts after a WebSocket or UDP disconnect, and updates
 * the shared `Metrics` registry:
 *
 *   - `mcp.reconnect.attempts` (counter) is incremented on every
 *     `nextBackoffMs()` call.
 *   - `mcp.reconnect.backoff_ms` (gauge) is written with the delay that
 *     the latest `nextBackoffMs()` call returned.
 *
 * Scheduling the actual `setTimeout()` / `await` that waits for the delay
 * is the caller's responsibility — this module is a pure state machine so
 * it can be unit-tested without real timers.
 */

import type { Metrics } from './metrics.js';

/** Canonical backoff schedule from the product spec, in milliseconds. */
export const DEFAULT_BACKOFF_SCHEDULE_MS: readonly number[] = [
  1000, 2000, 4000, 8000, 16000, 32000, 60000,
] as const;

const METRIC_ATTEMPTS = 'mcp.reconnect.attempts';
const METRIC_BACKOFF_MS = 'mcp.reconnect.backoff_ms';

export class AutoReconnect {
  private readonly schedule: readonly number[];
  private index = 0;

  constructor(
    private readonly metrics: Metrics,
    schedule: readonly number[] = DEFAULT_BACKOFF_SCHEDULE_MS,
  ) {
    if (schedule.length === 0) {
      throw new Error('AutoReconnect schedule must not be empty.');
    }
    this.schedule = schedule;
  }

  /**
   * Delay the next `nextBackoffMs()` call is about to return, without
   * advancing the schedule or touching metrics. Useful for display.
   */
  get currentBackoffMs(): number {
    return this.schedule[Math.min(this.index, this.schedule.length - 1)]!;
  }

  /**
   * Record one reconnection attempt and return the delay (in ms) the caller
   * should wait before actually dialling the remote again. The schedule
   * advances until it reaches its last entry, which is then repeated
   * indefinitely.
   */
  nextBackoffMs(): number {
    const delay = this.schedule[Math.min(this.index, this.schedule.length - 1)]!;
    if (this.index < this.schedule.length - 1) {
      this.index += 1;
    }
    this.metrics.inc(METRIC_ATTEMPTS);
    this.metrics.set(METRIC_BACKOFF_MS, delay);
    return delay;
  }

  /**
   * Notify the manager that the connection was re-established. The
   * schedule rewinds to its first entry so the next outage starts with the
   * initial `1s` backoff.
   */
  onConnected(): void {
    this.index = 0;
  }
}
