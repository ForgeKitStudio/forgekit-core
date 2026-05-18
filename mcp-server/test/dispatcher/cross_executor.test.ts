/**
 * Tests for the CrossExecutor — the dispatcher that handles tools
 * tagged `channel: "cross"` in `profiles.json`. The cross channel
 * orchestrates calls that touch both the editor and the runtime
 * bridge in a single MCP invocation, plus the transactional tools
 * that bracket multi-call sequences into a single Undo entry.
 *
 * The executor implements `CrossChannelExecutor` from
 * `src/dispatcher/channel_router.ts`, so the channel router can route
 * calls whose `channel` is `"cross"` to it.
 *
 * Coverage (task 8.6.4):
 *   - Full transaction round-trip:
 *       `transaction.begin` returns `{transaction_id}` after a single
 *       editor call; subsequent `transaction.commit` calls editor
 *       commit and a runtime ack and returns `{committed: true}`.
 *   - Rollback path:
 *       `transaction.rollback` calls editor rollback and returns
 *       `{rolled_back: true}`; the executor forgets the transaction
 *       so a fresh `transaction.begin` succeeds afterwards.
 *   - Auto-rollback on timeout:
 *       a transaction left open longer than `transactionTimeoutMs`
 *       auto-rolls back via the editor; further `commit`/`rollback`
 *       on the same id surface `-32004 TRANSACTION_TIMEOUT`.
 *   - Nested transactions:
 *       a second `transaction.begin` while another is open is
 *       rejected with `-32007 NESTED_TRANSACTION_NOT_ALLOWED` and
 *       does not call the editor.
 */

import { describe, expect, it, vi } from 'vitest';

import {
    CrossDispatchError,
    CrossExecutor,
} from '../../src/dispatcher/cross_executor.js';
import type {
    EditorChannelClient,
    RuntimeChannelClient,
} from '../../src/dispatcher/channel_router.js';

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

interface EditorMock extends EditorChannelClient {
    sendMock: ReturnType<typeof vi.fn>;
    isConnectedMock: ReturnType<typeof vi.fn>;
}

interface RuntimeMock extends RuntimeChannelClient {
    sendMock: ReturnType<typeof vi.fn>;
    isConnectedMock: ReturnType<typeof vi.fn>;
}

interface Harness {
    executor: CrossExecutor;
    editorClient: EditorMock;
    runtimeClient: RuntimeMock;
}

interface HarnessOptions {
    editorConnected?: boolean;
    runtimeConnected?: boolean;
    transactionTimeoutMs?: number;
    /** Custom editor.send implementation (per call). Wins over the default echo. */
    editorImpl?: (method: string, params: unknown) => Promise<unknown>;
    /** Custom runtime.send implementation (per call). */
    runtimeImpl?: (method: string, params: unknown) => Promise<unknown>;
}

let nextTxId = 100;

function defaultEditorImpl(method: string, _params: unknown): Promise<unknown> {
    if (method === 'transaction.begin') {
        return Promise.resolve({ transaction_id: nextTxId++ });
    }
    if (method === 'transaction.commit') {
        return Promise.resolve({ committed: true });
    }
    if (method === 'transaction.rollback') {
        return Promise.resolve({ rolled_back: true });
    }
    return Promise.resolve({ echo: method });
}

function defaultRuntimeImpl(_method: string, _params: unknown): Promise<unknown> {
    return Promise.resolve({ acknowledged: true });
}

function makeHarness(opts: HarnessOptions = {}): Harness {
    const editorImpl = opts.editorImpl ?? defaultEditorImpl;
    const runtimeImpl = opts.runtimeImpl ?? defaultRuntimeImpl;

    const editorSend = vi.fn(async (m: string, p: unknown) => editorImpl(m, p));
    const editorConnected = vi.fn(() => opts.editorConnected ?? true);
    const runtimeSend = vi.fn(async (m: string, p: unknown) => runtimeImpl(m, p));
    const runtimeConnected = vi.fn(() => opts.runtimeConnected ?? true);

    const editorClient: EditorMock = {
        send: editorSend,
        isConnected: editorConnected,
        sendMock: editorSend,
        isConnectedMock: editorConnected,
    };
    const runtimeClient: RuntimeMock = {
        send: runtimeSend,
        isConnected: runtimeConnected,
        sendMock: runtimeSend,
        isConnectedMock: runtimeConnected,
    };

    const executor = new CrossExecutor({
        editorClient,
        runtimeClient,
        ...(opts.transactionTimeoutMs === undefined
            ? {}
            : { transactionTimeoutMs: opts.transactionTimeoutMs }),
    });

    return { executor, editorClient, runtimeClient };
}

