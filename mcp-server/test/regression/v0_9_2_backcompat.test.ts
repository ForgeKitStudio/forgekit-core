/**
 * Backwards compatibility regression test for pre-v0.10 JSON-RPC
 * clients.
 *
 * The v0.10 transport activation milestone introduced two payload
 * additions that older clients (anything published as v0.9.2 or
 * earlier) did not send:
 *
 *   1. The optional `trace: {trace_id, span_id}` field that the
 *      `DispatchLoggerMiddleware` injects for cross-language log
 *      correlation. Pre-v0.10 clients omit it entirely.
 *   2. The optional `auth_token` field on the runtime handshake.
 *      Pre-v0.10 clients running in dev mode (no `auth_token` set in
 *      `plugin_config.tres` / `runtime_config.tres`) send no token.
 *
 * The contract for v0.10 is additive: pre-v0.10 payloads must keep
 * working unchanged. This file pins that contract so a future change
 * to the dispatcher, observability middleware, or the auth gate cannot
 * silently break old clients.
 *
 * Validates: Requirements 17.4, 73.1, 73.2.
 */

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    UNAUTHORIZED_CODE,
    UNAUTHORIZED_MESSAGE,
    verifyAuthToken,
} from '../../src/auth_verifier.js';
import {
    ChannelRouter,
    type CliChannelExecutor,
    type CrossChannelExecutor,
    type EditorChannelClient,
    type RuntimeChannelClient,
} from '../../src/dispatcher/channel_router.js';
import { DispatchLoggerMiddleware } from '../../src/observability/dispatch_logger.js';
import { JsonlLogger } from '../../src/observability/jsonl_logger.js';
import type {
    ChannelDispatcher,
    DispatchResult,
} from '../../src/stdio_bridge.js';
import type { ProfilesFile, ToolEntry } from '../../src/profiles.js';

// ---------------------------------------------------------------------------
// Pre-v0.10 fixtures — exactly the shapes a v0.9.2 client used to send.
// ---------------------------------------------------------------------------

/**
 * The four canonical channel tools used to exercise the router in the
 * same shape v0.9.2 declared them in `profiles.json`.
 */
const PRE_V0_10_TOOLS: ToolEntry[] = [
    { name: 'scene.open', scope: 'core', channel: 'editor', module: 'core-minimal' },
    { name: 'inventory.add_item', scope: 'module', channel: 'runtime', module: 'inventory' },
    { name: 'crafting.validate_recipe', scope: 'module', channel: 'cli', module: 'crafting' },
    { name: 'runtime.handshake', scope: 'core', channel: 'cross', module: 'core' },
];

/** A pre-v0.10 JSON-RPC request body (no `trace` field). */
interface PreV010Request {
    readonly jsonrpc: '2.0';
    readonly id: number;
    readonly method: string;
    readonly params: Record<string, unknown>;
}

function buildProfiles(tools: ToolEntry[]): ProfilesFile {
    return { version: 'test', tools };
}

interface CapturedCall {
    method: string;
    params: unknown;
}

interface RouterHarness {
    router: ChannelRouter;
    captured: {
        editor: CapturedCall[];
        runtime: CapturedCall[];
        cli: CapturedCall[];
        cross: CapturedCall[];
    };
}

function makeRouterHarness(tools: ToolEntry[]): RouterHarness {
    const captured = {
        editor: [] as CapturedCall[],
        runtime: [] as CapturedCall[],
        cli: [] as CapturedCall[],
        cross: [] as CapturedCall[],
    };

    const editorClient: EditorChannelClient = {
        async send(method, params) {
            captured.editor.push({ method, params });
            return { ok: true, channel: 'editor' };
        },
        isConnected: () => true,
    };
    const runtimeClient: RuntimeChannelClient = {
        async send(method, params) {
            captured.runtime.push({ method, params });
            return { ok: true, channel: 'runtime' };
        },
        isConnected: () => true,
    };
    const cliExecutor: CliChannelExecutor = {
        async invoke(method, params) {
            captured.cli.push({ method, params });
            return { ok: true, channel: 'cli' };
        },
    };
    const crossExecutor: CrossChannelExecutor = {
        async invoke(method, params) {
            captured.cross.push({ method, params });
            return { ok: true, channel: 'cross' };
        },
    };

    const router = new ChannelRouter({
        profiles: buildProfiles(tools),
        editorClient,
        runtimeClient,
        cliExecutor,
        crossExecutor,
    });

    return { router, captured };
}

