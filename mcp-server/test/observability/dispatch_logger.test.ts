/**
 * Tests for the dispatch logger middleware.
 *
 * `DispatchLoggerMiddleware` wraps any `ChannelDispatcher` (typically
 * the `ChannelRouter`) and emits two JSONL lines per dispatch:
 *
 *   1. Before the dispatch — `{ts, level, component: "channel_router",
 *      trace_id, span_id, method, channel?, request_id?}`.
 *   2. After the dispatch — extends the before-line with `duration_ms`
 *      and `status: "ok" | "error"`. On error, `error_code` is added.
 *
 * The middleware also injects `trace: {trace_id, span_id}` into the
 * forwarded `params` so GDScript-side handlers can echo the trace
 * context into their own log lines.
 */

import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { JsonlLogger } from '../../src/observability/jsonl_logger.js';
import { DispatchLoggerMiddleware } from '../../src/observability/dispatch_logger.js';
import type {
    ChannelDispatcher,
    DispatchResult,
} from '../../src/stdio_bridge.js';

interface TestEnv {
    baseDir: string;
}

async function newEnv(): Promise<TestEnv> {
    const baseDir = await mkdtemp(join(tmpdir(), 'forgekit-dispatch-logger-'));
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
    // Per-test tmp dir; OS cleans up.
});

describe('DispatchLoggerMiddleware — happy path', () => {
    it('writes a before-line and after-line with status="ok" on success', async () => {
        const inner: ChannelDispatcher = {
            async dispatch(_method, _params): Promise<DispatchResult> {
                return { kind: 'ok', result: { hello: 'world' } };
            },
        };
        const logger = new JsonlLogger({
            baseDir: env.baseDir,
            level: 'debug',
            clock: () => new Date('2026-08-01T12:00:00.000Z'),
        });
        const middleware = new DispatchLoggerMiddleware(inner, {
            logger,
            now: () => 0,
        });

        const result = await middleware.dispatch('combat.spawn_enemy', {
            position: { x: 0, y: 0 },
        });
        expect(result.kind).toBe('ok');

        const raw = await readFile(join(env.baseDir, '2026-08-01.jsonl'), 'utf8');
        const lines = readLines(raw);
        expect(lines).toHaveLength(2);

        const before = lines[0]!;
        expect(before.component).toBe('channel_router');
        expect(before.method).toBe('combat.spawn_enemy');
        expect(before.trace_id).toMatch(/^[0-9a-f]{8}$/);
        expect(before.span_id).toMatch(/^[0-9a-f]{4}$/);
        expect(before.duration_ms).toBeUndefined();

        const after = lines[1]!;
        expect(after.method).toBe('combat.spawn_enemy');
        expect(after.trace_id).toBe(before.trace_id);
        expect(after.span_id).toBe(before.span_id);
        expect(after.duration_ms).toBeDefined();
        const data = after.data as Record<string, unknown>;
        expect(data.status).toBe('ok');
        expect(data.error_code).toBeUndefined();
    });

    it('writes status="error" with the JSON-RPC error_code on failure', async () => {
        const inner: ChannelDispatcher = {
            async dispatch(_method, _params): Promise<DispatchResult> {
                return {
                    kind: 'error',
                    code: -32601,
                    message: 'Method not found',
                };
            },
        };
        const logger = new JsonlLogger({
            baseDir: env.baseDir,
            level: 'debug',
            clock: () => new Date('2026-08-01T12:00:00.000Z'),
        });
        const middleware = new DispatchLoggerMiddleware(inner, {
            logger,
            now: () => 0,
        });

        await middleware.dispatch('does.not.exist', {});

        const raw = await readFile(join(env.baseDir, '2026-08-01.jsonl'), 'utf8');
        const [, after] = readLines(raw);
        const data = after!.data as Record<string, unknown>;
        expect(data.status).toBe('error');
        expect(data.error_code).toBe(-32601);
    });

    it('writes status="error" with channel_unavailable code on channel-unavailable result', async () => {
        const inner: ChannelDispatcher = {
            async dispatch(_method, _params): Promise<DispatchResult> {
                return { kind: 'channel-unavailable', channel: 'editor' };
            },
        };
        const logger = new JsonlLogger({
            baseDir: env.baseDir,
            level: 'debug',
            clock: () => new Date('2026-08-01T12:00:00.000Z'),
        });
        const middleware = new DispatchLoggerMiddleware(inner, {
            logger,
            now: () => 0,
        });

        await middleware.dispatch('scene.open', {});

        const raw = await readFile(join(env.baseDir, '2026-08-01.jsonl'), 'utf8');
        const [, after] = readLines(raw);
        const data = after!.data as Record<string, unknown>;
        expect(data.status).toBe('error');
        // -32000 is the JSON-RPC code stdio_bridge translates
        // channel-unavailable to.
        expect(data.error_code).toBe(-32000);
        expect(data.channel).toBe('editor');
    });
});

