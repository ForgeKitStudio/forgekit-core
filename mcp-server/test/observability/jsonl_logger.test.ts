/**
 * Tests for the server-side JSONL logger mirror of
 * addons/forgekit_core/mcp/observability/jsonl_logger.gd.
 *
 * Line shape (shared with the GDScript side so a `trace_id` can be
 * correlated across streams):
 *   {ts, level, component, trace_id?, span_id?, method?, duration_ms?, data?}
 *
 *   - `ts`        ISO-8601 UTC timestamp (`2026-05-16T18:12:33.540Z`).
 *   - `level`     one of `debug | info | warn | error`.
 *   - `component` caller-supplied name (for example `mcp_server`,
 *                 `editor_plugin`, `runtime_bridge`).
 *
 * Files rotate by UTC date under `$HOME/.forgekit/logs/<YYYY-MM-DD>.jsonl`.
 * The log directory is created lazily; each `log()` call appends a
 * single line with no buffering across lines so a crashed process does
 * not lose already-emitted events.
 */

import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { JsonlLogger } from '../../src/observability/jsonl_logger.js';

interface TestEnv {
  baseDir: string;
}

async function newEnv(): Promise<TestEnv> {
  const baseDir = await mkdtemp(join(tmpdir(), 'forgekit-jsonl-'));
  return { baseDir };
}

function readLines(content: string): Record<string, unknown>[] {
  return content
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

let env: TestEnv;

beforeEach(async () => {
  env = await newEnv();
});

afterEach(() => {
  // Per-test tmp dir; OS cleans up on reboot. No explicit rm to keep
  // debugging easier on failing tests.
});

describe('JsonlLogger — basic round-trip', () => {
  it('writes a single line per log call under <baseDir>/<YYYY-MM-DD>.jsonl', async () => {
    const logger = new JsonlLogger({
      baseDir: env.baseDir,
      level: 'info',
      clock: () => new Date('2026-05-16T18:12:33.540Z'),
    });

    logger.log('info', 'mcp_server', {
      method: 'tests.run_unit',
      detail: { test_name: 'test_crafting' },
    });

    const filePath = join(env.baseDir, '2026-05-16.jsonl');
    const raw = await readFile(filePath, 'utf8');
    const lines = readLines(raw);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.ts).toBe('2026-05-16T18:12:33.540Z');
    expect(lines[0]!.level).toBe('info');
    expect(lines[0]!.component).toBe('mcp_server');
    // `method` is hoisted to the top level per the shared line schema;
    // the rest of the payload travels under `data`.
    expect(lines[0]!.method).toBe('tests.run_unit');
    expect(lines[0]!.data).toEqual({ detail: { test_name: 'test_crafting' } });
  });

  it('includes trace_id and span_id fields when provided through data', async () => {
    const logger = new JsonlLogger({
      baseDir: env.baseDir,
      level: 'info',
      clock: () => new Date('2026-05-16T18:12:33.540Z'),
    });

    logger.log('info', 'mcp_server', {
      trace_id: 'abcd1234',
      span_id: '0001',
      method: 'project.info',
      duration_ms: 12,
    });

    const raw = await readFile(join(env.baseDir, '2026-05-16.jsonl'), 'utf8');
    const [line] = readLines(raw);
    expect(line!.trace_id).toBe('abcd1234');
    expect(line!.span_id).toBe('0001');
    expect(line!.method).toBe('project.info');
    expect(line!.duration_ms).toBe(12);
  });

  it('promotes workspace_id to the top level as a reserved field (Phase 7)', async () => {
    const logger = new JsonlLogger({
      baseDir: env.baseDir,
      level: 'info',
      clock: () => new Date('2026-05-16T18:12:33.540Z'),
    });

    logger.log('info', 'mcp_server', {
      trace_id: 'abcd1234',
      workspace_id: 'client-a',
      payload_hint: 'goes to data',
    });

    const raw = await readFile(join(env.baseDir, '2026-05-16.jsonl'), 'utf8');
    const [line] = readLines(raw);
    expect(line!.workspace_id).toBe('client-a');
    expect(line!.trace_id).toBe('abcd1234');
    // Non-reserved keys stay nested under data.
    const data = line!.data as Record<string, unknown>;
    expect(data.payload_hint).toBe('goes to data');
    expect(data.workspace_id).toBeUndefined();
  });
});

describe('JsonlLogger — level filter', () => {
  it('drops lines below the configured threshold', async () => {
    const logger = new JsonlLogger({
      baseDir: env.baseDir,
      level: 'warn',
      clock: () => new Date('2026-05-16T12:00:00.000Z'),
    });

    logger.log('debug', 'mcp_server', {});
    logger.log('info', 'mcp_server', {});
    logger.log('warn', 'mcp_server', { note: 'kept' });
    logger.log('error', 'mcp_server', { note: 'kept' });

    const raw = await readFile(join(env.baseDir, '2026-05-16.jsonl'), 'utf8');
    const lines = readLines(raw);
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.level)).toEqual(['warn', 'error']);
  });

  it('keeps lines at the threshold when level is "debug"', async () => {
    const logger = new JsonlLogger({
      baseDir: env.baseDir,
      level: 'debug',
      clock: () => new Date('2026-05-16T12:00:00.000Z'),
    });

    logger.log('debug', 'mcp_server', {});
    logger.log('info', 'mcp_server', {});
    logger.log('warn', 'mcp_server', {});
    logger.log('error', 'mcp_server', {});

    const raw = await readFile(join(env.baseDir, '2026-05-16.jsonl'), 'utf8');
    expect(readLines(raw)).toHaveLength(4);
  });
});

describe('JsonlLogger — date rotation', () => {
  it('opens a new file when the UTC date advances', async () => {
    let now = new Date('2026-05-16T23:59:58.000Z');
    const logger = new JsonlLogger({
      baseDir: env.baseDir,
      level: 'info',
      clock: () => now,
    });

    logger.log('info', 'mcp_server', { n: 1 });
    now = new Date('2026-05-17T00:00:02.000Z');
    logger.log('info', 'mcp_server', { n: 2 });

    const before = await readFile(join(env.baseDir, '2026-05-16.jsonl'), 'utf8');
    const after = await readFile(join(env.baseDir, '2026-05-17.jsonl'), 'utf8');
    expect(readLines(before)).toHaveLength(1);
    expect(readLines(after)).toHaveLength(1);
  });
});

describe('JsonlLogger — missing directory', () => {
  it('creates the base directory recursively on first write', async () => {
    const nestedBase = join(env.baseDir, 'does', 'not', 'exist', 'yet');
    const logger = new JsonlLogger({
      baseDir: nestedBase,
      level: 'info',
      clock: () => new Date('2026-05-16T12:00:00.000Z'),
    });

    logger.log('info', 'mcp_server', { hello: 'world' });

    const raw = await readFile(join(nestedBase, '2026-05-16.jsonl'), 'utf8');
    expect(readLines(raw)).toHaveLength(1);
  });
});