function asCrossError(value: unknown): CrossDispatchError {
    if (!(value instanceof CrossDispatchError)) {
        throw new Error(
            `expected CrossDispatchError, got ${value instanceof Error ? value.constructor.name : typeof value
            }`,
        );
    }
    return value;
}

// ---------------------------------------------------------------------------
// Full transaction round-trip
// ---------------------------------------------------------------------------

describe('CrossExecutor — full transaction round-trip', () => {
    it('calls editor.transaction.begin and returns the transaction_id', async () => {
        const h = makeHarness();
        const begin = (await h.executor.invoke('transaction.begin', {})) as {
            transaction_id: number;
        };

        expect(typeof begin.transaction_id).toBe('number');
        expect(h.editorClient.sendMock).toHaveBeenCalledTimes(1);
        expect(h.editorClient.sendMock).toHaveBeenCalledWith('transaction.begin', {});
        expect(h.runtimeClient.sendMock).not.toHaveBeenCalled();
    });

    it('commits via editor + runtime ack and returns {committed: true}', async () => {
        const h = makeHarness();
        const { transaction_id } = (await h.executor.invoke('transaction.begin', {})) as {
            transaction_id: number;
        };

        const commit = await h.executor.invoke('transaction.commit', { transaction_id });

        expect(commit).toEqual({ committed: true });
        // editor.send called twice: begin + commit.
        expect(h.editorClient.sendMock).toHaveBeenCalledTimes(2);
        expect(h.editorClient.sendMock).toHaveBeenLastCalledWith('transaction.commit', {
            transaction_id,
        });
        // runtime.send called once for the ack.
        expect(h.runtimeClient.sendMock).toHaveBeenCalledTimes(1);
        expect(h.runtimeClient.sendMock).toHaveBeenCalledWith('transaction.commit', {
            transaction_id,
        });
    });

    it('skips runtime ack when the runtime channel is not connected', async () => {
        const h = makeHarness({ runtimeConnected: false });
        const { transaction_id } = (await h.executor.invoke('transaction.begin', {})) as {
            transaction_id: number;
        };

        const commit = await h.executor.invoke('transaction.commit', { transaction_id });

        expect(commit).toEqual({ committed: true });
        expect(h.runtimeClient.sendMock).not.toHaveBeenCalled();
    });

    it('forgets the transaction after commit so a new one can begin', async () => {
        const h = makeHarness();
        const first = (await h.executor.invoke('transaction.begin', {})) as {
            transaction_id: number;
        };
        await h.executor.invoke('transaction.commit', { transaction_id: first.transaction_id });

        // A second begin MUST succeed once the first transaction has been
        // committed and removed from the registry.
        const second = (await h.executor.invoke('transaction.begin', {})) as {
            transaction_id: number;
        };
        expect(second.transaction_id).not.toBe(first.transaction_id);
    });
});

// ---------------------------------------------------------------------------
// Rollback path
// ---------------------------------------------------------------------------