describe('DispatchLoggerMiddleware — trace context injection', () => {
    it('injects trace.{trace_id, span_id} into the forwarded params', async () => {
        let observedParams: unknown;
        const inner: ChannelDispatcher = {
            async dispatch(_method, params): Promise<DispatchResult> {
                observedParams = params;
                return { kind: 'ok', result: null };
            },
        };
        const logger = new JsonlLogger({
            baseDir: env.baseDir,
            level: 'debug',
            clock: () => new Date('2026-08-01T12:00:00.000Z'),
        });
        const middleware = new DispatchLoggerMiddleware(inner, { logger });

        await middleware.dispatch('inventory.add_item', { item_id: 'sword' });

        const params = observedParams as {
            item_id?: string;
            trace?: { trace_id?: string; span_id?: string };
        };
        expect(params.item_id).toBe('sword');
        expect(params.trace).toBeDefined();
        expect(params.trace?.trace_id).toMatch(/^[0-9a-f]{8}$/);
        expect(params.trace?.span_id).toMatch(/^[0-9a-f]{4}$/);
    });

    it('reuses an upstream trace_id when params.trace.trace_id is already set', async () => {
        let observedParams: unknown;
        const inner: ChannelDispatcher = {
            async dispatch(_method, params): Promise<DispatchResult> {
                observedParams = params;
                return { kind: 'ok', result: null };
            },
        };
        const logger = new JsonlLogger({
            baseDir: env.baseDir,
            level: 'debug',
            clock: () => new Date('2026-08-01T12:00:00.000Z'),
        });
        const middleware = new DispatchLoggerMiddleware(inner, { logger });

        await middleware.dispatch('project.info', {
            trace: { trace_id: 'aabbccdd', span_id: 'ffff' },
        });

        const params = observedParams as {
            trace?: { trace_id?: string; span_id?: string };
        };
        expect(params.trace?.trace_id).toBe('aabbccdd');
        // span_id is always re-minted per dispatch even when the trace
        // is inherited.
        expect(params.trace?.span_id).toMatch(/^[0-9a-f]{4}$/);
        expect(params.trace?.span_id).not.toBe('ffff');

        const raw = await readFile(join(env.baseDir, '2026-08-01.jsonl'), 'utf8');
        const [before] = readLines(raw);
        expect(before!.trace_id).toBe('aabbccdd');
    });

    it('keeps the after-line trace_id and span_id matching the before-line', async () => {
        const inner: ChannelDispatcher = {
            async dispatch(_method, _params): Promise<DispatchResult> {
                return { kind: 'ok', result: null };
            },
        };
        const logger = new JsonlLogger({
            baseDir: env.baseDir,
            level: 'debug',
            clock: () => new Date('2026-08-01T12:00:00.000Z'),
        });
        const middleware = new DispatchLoggerMiddleware(inner, { logger });

        await middleware.dispatch('scene.open', {});
        await middleware.dispatch('node.add', {});

        const raw = await readFile(join(env.baseDir, '2026-08-01.jsonl'), 'utf8');
        const lines = readLines(raw);
        expect(lines).toHaveLength(4);
        // Each pair (before, after) must share trace_id and span_id.
        expect(lines[0]!.trace_id).toBe(lines[1]!.trace_id);
        expect(lines[0]!.span_id).toBe(lines[1]!.span_id);
        expect(lines[2]!.trace_id).toBe(lines[3]!.trace_id);
        expect(lines[2]!.span_id).toBe(lines[3]!.span_id);
        // Different dispatches use different trace ids.
        expect(lines[0]!.trace_id).not.toBe(lines[2]!.trace_id);
    });
});

describe('DispatchLoggerMiddleware — duration measurement', () => {
    it('reports a non-negative duration_ms based on the injected clock', async () => {
        let nowCalls = 0;
        const inner: ChannelDispatcher = {
            async dispatch(_method, _params): Promise<DispatchResult> {
                return { kind: 'ok', result: null };
            },
        };
        const logger = new JsonlLogger({
            baseDir: env.baseDir,
            level: 'debug',
            clock: () => new Date('2026-08-01T12:00:00.000Z'),
        });
        const middleware = new DispatchLoggerMiddleware(inner, {
            logger,
            // First call (start) returns 0; second call (end) returns 12.
            now: () => (nowCalls++ === 0 ? 0 : 12),
        });

        await middleware.dispatch('test.method', {});

        const raw = await readFile(join(env.baseDir, '2026-08-01.jsonl'), 'utf8');
        const [, after] = readLines(raw);
        expect(after!.duration_ms).toBe(12);
    });
});

describe('DispatchLoggerMiddleware — params forwarding', () => {
    it('forwards non-object params untouched (e.g. arrays)', async () => {
        let observedParams: unknown;
        const inner: ChannelDispatcher = {
            async dispatch(_method, params): Promise<DispatchResult> {
                observedParams = params;
                return { kind: 'ok', result: null };
            },
        };
        const logger = new JsonlLogger({
            baseDir: env.baseDir,
            level: 'debug',
            clock: () => new Date('2026-08-01T12:00:00.000Z'),
        });
        const middleware = new DispatchLoggerMiddleware(inner, { logger });

        await middleware.dispatch('runtime.heartbeat', null);
        expect(observedParams).toBeNull();

        // The before-line should still log the trace context.
        const raw = await readFile(join(env.baseDir, '2026-08-01.jsonl'), 'utf8');
        const [before] = readLines(raw);
        expect(before!.trace_id).toMatch(/^[0-9a-f]{8}$/);
    });
});