// ---------------------------------------------------------------------------
// Section 1 — `trace` is optional on the wire.
// ---------------------------------------------------------------------------

describe('pre-v0.10 JSON-RPC envelope without `trace`', () => {
    it('the channel router accepts params with no `trace` field on every channel', async () => {
        const h = makeRouterHarness(PRE_V0_10_TOOLS);

        const editorReq: PreV010Request = {
            jsonrpc: '2.0',
            id: 1,
            method: 'scene.open',
            params: { path: 'res://main.tscn' },
        };
        const runtimeReq: PreV010Request = {
            jsonrpc: '2.0',
            id: 2,
            method: 'inventory.add_item',
            params: { item_id: 'sword', amount: 1 },
        };
        const cliReq: PreV010Request = {
            jsonrpc: '2.0',
            id: 3,
            method: 'crafting.validate_recipe',
            params: { recipe_id: 'iron_sword' },
        };
        const crossReq: PreV010Request = {
            jsonrpc: '2.0',
            id: 4,
            method: 'runtime.handshake',
            params: { client_id: 'pre-v0.10-client' },
        };

        const results = await Promise.all([
            h.router.dispatch(editorReq.method, editorReq.params),
            h.router.dispatch(runtimeReq.method, runtimeReq.params),
            h.router.dispatch(cliReq.method, cliReq.params),
            h.router.dispatch(crossReq.method, crossReq.params),
        ]);

        for (const r of results) {
            expect(r.kind).toBe('ok');
        }

        // The router itself must not fabricate a `trace` field — params
        // are forwarded verbatim. The dispatch logger middleware is the
        // component that adds tracing, and it lives one layer above the
        // router (see test below).
        expect(h.captured.editor).toEqual([
            { method: 'scene.open', params: { path: 'res://main.tscn' } },
        ]);
        expect(h.captured.runtime).toEqual([
            { method: 'inventory.add_item', params: { item_id: 'sword', amount: 1 } },
        ]);
        expect(h.captured.cli).toEqual([
            { method: 'crafting.validate_recipe', params: { recipe_id: 'iron_sword' } },
        ]);
        expect(h.captured.cross).toEqual([
            { method: 'runtime.handshake', params: { client_id: 'pre-v0.10-client' } },
        ]);
    });

    it('the dispatch logger middleware mints a fresh trace context for legacy params', async () => {
        const baseDir = await mkdtemp(join(tmpdir(), 'forgekit-backcompat-'));

        let observedParams: unknown = '__not_called__';
        const inner: ChannelDispatcher = {
            async dispatch(_method, params): Promise<DispatchResult> {
                observedParams = params;
                return { kind: 'ok', result: { ok: true } };
            },
        };
        const logger = new JsonlLogger({
            baseDir,
            level: 'debug',
            clock: () => new Date('2026-08-01T12:00:00.000Z'),
        });
        const middleware = new DispatchLoggerMiddleware(inner, {
            logger,
            now: () => 0,
        });

        // Pre-v0.10 params: no `trace` field anywhere.
        const legacyParams = { item_id: 'potion', amount: 2 };
        const result = await middleware.dispatch('inventory.add_item', legacyParams);
        expect(result).toEqual({ kind: 'ok', result: { ok: true } });

        // Middleware must inject `trace` so the inner dispatcher always
        // sees a valid context, but the outer caller's object is never
        // mutated.
        expect(legacyParams).toEqual({ item_id: 'potion', amount: 2 });
        expect(observedParams).toMatchObject({
            item_id: 'potion',
            amount: 2,
            trace: {
                trace_id: expect.stringMatching(/^[0-9a-f]{8}$/),
                span_id: expect.stringMatching(/^[0-9a-f]{4}$/),
            },
        });
    });

    it('non-object pre-v0.10 params (null, array) flow through the middleware untouched', async () => {
        const baseDir = await mkdtemp(join(tmpdir(), 'forgekit-backcompat-'));
        const seen: unknown[] = [];
        const inner: ChannelDispatcher = {
            async dispatch(_method, params): Promise<DispatchResult> {
                seen.push(params);
                return { kind: 'ok', result: null };
            },
        };
        const middleware = new DispatchLoggerMiddleware(inner, {
            logger: new JsonlLogger({
                baseDir,
                level: 'debug',
                clock: () => new Date('2026-08-01T12:00:00.000Z'),
            }),
            now: () => 0,
        });

        await middleware.dispatch('runtime.heartbeat', null);
        await middleware.dispatch('input.list_actions', undefined);
        await middleware.dispatch('export.list_presets', ['preset_a', 'preset_b']);

        // Non-object params must not be wrapped in a synthetic trace
        // object — that would break v0.9.2 clients that rely on the
        // exact shape they sent.
        expect(seen).toEqual([null, undefined, ['preset_a', 'preset_b']]);
    });
});

