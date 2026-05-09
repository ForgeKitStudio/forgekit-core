/**
 * MCP health endpoint HTTP server.
 *
 * Binds the first free TCP port in `HEALTH_RANGE` (6040-6049) on
 * `127.0.0.1` and exposes four read-only routes:
 *
 *   GET /health           — `{status, checks: {editor, runtime, cli}}`
 *   GET /metrics          — Prometheus-style text render of the
 *                            canonical counter/histogram surface.
 *   GET /version          — `{server, core_detected, api_version}`.
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
} from './observability/metrics.js';
import {
  HEALTH_RANGE,
  scanFreePort,
} from './port_scanner.js';
import type { ProjectRegistry } from './projects/registry.js';

/** Per-channel status summary shipped by `channelStatusProvider`. */
export type ChannelName = 'ok' | 'degraded' | 'down';

export interface HealthChecks {
  editor: ChannelName;
  runtime: ChannelName;
  cli: ChannelName;
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
  /** Server version string, echoed by `/version`. */
  serverVersion: string;
  /** Returns the current per-channel status. */
  channelStatusProvider: () => HealthChecks;
  /** Test-only clock override. Defaults to `() => new Date()`. */
  clock?: () => Date;
  /**
   * Optional ProjectRegistry. When supplied, `/health` responses
   * gain a `workspaces: {count, active}` field summarising the
   * registry state. Omitted-field fallback preserves backwards
   * compatibility with callers that predate Phase 7.
   */
  registry?: ProjectRegistry;
}

/** Default number of recent days of log files to scan for /trace. */
const TRACE_LOOKBACK_DAYS = 7;

/** Maximum number of JSONL entries returned by /trace/:trace_id. */
const TRACE_MAX_ENTRIES = 100;

export class HealthEndpoint {
  private readonly opts: HealthEndpointOptions;
  private readonly clock: () => Date;
  private server: Server | null = null;
  private port: number | null = null;

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
    await this.writeActivePort(port);
  }

  async stop(): Promise<void> {
    if (this.server === null) {
      return;
    }
    const server = this.server;
    this.server = null;
    this.port = null;
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
    // Only serve GET; everything else returns 405.
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
    const body: Record<string, unknown> = { status, checks };
    if (this.opts.registry !== undefined) {
      const active = this.opts.registry.getActive();
      body.workspaces = {
        count: this.opts.registry.size(),
        active: active?.workspace_id ?? null,
      };
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  }

  // -------------------------------------------------------------------
  // /metrics
  // -------------------------------------------------------------------

  private serveMetrics(res: ServerResponse): void {
    const lines: string[] = [];
    for (const [name, counter] of this.opts.metrics.listCounters()) {
      const safeName = promMetricName(name);
      lines.push(`# HELP ${safeName} ${name}`);
      lines.push(`# TYPE ${safeName} counter`);
      lines.push(`${safeName} ${counter.value()}`);
    }
    for (const [name, histogram] of this.opts.metrics.listHistograms()) {
      const safeName = promMetricName(name);
      const snap = histogram.snapshot();
      lines.push(`# HELP ${safeName} ${name}`);
      lines.push(`# TYPE ${safeName} histogram`);
      lines.push(`${safeName}_count ${snap.count}`);
      lines.push(`${safeName}_sum ${snap.sum}`);
      lines.push(`${safeName}{quantile="0.5"} ${snap.p50}`);
      lines.push(`${safeName}{quantile="0.95"} ${snap.p95}`);
      lines.push(`${safeName}{quantile="0.99"} ${snap.p99}`);
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.end(lines.join('\n') + '\n');
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
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        server: this.opts.serverVersion,
        core_detected: coreDetected,
        api_version: this.opts.serverVersion,
      }),
    );
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
      // Missing / malformed — fall back to a fresh object. We'll only
      // write the `health` key; sibling keys (editor, runtime,
      // visualizer) are only echoed when the pre-existing file had
      // them.
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

/** Translate a ForgeKit metric name to a Prometheus-safe identifier. */
function promMetricName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_');
}

function dateStamp(d: Date): string {
  const year = d.getUTCFullYear().toString().padStart(4, '0');
  const month = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = d.getUTCDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Re-export for tests / callers that want the raw building blocks.
export type { Counter, Histogram };
