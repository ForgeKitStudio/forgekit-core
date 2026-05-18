/**
 * MCP health endpoint HTTP server (v0.10.0 schema).
 *
 * Binds the first free TCP port in `HEALTH_RANGE` (6040-6049) on
 * `127.0.0.1` and exposes four read-only routes:
 *
 *   GET /health           — `{status, version, uptime_s, channels:
 *                            {editor, runtime}, profile,
 *                            unlocked_modules, workspaces}`.
 *   GET /version          — `{version, api_version, sdk_version,
 *                            godot_compat, schemas_count}`.
 *   GET /metrics          — JSON cumulative stats:
 *                            `{requests_total, requests_by_method,
 *                              errors_total, errors_by_code,
 *                              dispatch_latency_p50_ms,
 *                              dispatch_latency_p99_ms}`.
 *   GET /trace/:trace_id  — last 100 JSONL entries (across up to the
 *                            last 7 days) filtered by trace_id, sorted
 *                            by `ts` ascending.
 *
 * The chosen port is merged into the shared `mcp_active_port.json`
 * file under the `"health"` key so the editor plugin and runtime
 * bridge can discover it alongside the other active ports.
 */

import { createServer as createHttpServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

import {
  Counter,
  Histogram,
  MetricsRegistry,
  METRIC_REQUESTS_TOTAL,
  METRIC_REQUESTS_ERRORS,
  METRIC_REQUESTS_DURATION_MS,
} from './observability/metrics.js';
import {
  HEALTH_RANGE,
  scanFreePort,
} from './port_scanner.js';
import type { ProjectRegistry } from './projects/registry.js';

/** Aggregate channel rollup status returned by `channelStatusProvider`. */
export type ChannelName = 'ok' | 'degraded' | 'down';

/** Per-channel rollup map consumed by `/health` rollup logic. */
export interface HealthChecks {
  editor: ChannelName;
  runtime: ChannelName;
  cli: ChannelName;
}

/** Per-channel transport detail returned by `channelInfoProvider`. */
export interface ChannelInfo {
  connected: boolean;
  port: number | null;
  last_heartbeat_ms_ago: number | null;
}

/** Pair of channel infos returned together by `channelInfoProvider`. */
export interface ChannelInfoMap {
  editor: ChannelInfo;
  runtime: ChannelInfo;
}

/** JSON shape returned by `/metrics`. */
export interface MetricsSnapshot {
  requests_total: number;
  requests_by_method: Record<string, number>;
  errors_total: number;
  errors_by_code: Record<string, number>;
  dispatch_latency_p50_ms: number;
  dispatch_latency_p99_ms: number;
}

/** Constructor options for HealthEndpoint. */
export interface HealthEndpointOptions {
  metrics: MetricsRegistry;
  /** Path to `mcp_active_port.json`. Written atomically on start. */
  activePortFilePath: string;
  /** Directory containing `<YYYY-MM-DD>.jsonl` files for `/trace/:id`. */
  logsDir: string;
  /** Resolves the Core git tag. Returns `"unknown"` on failure. */
  coreVersionResolver: () => Promise<string>;
  /** Server version string, echoed by `/health.version`. */
  serverVersion: string;
  /** Returns the current per-channel rollup status. */
  channelStatusProvider: () => HealthChecks;
  /**
   * Optional per-channel transport detail used by `/health.channels`.
   * Defaults to `connected: false, port: null, last_heartbeat_ms_ago:
   * null` for both editor and runtime when omitted.
   */
  channelInfoProvider?: () => ChannelInfoMap;
  /** Active CLI profile (`Full` / `Lite` / `Minimal` / `RPG-only`). */
  profile?: string;
  /** License-derived list of unlocked module ids. */
  unlockedModules?: readonly string[];
  /** API version exposed by `/version`. Defaults to `serverVersion`. */
  apiVersion?: string;
  /** SDK version label exposed by `/version`. */
  sdkVersion?: string;
  /** Godot compatibility tags exposed by `/version`. */
  godotCompat?: readonly string[];
  /** Total tool-schema count exposed by `/version`. */
  schemasCount?: number;
  /**
   * Optional aggregator returning a fully-formed `MetricsSnapshot` for
   * `/metrics`. When omitted the endpoint derives the snapshot from
   * the `MetricsRegistry` canonical metrics so the contract is
   * satisfied even before the dispatcher wires its per-method/per-code
   * tagging path.
   */
  metricsSnapshotProvider?: () => MetricsSnapshot;
  /** Test-only clock override. Defaults to `() => new Date()`. */
  clock?: () => Date;
  /**
   * Optional ProjectRegistry. When supplied, `/health` responses
   * gain a `workspaces: {count, active}` field summarising the
   * registry state.
   */
  registry?: ProjectRegistry;
}

/** Default number of recent days of log files to scan for /trace. */
const TRACE_LOOKBACK_DAYS = 7;

/** Maximum number of JSONL entries returned by /trace/:trace_id. */
const TRACE_MAX_ENTRIES = 100;

const DEFAULT_CHANNEL_INFO: ChannelInfo = {
  connected: false,
  port: null,
  last_heartbeat_ms_ago: null,
};

export class HealthEndpoint {
  private readonly opts: HealthEndpointOptions;
  private readonly clock: () => Date;
  private server: Server | null = null;
  private port: number | null = null;
  private startedAtMs: number | null = null;

  constructor(opts: HealthEndpointOptions) {
    this.opts = opts;
    this.clock = opts.clock ?? (() => new Date());
  }

  async start(): Promise<void> {
    const port = await scanFreePort(HEALTH_RANGE);
    this.server = createHttpServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(port, '127.0.0.1', () => resolve());
    });
    this.port = port;
    this.startedAtMs = this.clock().getTime();
    await this.writeActivePort(port);
  }

  async stop(): Promise<void> {
    if (this.server === null) {
      return;
    }
    const server = this.server;
    this.server = null;
    this.port = null;
    this.startedAtMs = null;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  getPort(): number {
    if (this.port === null) {
      throw new Error('HealthEndpoint is not listening.');
    }
    return this.port;
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Method Not Allowed');
      return;
    }
    const url = req.url ?? '/';
    if (url === '/health') {
      this.serveHealth(res);
      return;
    }
    if (url === '/metrics') {
      this.serveMetrics(res);
      return;
    }
    if (url === '/version') {
      void this.serveVersion(res);
      return;
    }
    if (url.startsWith('/trace/')) {
      const traceId = decodeURIComponent(url.slice('/trace/'.length));
      void this.serveTrace(res, traceId);
      return;
    }
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Not Found');
  }

  // -------------------------------------------------------------------
  // /health
  // -------------------------------------------------------------------

  private serveHealth(res: ServerResponse): void {
    const checks = this.opts.channelStatusProvider();
    const status = rollupStatus(checks);
    const channelInfo = this.opts.channelInfoProvider !== undefined
      ? this.opts.channelInfoProvider()
      : { editor: DEFAULT_CHANNEL_INFO, runtime: DEFAULT_CHANNEL_INFO };
    const uptimeS = this.computeUptimeSeconds();
    const body: Record<string, unknown> = {
      status,
      version: this.opts.serverVersion,
      uptime_s: uptimeS,
      channels: {
        editor: channelInfo.editor,
        runtime: channelInfo.runtime,
      },
      profile: this.opts.profile ?? 'Full',
      unlocked_modules: [...(this.opts.unlockedModules ?? [])],
    };
    if (this.opts.registry !== undefined) {
      const active = this.opts.registry.getActive();
      body.workspaces = {
        count: this.opts.registry.size(),
        active: active?.workspace_id ?? null,
      };
    } else {
      body.workspaces = { count: 0, active: null };
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  }

  private computeUptimeSeconds(): number {
    if (this.startedAtMs === null) {
      return 0;
    }
    const nowMs = this.clock().getTime();
    const deltaMs = nowMs - this.startedAtMs;
    if (deltaMs <= 0) {
      return 0;
    }
    return Math.floor(deltaMs / 1000);
  }

  // -------------------------------------------------------------------
  // /metrics
  // -------------------------------------------------------------------

  private serveMetrics(res: ServerResponse): void {
    const snapshot = this.opts.metricsSnapshotProvider !== undefined
      ? this.opts.metricsSnapshotProvider()
      : this.deriveMetricsSnapshot();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(snapshot));
  }

  private deriveMetricsSnapshot(): MetricsSnapshot {
    const counters = new Map(this.opts.metrics.listCounters());
    const histograms = new Map(this.opts.metrics.listHistograms());
    const requestsTotal = counters.get(METRIC_REQUESTS_TOTAL)?.value() ?? 0;
    const errorsTotal = counters.get(METRIC_REQUESTS_ERRORS)?.value() ?? 0;
    const histogram = histograms.get(METRIC_REQUESTS_DURATION_MS);
    let p50 = 0;
    let p99 = 0;
    if (histogram !== undefined) {
      const snap = histogram.snapshot();
      p50 = snap.p50;
      p99 = snap.p99;
    }
    return {
      requests_total: requestsTotal,
      requests_by_method: {},
      errors_total: errorsTotal,
      errors_by_code: {},
      dispatch_latency_p50_ms: p50,
      dispatch_latency_p99_ms: p99,
    };
  }

  // -------------------------------------------------------------------
  // /version
  // -------------------------------------------------------------------

  private async serveVersion(res: ServerResponse): Promise<void> {
    let coreDetected = 'unknown';
    try {
      coreDetected = await this.opts.coreVersionResolver();
    } catch {
      coreDetected = 'unknown';
    }
    const body = {
      version: this.opts.serverVersion,
      api_version: this.opts.apiVersion ?? this.opts.serverVersion,
      sdk_version: this.opts.sdkVersion ?? 'unknown',
      godot_compat: [...(this.opts.godotCompat ?? [])],
      schemas_count: this.opts.schemasCount ?? 0,
      core_detected: coreDetected,
    };
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  }

  // -------------------------------------------------------------------
  // /trace/:trace_id
  // -------------------------------------------------------------------

  private async serveTrace(res: ServerResponse, traceId: string): Promise<void> {
    const entries = await this.collectTraceEntries(traceId);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(entries));
  }

  private async collectTraceEntries(traceId: string): Promise<Array<Record<string, unknown>>> {
    const now = this.clock();
    const dates: string[] = [];
    for (let i = 0; i < TRACE_LOOKBACK_DAYS; i++) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      dates.push(dateStamp(d));
    }
    const out: Array<Record<string, unknown>> = [];
    for (const date of dates) {
      const path = join(this.opts.logsDir, `${date}.jsonl`);
      let raw: string;
      try {
        raw = await readFile(path, 'utf8');
      } catch {
        continue;
      }
      for (const line of raw.split('\n')) {
        if (line === '') {
          continue;
        }
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          if (parsed.trace_id === traceId) {
            out.push(parsed);
          }
        } catch {
          // Skip malformed lines rather than failing the whole request.
        }
      }
    }
    out.sort((a, b) => {
      const ta = String(a.ts ?? '');
      const tb = String(b.ts ?? '');
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });
    return out.slice(0, TRACE_MAX_ENTRIES);
  }

  // -------------------------------------------------------------------
  // Active-port file bookkeeping.
  // -------------------------------------------------------------------

  private async writeActivePort(port: number): Promise<void> {
    let existing: Record<string, unknown> = {};
    try {
      const raw = await readFile(this.opts.activePortFilePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        existing = parsed as Record<string, unknown>;
      }
    } catch {
      // Missing / malformed — fall back to a fresh object.
    }
    existing.health = port;
    const suffix = randomBytes(4).toString('hex');
    const tempPath = `${this.opts.activePortFilePath}.${suffix}.tmp`;
    const payload = JSON.stringify(existing, null, 2) + '\n';
    try {
      await writeFile(tempPath, payload, { encoding: 'utf8' });
      await rename(tempPath, this.opts.activePortFilePath);
    } catch (err) {
      try {
        await unlink(tempPath);
      } catch {
        // ignore
      }
      throw err;
    }
  }
}

// ---------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------

function rollupStatus(checks: HealthChecks): ChannelName {
  const values = [checks.editor, checks.runtime, checks.cli];
  if (values.includes('down')) {
    return 'down';
  }
  if (values.includes('degraded')) {
    return 'degraded';
  }
  return 'ok';
}

function dateStamp(d: Date): string {
  const year = d.getUTCFullYear().toString().padStart(4, '0');
  const month = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = d.getUTCDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Re-export for tests / callers that want the raw building blocks.
export type { Counter, Histogram };