describe('CrossExecutor — rollback', () => {
    it('calls editor.transaction.rollback and returns {rolled_back: true}', async () => {
        const h = makeHarness();
        const { transaction_id } = (await h.executor.invoke('transaction.begin', {})) as {
            transaction_id: number;
        };

        const rolled = await h.executor.invoke('transaction.rollback', { transaction_id });

        expect(rolled).toEqual({ rolled_back: true });
        expect(h.editorClient.sendMock).toHaveBeenCalledTimes(2);
        expect(h.editorClient.sendMock).toHaveBeenLastCalledWith('transaction.rollback', {
            transaction_id,
        });
        // Rollback does not need a runtime ack.
        expect(h.runtimeClient.sendMock).not.toHaveBeenCalled();
    });

    it('forgets the transaction after rollback so a new one can begin', async () => {
        const h = makeHarness();
        const first = (await h.executor.invoke('transaction.begin', {})) as {
            transaction_id: number;
        };
        await h.executor.invoke('transaction.rollback', { transaction_id: first.transaction_id });

        const second = (await h.executor.invoke('transaction.begin', {})) as {
            transaction_id: number;
        };
        expect(second.transaction_id).not.toBe(first.transaction_id);
    });

    it('rejects rollback for an unknown transaction id', async () => {
        const h = makeHarness();
        // No active transaction.
        try {
            await h.executor.invoke('transaction.rollback', { transaction_id: 9999 });
            throw new Error('expected CrossDispatchError');
        } catch (err) {
            const e = asCrossError(err);
            expect(e.code).toBe(-32602);
        }
        expect(h.editorClient.sendMock).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Timeout / auto-rollback
// ---------------------------------------------------------------------------

describe('CrossExecutor — transaction timeout', () => {
    it('auto-rolls back the editor transaction after the configured timeout', async () => {
        vi.useFakeTimers();
        try {
            const h = makeHarness({ transactionTimeoutMs: 1_000 });
            const { transaction_id } = (await h.executor.invoke(
                'transaction.begin',
                {},
            )) as { transaction_id: number };

            // Cross the timeout deadline.
            await vi.advanceTimersByTimeAsync(1_500);
            // Wait for any queued microtasks (the rollback fires via setTimeout).
            await Promise.resolve();
            await Promise.resolve();

            // Editor.send was called twice: begin + auto-rollback.
            expect(h.editorClient.sendMock).toHaveBeenCalledTimes(2);
            expect(h.editorClient.sendMock).toHaveBeenLastCalledWith('transaction.rollback', {
                transaction_id,
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it('rejects commit on a timed-out transaction with -32004 TRANSACTION_TIMEOUT', async () => {
        vi.useFakeTimers();
        try {
            const h = makeHarness({ transactionTimeoutMs: 1_000 });
            const { transaction_id } = (await h.executor.invoke(
                'transaction.begin',
                {},
            )) as { transaction_id: number };

            await vi.advanceTimersByTimeAsync(1_500);
            await Promise.resolve();
            await Promise.resolve();

            try {
                await h.executor.invoke('transaction.commit', { transaction_id });
                throw new Error('expected CrossDispatchError');
            } catch (err) {
                const e = asCrossError(err);
                expect(e.code).toBe(-32004);
                expect(e.message).toBe('TRANSACTION_TIMEOUT');
                const data = e.data as { transaction_id: number };
                expect(data.transaction_id).toBe(transaction_id);
            }
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not time out a transaction that has been committed in time', async () => {
        vi.useFakeTimers();
        try {
            const h = makeHarness({ transactionTimeoutMs: 1_000 });
            const { transaction_id } = (await h.executor.invoke(
                'transaction.begin',
                {},
            )) as { transaction_id: number };

            // Commit before the deadline.
            await h.executor.invoke('transaction.commit', { transaction_id });

            // Advance past the deadline; the timer must have been cancelled.
            await vi.advanceTimersByTimeAsync(2_000);
            await Promise.resolve();

            // Only begin + commit on the editor; no spurious rollback.
            expect(h.editorClient.sendMock).toHaveBeenCalledTimes(2);
            const calls = h.editorClient.sendMock.mock.calls.map((c) => c[0]);
            expect(calls).toEqual(['transaction.begin', 'transaction.commit']);
        } finally {
            vi.useRealTimers();
        }
    });
});

// ---------------------------------------------------------------------------
// Nested transactions
// ---------------------------------------------------------------------------

describe('CrossExecutor — nested transactions', () => {
    it('rejects a second transaction.begin with -32007 NESTED_TRANSACTION_NOT_ALLOWED', async () => {
        const h = makeHarness();
        await h.executor.invoke('transaction.begin', {});

        try {
            await h.executor.invoke('transaction.begin', {});
            throw new Error('expected CrossDispatchError');
        } catch (err) {
            const e = asCrossError(err);
            expect(e.code).toBe(-32007);
            expect(e.message).toBe('NESTED_TRANSACTION_NOT_ALLOWED');
        }

        // editor.send was called exactly once — the second begin must not
        // have reached the editor.
        expect(h.editorClient.sendMock).toHaveBeenCalledTimes(1);
    });

    it('allows a fresh begin after the previous transaction is rolled back', async () => {
        const h = makeHarness();
        const first = (await h.executor.invoke('transaction.begin', {})) as {
            transaction_id: number;
        };
        await h.executor.invoke('transaction.rollback', { transaction_id: first.transaction_id });

        // Now a fresh begin should succeed; no nested-transaction error.
        const second = (await h.executor.invoke('transaction.begin', {})) as {
            transaction_id: number;
        };
        expect(typeof second.transaction_id).toBe('number');
    });
});

// ---------------------------------------------------------------------------
// Method not found / unknown cross tools
// ---------------------------------------------------------------------------

describe('CrossExecutor — unknown methods', () => {
    it('returns -32601 Method not found for tools without a registered handler', async () => {
        const h = makeHarness();
        try {
            await h.executor.invoke('does.not.exist', {});
            throw new Error('expected CrossDispatchError');
        } catch (err) {
            const e = asCrossError(err);
            expect(e.code).toBe(-32601);
            expect(e.message).toBe('Method not found');
        }
        expect(h.editorClient.sendMock).not.toHaveBeenCalled();
        expect(h.runtimeClient.sendMock).not.toHaveBeenCalled();
    });
});