// ---------------------------------------------------------------------------
// Section 2 — `auth_token` is optional in dev mode.
// ---------------------------------------------------------------------------

describe('pre-v0.10 JSON-RPC envelope without `auth_token` in dev mode', () => {
    it('verifyAuthToken accepts an empty request token when no token is configured', () => {
        // Dev mode: server config has empty `auth_token`, so the gate's
        // configured token is the empty string. A pre-v0.10 client that
        // omits `auth_token` from its handshake reaches the gate with
        // an empty `requestToken`.
        const result = verifyAuthToken({
            requestToken: '',
            configuredToken: '',
        });
        expect(result).toEqual({ ok: true, closeConnection: false });
    });

    it('verifyAuthToken still rejects when only one side has a token (server-side enforcement)', () => {
        // Sanity check that dev mode is the *only* exemption. A
        // pre-v0.10 client sending no token against a server that does
        // configure one must still be rejected with -32000 UNAUTHORIZED
        // so the operator notices the mismatch.
        const result = verifyAuthToken({
            requestToken: '',
            configuredToken: 'forgekit-dev-token',
        });
        expect(result.ok).toBe(false);
        if (result.ok) {
            return;
        }
        expect(result.closeConnection).toBe(true);
        expect(result.error.code).toBe(UNAUTHORIZED_CODE);
        expect(result.error.message).toBe(UNAUTHORIZED_MESSAGE);
        expect(typeof result.error.data.suggestion).toBe('string');
        expect(result.error.data.suggestion.length).toBeGreaterThan(0);
    });

    it('a complete pre-v0.10 dev-mode handshake survives the dispatcher pipeline end-to-end', async () => {
        const baseDir = await mkdtemp(join(tmpdir(), 'forgekit-backcompat-'));

        // Simulate the cross-channel handshake the way v0.9.2 sent it:
        // no `auth_token` in params, no `trace` field.
        const handshakePayload = { client_id: 'pre-v0.10-client' };

        const h = makeRouterHarness(PRE_V0_10_TOOLS);
        const middleware = new DispatchLoggerMiddleware(h.router, {
            logger: new JsonlLogger({
                baseDir,
                level: 'debug',
                clock: () => new Date('2026-08-01T12:00:00.000Z'),
            }),
            now: () => 0,
        });

        // Step 1: the auth gate — dev mode means configuredToken is ''
        // and the request also carries '' (because the field is absent).
        const requestToken =
            typeof (handshakePayload as { auth_token?: string }).auth_token === 'string'
                ? (handshakePayload as { auth_token: string }).auth_token
                : '';
        const gate = verifyAuthToken({
            requestToken,
            configuredToken: '',
        });
        expect(gate).toEqual({ ok: true, closeConnection: false });

        // Step 2: dispatch through the full middleware stack with the
        // exact pre-v0.10 envelope.
        const result = await middleware.dispatch('runtime.handshake', handshakePayload);
        expect(result.kind).toBe('ok');

        // Step 3: the cross-channel executor saw the legacy payload
        // augmented only with the synthesized `trace` context (added
        // by the middleware, never by the original client).
        expect(h.captured.cross).toHaveLength(1);
        const observed = h.captured.cross[0]!;
        expect(observed.method).toBe('runtime.handshake');
        expect(observed.params).toMatchObject({
            client_id: 'pre-v0.10-client',
            trace: {
                trace_id: expect.stringMatching(/^[0-9a-f]{8}$/),
                span_id: expect.stringMatching(/^[0-9a-f]{4}$/),
            },
        });
        // Original fields are preserved verbatim.
        expect((observed.params as Record<string, unknown>).client_id).toBe(
            'pre-v0.10-client',
        );
    });
});
