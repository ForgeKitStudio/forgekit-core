/**
 * Observability metrics registry used by the MCP server health endpoint
 * and the JSON-RPC dispatcher.
 *
 * Two metric kinds are supported:
 *
 *   - `Counter`   — monotonically non-decreasing accumulator; `inc()`
 *                   adds to it, `value()` reads the current total.
 *   - `Histogram` — nearest-rank percentile sketch over a rolling
 *                   window of the most recent 1000 observations.
 *
 * The registry is intentionally kept in-memory and dependency-free so
 * it can be reused across transports and embedded in the health
 * endpoint without pulling in a full Prometheus / OpenTelemetry
 * client.
 *
 * The lower-level `src/metrics.ts` Metrics class remains in place for
 * the existing AutoReconnect / transport callers; this file adds the
 * richer Counter/Histogram surface needed for observability without
 * breaking those callers.
 */

const DEFAULT_HISTOGRAM_WINDOW = 1000;

/** Monotonically non-decreasing accumulator. */
export class Counter {
  private _value = 0;

  constructor(public readonly name: string) {}

  inc(delta = 1): void {
    if (delta < 0) {
      throw new Error(
        `Counter "${this.name}" cannot be decremented (got delta ${delta}).`,
      );
    }
    this._value += delta;
  }

  value(): number {
    return this._value;
  }
}

/** Snapshot returned by `Histogram.snapshot()`. */
export interface HistogramSnapshot {
  count: number;
  sum: number;
  p50: number;
  p95: number;
  p99: number;
}

/**
 * Nearest-rank percentile histogram with a rolling window. The window
 * keeps at most `windowSize` observations (default 1000); older
 * observations are dropped as new ones arrive.
 */
export class Histogram {
  private readonly samples: number[] = [];
  private readonly windowSize: number;
  private _sum = 0;

  constructor(
    public readonly name: string,
    windowSize: number = DEFAULT_HISTOGRAM_WINDOW,
  ) {
    if (!Number.isInteger(windowSize) || windowSize <= 0) {
      throw new Error(
        `Histogram "${name}" windowSize must be a positive integer, got ${windowSize}.`,
      );
    }
    this.windowSize = windowSize;
  }

  observe(value: number): void {
    this.samples.push(value);
    this._sum += value;
    while (this.samples.length > this.windowSize) {
      const removed = this.samples.shift()!;
      this._sum -= removed;
    }
  }

  snapshot(): HistogramSnapshot {
    const count = this.samples.length;
    if (count === 0) {
      return { count: 0, sum: 0, p50: 0, p95: 0, p99: 0 };
    }
    const sorted = [...this.samples].sort((a, b) => a - b);
    return {
      count,
      sum: this._sum,
      p50: nearestRank(sorted, 0.5),
      p95: nearestRank(sorted, 0.95),
      p99: nearestRank(sorted, 0.99),
    };
  }
}

function nearestRank(sorted: readonly number[], p: number): number {
  const n = sorted.length;
  if (n === 0) {
    return 0;
  }
  // Nearest-rank rule: index = ceil(p * n) - 1, clamped to [0, n-1].
  const idx = Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1));
  return sorted[idx]!;
}

/**
 * Named registry returning idempotent Counter/Histogram instances.
 * Re-registering the same name returns the existing instance;
 * registering the same name under a different kind throws.
 */
export class MetricsRegistry {
  private readonly counters = new Map<string, Counter>();
  private readonly histograms = new Map<string, Histogram>();

  registerCounter(name: string): Counter {
    if (this.histograms.has(name)) {
      throw new Error(
        `Metric "${name}" is already registered as a histogram; cannot re-register as counter.`,
      );
    }
    const existing = this.counters.get(name);
    if (existing !== undefined) {
      return existing;
    }
    const fresh = new Counter(name);
    this.counters.set(name, fresh);
    return fresh;
  }

  registerHistogram(name: string): Histogram {
    if (this.counters.has(name)) {
      throw new Error(
        `Metric "${name}" is already registered as a counter; cannot re-register as histogram.`,
      );
    }
    const existing = this.histograms.get(name);
    if (existing !== undefined) {
      return existing;
    }
    const fresh = new Histogram(name);
    this.histograms.set(name, fresh);
    return fresh;
  }

  listCounters(): Array<[string, Counter]> {
    return [...this.counters.entries()];
  }

  listHistograms(): Array<[string, Histogram]> {
    return [...this.histograms.entries()];
  }
}

// ---------------------------------------------------------------------
// Canonical metric names documented in the task list. Wiring the
// instrumentation at every call-site is the caller's job; exposing
// the names here centralizes the spelling and prevents typos
// drifting across transports.
// ---------------------------------------------------------------------

export const METRIC_REQUESTS_TOTAL = 'mcp.requests.total';
export const METRIC_REQUESTS_ERRORS = 'mcp.requests.errors';
export const METRIC_REQUESTS_DURATION_MS = 'mcp.requests.duration_ms';
export const METRIC_HEARTBEAT_DROPS = 'mcp.heartbeat.drops';
export const METRIC_RECONNECT_ATTEMPTS = 'mcp.reconnect.attempts';
export const METRIC_RECONNECT_BACKOFF_MS = 'mcp.reconnect.backoff_ms';
export const METRIC_UNDO_STACK_SIZE = 'mcp.editor_plugin.undo_stack_size';
export const METRIC_UDP_PACKETS_RECEIVED = 'mcp.runtime_bridge.udp_packets.received';
export const METRIC_UDP_PACKETS_REJECTED = 'mcp.runtime_bridge.udp_packets.rejected';
export const METRIC_HEALING_RETRIES = 'mcp.healing.retries';

/** Register the canonical set on an existing registry. Idempotent. */
export function registerCanonicalMetrics(registry: MetricsRegistry): void {
  registry.registerCounter(METRIC_REQUESTS_TOTAL);
  registry.registerCounter(METRIC_REQUESTS_ERRORS);
  registry.registerHistogram(METRIC_REQUESTS_DURATION_MS);
  registry.registerCounter(METRIC_HEARTBEAT_DROPS);
  registry.registerCounter(METRIC_RECONNECT_ATTEMPTS);
  registry.registerHistogram(METRIC_RECONNECT_BACKOFF_MS);
  registry.registerCounter(METRIC_UNDO_STACK_SIZE);
  registry.registerCounter(METRIC_UDP_PACKETS_RECEIVED);
  registry.registerCounter(METRIC_UDP_PACKETS_REJECTED);
  registry.registerCounter(METRIC_HEALING_RETRIES);
}
