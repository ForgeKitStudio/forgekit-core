/**
 * Tests for the ChannelRouter — the dispatcher that satisfies the
 * `ChannelDispatcher` interface consumed by `stdio_bridge.ts`.
 *
 * The router looks every JSON-RPC method up in `profiles.tools`, reads
 * the tool's `channel` attribute, and forwards the call to the matching
 * transport client:
 *
 *   - `editor`  → `editorClient.send(method, params)`
 *   - `runtime` → `runtimeClient.send(method, params)`
 *   - `cli`     → `cliExecutor.invoke(method, params)`
 *   - `cross`   → `crossExecutor.invoke(method, params)`
 *
 * Behaviour covered by the suite:
 *   - routing per channel only invokes the matching client
 *   - method-not-found maps to JSON-RPC -32601
 *   - editor/runtime clients reporting `isConnected() === false` map to
 *     the `channel-unavailable` discriminant that `stdio_bridge.ts`
 *     translates into `editor_channel_unavailable` /
 *     `runtime_channel_unavailable`
 *   - send/invoke timeouts map to JSON-RPC -32001 `channel_timeout`
 *     with `data: {channel, method, elapsed_ms}`
 *   - params are forwarded verbatim
 *   - the resolved value of send/invoke is unwrapped into
 *     `DispatchOk.result`
 */

import { describe, expect, it, vi } from 'vitest';

import type { ProfilesFile, ToolEntry } from '../../src/profiles.js';

import {
    ChannelRouter,
    type CliChannelExecutor,
    type CrossChannelExecutor,
    type EditorChannelClient,
    type RuntimeChannelClient,
} from '../../src/dispatcher/channel_router.js';

function buildProfiles(tools: ToolEntry[]): ProfilesFile {
    return { version: 'test', tools };
}

interface Harness {
    router: ChannelRouter;
    editorClient: EditorChannelClient & {
        sendMock: ReturnType<typeof vi.fn>;
        isConnectedMock: ReturnType<typeof vi.fn>;
    };
    runtimeClient: RuntimeChannelClient & {
        sendMock: ReturnType<typeof vi.fn>;
        isConnectedMock: ReturnType<typeof vi.fn>;
    };
    cliExecutor: CliChannelExecutor & { invokeMock: ReturnType<typeof vi.fn> };
    crossExecutor: CrossChannelExecutor & { invokeMock: ReturnType<typeof vi.fn> };
}

interface HarnessOptions {
    tools: ToolEntry[];
    timeoutMs?: number;
    editorConnected?: boolean;
    runtimeConnected?: boolean;
}

function makeHarness(opts: HarnessOptions): Harness {
    const editorSend = vi.fn(async (_m: string, _p: unknown) => 'editor-result');
    const editorConnected = vi.fn(() => opts.editorConnected ?? true);
    const runtimeSend = vi.fn(async (_m: string, _p: unknown) => 'runtime-result');
    const runtimeConnected = vi.fn(() => opts.runtimeConnected ?? true);
    const cliInvoke = vi.fn(async (_m: string, _p: unknown) => 'cli-result');
    const crossInvoke = vi.fn(async (_m: string, _p: unknown) => 'cross-result');

    const editorClient = {
        send: editorSend,
        isConnected: editorConnected,
        sendMock: editorSend,
        isConnectedMock: editorConnected,
    };
    const runtimeClient = {
        send: runtimeSend,
        isConnected: runtimeConnected,
        sendMock: runtimeSend,
        isConnectedMock: runtimeConnected,
    };
    const cliExecutor = { invoke: cliInvoke, invokeMock: cliInvoke };
    const crossExecutor = { invoke: crossInvoke, invokeMock: crossInvoke };

    const router = new ChannelRouter({
        profiles: buildProfiles(opts.tools),
        editorClient,
        runtimeClient,
        cliExecutor,
        crossExecutor,
        ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
    });

    return { router, editorClient, runtimeClient, cliExecutor, crossExecutor };
}

const EDITOR_TOOL: ToolEntry = {
    name: 'scene.open',
    scope: 'core',
    channel: 'editor',
    module: 'core-minimal',
};
const RUNTIME_TOOL: ToolEntry = {
    name: 'inventory.add_item',
    scope: 'module',
    channel: 'runtime',
    module: 'inventory',
};
const CLI_TOOL: ToolEntry = {
    name: 'tests.run_unit',
    scope: 'core',
    channel: 'cli',
    module: 'core',
};
const CROSS_TOOL: ToolEntry = {
    name: 'modules.activate_license',
    scope: 'core',
    channel: 'cross',
    module: 'core',
};

