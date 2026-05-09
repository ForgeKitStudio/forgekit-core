/**
 * Server-side JSON Lines logger.
 *
 * Mirrors `addons/forgekit_core/mcp/observability/jsonl_logger.gd` on
 * the Godot side so a trace id can be correlated across the two log
 * streams. One line per event, appended atomically to
 * `$HOME/.forgekit/logs/<YYYY-MM-DD>.jsonl` (or a caller-specified
 * `baseDir`).
 *
 * Line shape:
 *   {ts, level, component, trace_id?, span_id?, method?, duration_ms?, data?}
 *
 * Configuration:
 *   - `baseDir` — directory that will hold the rotated files. Defaults
 *                 to `$HOME/.forgekit/logs`. Created lazily on the
 *                 first write.
 *   - `level`   — minimum level to emit; anything below is dropped
 *                 silently. Defaults to `info`.
 *   - `clock`   — test-only injection point; production uses `Date`.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Log levels supported by the JSONL logger. Ordered low → high. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** Reserved fields hoisted to the top level of each JSONL line. */
const RESERVED_FIELDS: readonly string[] = [
  'trace_id',
  'span_id',
  'method',
  'duration_ms',
];

/** Constructor options for JsonlLogger. */
export interface JsonlLoggerOptions {
  baseDir?: string;
  level?: LogLevel;
  clock?: () => Date;
}

export function defaultBaseDir(): string {
  return join(homedir(), '.forgekit', 'logs');
}

export class JsonlLogger {
  private readonly baseDir: string;
  private readonly level: LogLevel;
  private readonly clock: () => Date;

  constructor(options: JsonlLoggerOptions = {}) {
    this.baseDir = options.baseDir ?? defaultBaseDir();
    this.level = options.level ?? 'info';
    this.clock = options.clock ?? (() => new Date());
  }

  log(level: LogLevel, component: string, data: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) {
      return;
    }
    const now = this.clock();
    const line: Record<string, unknown> = {
      ts: now.toISOString(),
      level,
      component,
    };
    for (const key of RESERVED_FIELDS) {
      if (data[key] !== undefined) {
        line[key] = data[key];
      }
    }
    const remainder: Record<string, unknown> = {};
    let hasRemainder = false;
    for (const [key, value] of Object.entries(data)) {
      if (RESERVED_FIELDS.includes(key)) {
        continue;
      }
      remainder[key] = value;
      hasRemainder = true;
    }
    if (hasRemainder) {
      line.data = remainder;
    }

    mkdirSync(this.baseDir, { recursive: true });
    const filePath = join(this.baseDir, `${dateStamp(now)}.jsonl`);
    appendFileSync(filePath, JSON.stringify(line) + '\n', { encoding: 'utf8' });
  }
}

/** Returns the UTC date stamp `YYYY-MM-DD` for the given Date. */
function dateStamp(d: Date): string {
  const year = d.getUTCFullYear().toString().padStart(4, '0');
  const month = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = d.getUTCDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}
