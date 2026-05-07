/**
 * Lightweight in-memory metrics registry used by the MCP server.
 *
 * Two metric kinds are supported:
 *   - counter: monotonically increasing integer accumulator incremented via
 *     `inc(name, by?)`.
 *   - gauge:   freely mutable numeric value written with `set(name, value)`.
 *
 * The registry intentionally has zero external dependencies so it can be
 * reused across transports (WebSocket, UDP, stdio) without pulling in a
 * full Prometheus / OpenTelemetry client. Exposure through a `/metrics`
 * HTTP endpoint is a separate concern handled by a later phase.
 *
 * Reading a name that was never written returns `0`, so callers can use
 * `get()` as a "read or default" accessor. A name may not be reused across
 * kinds: once it is written as a counter, calling `set()` on it throws, and
 * vice-versa.
 */

type MetricKind = 'counter' | 'gauge';

interface MetricEntry {
  kind: MetricKind;
  value: number;
}

export class Metrics {
  private readonly entries = new Map<string, MetricEntry>();

  /**
   * Increment the named counter by `by` (default `1`). The counter is
   * created lazily on first use.
   */
  inc(name: string, by = 1): void {
    const existing = this.entries.get(name);
    if (existing === undefined) {
      this.entries.set(name, { kind: 'counter', value: by });
      return;
    }
    if (existing.kind !== 'counter') {
      throw new Error(
        `Metric "${name}" is registered as a ${existing.kind}; cannot inc() a non-counter.`,
      );
    }
    existing.value += by;
  }

  /**
   * Set the named gauge to `value`. The gauge is created lazily on first
   * use.
   */
  set(name: string, value: number): void {
    const existing = this.entries.get(name);
    if (existing === undefined) {
      this.entries.set(name, { kind: 'gauge', value });
      return;
    }
    if (existing.kind !== 'gauge') {
      throw new Error(
        `Metric "${name}" is registered as a ${existing.kind}; cannot set() a non-gauge.`,
      );
    }
    existing.value = value;
  }

  /**
   * Return the current value of the named metric, or `0` if the metric has
   * never been written. This is intentionally kind-agnostic so callers can
   * inspect the registry without remembering whether a name was declared as
   * a counter or a gauge.
   */
  get(name: string): number {
    return this.entries.get(name)?.value ?? 0;
  }

  /**
   * Return a detached copy of the registry contents keyed by metric name.
   * Mutating the returned object does not affect the registry.
   */
  snapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [name, entry] of this.entries) {
      out[name] = entry.value;
    }
    return out;
  }
}