describe('ChannelRouter — routing per channel', () => {
    it('routes editor-channel methods to editorClient.send only', async () => {
        const h = makeHarness({ tools: [EDITOR_TOOL, RUNTIME_TOOL, CLI_TOOL, CROSS_TOOL] });
        const result = await h.router.dispatch('scene.open', { path: 'a.tscn' });

        expect(result).toEqual({ kind: 'ok', result: 'editor-result' });
        expect(h.editorClient.sendMock).toHaveBeenCalledTimes(1);
        expect(h.editorClient.sendMock).toHaveBeenCalledWith('scene.open', { path: 'a.tscn' });
        expect(h.runtimeClient.sendMock).not.toHaveBeenCalled();
        expect(h.cliExecutor.invokeMock).not.toHaveBeenCalled();
        expect(h.crossExecutor.invokeMock).not.toHaveBeenCalled();
    });

    it('routes runtime-channel methods to runtimeClient.send only', async () => {
        const h = makeHarness({ tools: [EDITOR_TOOL, RUNTIME_TOOL, CLI_TOOL, CROSS_TOOL] });
        const result = await h.router.dispatch('inventory.add_item', {
            item_id: 'sword',
            amount: 1,
        });

        expect(result).toEqual({ kind: 'ok', result: 'runtime-result' });
        expect(h.runtimeClient.sendMock).toHaveBeenCalledTimes(1);
        expect(h.runtimeClient.sendMock).toHaveBeenCalledWith('inventory.add_item', {
            item_id: 'sword',
            amount: 1,
        });
        expect(h.editorClient.sendMock).not.toHaveBeenCalled();
        expect(h.cliExecutor.invokeMock).not.toHaveBeenCalled();
        expect(h.crossExecutor.invokeMock).not.toHaveBeenCalled();
    });

    it('routes cli-channel methods to cliExecutor.invoke only', async () => {
        const h = makeHarness({ tools: [EDITOR_TOOL, RUNTIME_TOOL, CLI_TOOL, CROSS_TOOL] });
        const result = await h.router.dispatch('tests.run_unit', { suite: 'all' });

        expect(result).toEqual({ kind: 'ok', result: 'cli-result' });
        expect(h.cliExecutor.invokeMock).toHaveBeenCalledTimes(1);
        expect(h.cliExecutor.invokeMock).toHaveBeenCalledWith('tests.run_unit', { suite: 'all' });
        expect(h.editorClient.sendMock).not.toHaveBeenCalled();
        expect(h.runtimeClient.sendMock).not.toHaveBeenCalled();
        expect(h.crossExecutor.invokeMock).not.toHaveBeenCalled();
    });

    it('routes cross-channel methods to crossExecutor.invoke only', async () => {
        const h = makeHarness({ tools: [EDITOR_TOOL, RUNTIME_TOOL, CLI_TOOL, CROSS_TOOL] });
        const result = await h.router.dispatch('modules.activate_license', { key: 'abc' });

        expect(result).toEqual({ kind: 'ok', result: 'cross-result' });
        expect(h.crossExecutor.invokeMock).toHaveBeenCalledTimes(1);
        expect(h.crossExecutor.invokeMock).toHaveBeenCalledWith('modules.activate_license', {
            key: 'abc',
        });
        expect(h.editorClient.sendMock).not.toHaveBeenCalled();
        expect(h.runtimeClient.sendMock).not.toHaveBeenCalled();
        expect(h.cliExecutor.invokeMock).not.toHaveBeenCalled();
    });
});

describe('ChannelRouter — method not found', () => {
    it('returns DispatchError -32601 when the method is not declared in profiles.tools', async () => {
        const h = makeHarness({ tools: [EDITOR_TOOL] });
        const result = await h.router.dispatch('does.not.exist', {});

        expect(result).toEqual({
            kind: 'error',
            code: -32601,
            message: 'Method not found',
            data: { method: 'does.not.exist' },
        });
        expect(h.editorClient.sendMock).not.toHaveBeenCalled();
        expect(h.runtimeClient.sendMock).not.toHaveBeenCalled();
        expect(h.cliExecutor.invokeMock).not.toHaveBeenCalled();
        expect(h.crossExecutor.invokeMock).not.toHaveBeenCalled();
    });
});

describe('ChannelRouter — channel unavailable', () => {
    it('returns channel-unavailable for editor when editorClient.isConnected() is false', async () => {
        const h = makeHarness({ tools: [EDITOR_TOOL], editorConnected: false });
        const result = await h.router.dispatch('scene.open', { path: 'a.tscn' });

        expect(result).toEqual({ kind: 'channel-unavailable', channel: 'editor' });
        expect(h.editorClient.sendMock).not.toHaveBeenCalled();
    });

    it('returns channel-unavailable for runtime when runtimeClient.isConnected() is false', async () => {
        const h = makeHarness({ tools: [RUNTIME_TOOL], runtimeConnected: false });
        const result = await h.router.dispatch('inventory.add_item', {});

        expect(result).toEqual({ kind: 'channel-unavailable', channel: 'runtime' });
        expect(h.runtimeClient.sendMock).not.toHaveBeenCalled();
    });
});

describe('ChannelRouter — timeouts', () => {
    it('returns DispatchError -32001 channel_timeout when send exceeds timeoutMs', async () => {
        vi.useFakeTimers();
        try {
            const h = makeHarness({ tools: [EDITOR_TOOL], timeoutMs: 100 });
            // editorClient.send never resolves to force the timeout path.
            h.editorClient.sendMock.mockImplementation(() => new Promise(() => { }));

            const dispatched = h.router.dispatch('scene.open', { path: 'a.tscn' });
            await vi.advanceTimersByTimeAsync(150);
            const result = await dispatched;

            expect(result.kind).toBe('error');
            const err = result as { kind: 'error'; code: number; message: string; data: unknown };
            expect(err.code).toBe(-32001);
            expect(err.message).toBe('channel_timeout');
            const data = err.data as { channel: string; method: string; elapsed_ms: number };
            expect(data.channel).toBe('editor');
            expect(data.method).toBe('scene.open');
            expect(data.elapsed_ms).toBeGreaterThanOrEqual(100);
        } finally {
            vi.useRealTimers();
        }
    });

    it('uses the default 30000 ms timeout when none is configured', async () => {
        vi.useFakeTimers();
        try {
            const h = makeHarness({ tools: [EDITOR_TOOL] });
            h.editorClient.sendMock.mockImplementation(() => new Promise(() => { }));

            const dispatched = h.router.dispatch('scene.open', {});
            // Just before the deadline the call must still be pending.
            await vi.advanceTimersByTimeAsync(29_000);
            let settled = false;
            void dispatched.then(() => {
                settled = true;
            });
            await Promise.resolve();
            expect(settled).toBe(false);

            // Cross the 30s deadline; the router must now report the timeout.
            await vi.advanceTimersByTimeAsync(2_000);
            const result = await dispatched;
            expect(result.kind).toBe('error');
            const err = result as { kind: 'error'; code: number; message: string; data: unknown };
            expect(err.code).toBe(-32001);
            expect(err.message).toBe('channel_timeout');
            const data = err.data as { elapsed_ms: number };
            expect(data.elapsed_ms).toBeGreaterThanOrEqual(30_000);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('ChannelRouter — params pass-through and response unwrapping', () => {
    it('forwards params verbatim, including null and complex shapes', async () => {
        const h = makeHarness({ tools: [EDITOR_TOOL, RUNTIME_TOOL, CLI_TOOL, CROSS_TOOL] });

        await h.router.dispatch('scene.open', null);
        expect(h.editorClient.sendMock).toHaveBeenLastCalledWith('scene.open', null);

        const complex = { nested: { list: [1, 'two', { three: true }] }, flag: false };
        await h.router.dispatch('inventory.add_item', complex);
        expect(h.runtimeClient.sendMock).toHaveBeenLastCalledWith('inventory.add_item', complex);

        await h.router.dispatch('tests.run_unit', undefined);
        expect(h.cliExecutor.invokeMock).toHaveBeenLastCalledWith('tests.run_unit', undefined);

        const arrParams = ['a', 'b'];
        await h.router.dispatch('modules.activate_license', arrParams);
        expect(h.crossExecutor.invokeMock).toHaveBeenLastCalledWith(
            'modules.activate_license',
            arrParams,
        );
    });

    it('unwraps the resolved value into DispatchOk.result without modification', async () => {
        const h = makeHarness({ tools: [EDITOR_TOOL] });
        const payload = { ok: true, items: [1, 2, 3] };
        h.editorClient.sendMock.mockResolvedValueOnce(payload);

        const result = await h.router.dispatch('scene.open', {});
        expect(result).toEqual({ kind: 'ok', result: payload });
        const ok = result as { kind: 'ok'; result: unknown };
        expect(ok.result).toBe(payload);
    });

    it('also unwraps falsy and null payloads correctly', async () => {
        const h = makeHarness({ tools: [EDITOR_TOOL] });

        h.editorClient.sendMock.mockResolvedValueOnce(null);
        expect(await h.router.dispatch('scene.open', {})).toEqual({ kind: 'ok', result: null });

        h.editorClient.sendMock.mockResolvedValueOnce(0);
        expect(await h.router.dispatch('scene.open', {})).toEqual({ kind: 'ok', result: 0 });

        h.editorClient.sendMock.mockResolvedValueOnce('');
        expect(await h.router.dispatch('scene.open', {})).toEqual({ kind: 'ok', result: '' });
    });
});
