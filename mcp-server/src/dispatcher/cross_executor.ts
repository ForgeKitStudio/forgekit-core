/**
 * Cross-channel executor — `CrossChannelExecutor` implementation for
 * the channel router (see `channel_router.ts`).
 *
 * The cross channel covers tools whose semantics span both transports:
 * the editor (WebSocket) and the runtime bridge (UDP). The current
 * surface is the transactional triple — `transaction.begin`,
 * `transaction.commit`, `transaction.rollback` — which gates batch
 * mutations into a single Undo entry on the editor side and informs
 * the runtime bridge so its observers can react in lock step.
 *
 * Orchestration rules:
 *   - `transaction.begin`
 *       Forwarded to the editor only. The editor returns
 *       `{transaction_id}`. The executor records the transaction in
 *       its in-memory registry along with the wall-clock start time.
 *       A second `begin` while another transaction is open is rejected
 *       locally with `-32007 NESTED_TRANSACTION_NOT_ALLOWED`.
 *   - `transaction.commit`
 *       Routed to both the editor and the runtime bridge: the editor
 *       commits the Undo action and the runtime bridge receives a
 *       best-effort ack so observers (visualizer, gameplay tests) can
 *       observe the commit boundary. The runtime ack is skipped when
 *       the runtime channel reports `isConnected() === false` so the
 *       transaction can still be closed when the game is not running.
 *   - `transaction.rollback`
 *       Routed to the editor only. The runtime bridge does not need an
 *       ack on rollback because the corresponding mutations never
 *       reached it.
 *
 * Failure modes:
 *   - `commit` / `rollback` on an unknown transaction_id raises
 *     `-32602 Invalid params` (the editor would otherwise produce
 *     `TRANSACTION_NOT_OPEN`, but rejecting locally avoids a useless
 *     IPC round-trip).
 *   - A transaction that has been open for longer than
 *     `transactionTimeoutMs` (default: 5 minutes) is auto-rolled back
 *     by issuing `transaction.rollback` to the editor on the
 *     timeout's behalf. Subsequent `commit` / `rollback` on the same
 *     id raise `-32004 TRANSACTION_TIMEOUT`. The transaction id is
 *     parked in a "dead" set so the timeout error can be surfaced
 *     once before the id is forgotten.
 *   - Unknown cross-channel methods raise `-32601 Method not found`.
 */

import type {
    CrossChannelExecutor,
    EditorChannelClient,
    RuntimeChannelClient,
} from './channel_router.js';

/** JSON-RPC error envelope thrown by `CrossExecutor.invoke`. */
export class CrossDispatchError extends Error {
    readonly code: number;
    readonly data?: unknown;

    constructor(code: number, message: string, data?: unknown) {
        super(message);
        this.name = 'CrossDispatchError';
        this.code = code;
        if (data !== undefined) {
            this.data = data;
        }
    }
}

/** JSON-RPC `Method not found`. */
const METHOD_NOT_FOUND = -32601;
/** JSON-RPC `Invalid params`. */
const INVALID_PARAMS = -32602;
/** Custom: transaction expired before commit/rollback. */
const TRANSACTION_TIMEOUT = -32004;
/** Custom: nested transaction.begin while another transaction is open. */
const NESTED_TRANSACTION_NOT_ALLOWED = -32007;

/** Default transaction lifetime: 5 minutes. */
const DEFAULT_TRANSACTION_TIMEOUT_MS = 5 * 60 * 1_000;

interface TransactionState {
    readonly transactionId: number;
    /** Wall-clock millisecond timestamp when `begin` was acknowledged. */
    readonly startedAt: number;
    /** Handle of the auto-rollback timer scheduled at `begin`. */
    readonly timer: ReturnType<typeof setTimeout>;
}

export interface CrossExecutorOptions {
    readonly editorClient: EditorChannelClient;
    readonly runtimeClient: RuntimeChannelClient;
    /**
     * Maximum lifetime of an open transaction. Transactions left open
     * past this deadline are auto-rolled back on the editor and
     * subsequent commit / rollback calls on the same id raise
     * `-32004 TRANSACTION_TIMEOUT`.
     *
     * Defaults to five minutes.
     */
    readonly transactionTimeoutMs?: number;
}

/**
 * In-memory cross-channel orchestrator. The router routes every
 * `channel === "cross"` method to `invoke(method, params)`.
 */
export class CrossExecutor implements CrossChannelExecutor {
    private readonly editorClient: EditorChannelClient;
    private readonly runtimeClient: RuntimeChannelClient;
    private readonly transactionTimeoutMs: number;
    /** Active transactions keyed by the editor-issued transaction_id. */
    private readonly active: Map<number, TransactionState>;
    /**
     * Transaction ids that have been auto-rolled back due to timeout.
     * Kept around so the next `commit` / `rollback` on the same id
     * receives `-32004 TRANSACTION_TIMEOUT` instead of a generic
     * "unknown transaction" error.
     */
    private readonly timedOut: Set<number>;
    /** True iff there is a non-timed-out transaction in `active`. */
    private hasOpenTransaction: boolean;

    constructor(options: CrossExecutorOptions) {
        this.editorClient = options.editorClient;
        this.runtimeClient = options.runtimeClient;
        this.transactionTimeoutMs =
            options.transactionTimeoutMs ?? DEFAULT_TRANSACTION_TIMEOUT_MS;
        this.active = new Map();
        this.timedOut = new Set();
        this.hasOpenTransaction = false;
    }

    /**
     * Executes the cross-channel handler for `method`. Throws
     * `CrossDispatchError` with an appropriate JSON-RPC code on any
     * failure — never raises an unmapped error.
     */
    async invoke(method: string, params: unknown): Promise<unknown> {
        switch (method) {
            case 'transaction.begin':
                return this.handleBegin(params);
            case 'transaction.commit':
                return this.handleCommit(params);
            case 'transaction.rollback':
                return this.handleRollback(params);
            default:
                throw new CrossDispatchError(METHOD_NOT_FOUND, 'Method not found', {
                    method,
                });
        }
    }

    // -------------------------------------------------------------------
    // transaction.begin
    // -------------------------------------------------------------------

    private async handleBegin(params: unknown): Promise<{ transaction_id: number }> {
        if (this.hasOpenTransaction) {
            throw new CrossDispatchError(
                NESTED_TRANSACTION_NOT_ALLOWED,
                'NESTED_TRANSACTION_NOT_ALLOWED',
            );
        }

        const reply = await this.editorClient.send('transaction.begin', params);
        const transactionId = extractTransactionId(reply);
        if (transactionId === undefined) {
            // The editor reply is malformed; surface the upstream payload
            // verbatim so the caller can diagnose.
            throw new CrossDispatchError(
                INVALID_PARAMS,
                'transaction.begin reply missing transaction_id',
                { reply },
            );
        }

        const timer = setTimeout(() => {
            void this.autoRollback(transactionId);
        }, this.transactionTimeoutMs);
        // Allow the Node process to exit naturally even when a
        // transaction timer is pending — the timer is best-effort.
        if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
            (timer as { unref: () => void }).unref();
        }

        this.active.set(transactionId, {
            transactionId,
            startedAt: Date.now(),
            timer,
        });
        this.hasOpenTransaction = true;

        return { transaction_id: transactionId };
    }

    // -------------------------------------------------------------------
    // transaction.commit
    // -------------------------------------------------------------------

    private async handleCommit(params: unknown): Promise<unknown> {
        const transactionId = readTransactionIdParam(params);
        this.checkTimedOut(transactionId);

        const state = this.active.get(transactionId);
        if (state === undefined) {
            throw new CrossDispatchError(INVALID_PARAMS, 'unknown transaction_id', {
                transaction_id: transactionId,
            });
        }

        // Cancel the auto-rollback timer; the transaction is closing
        // normally now.
        clearTimeout(state.timer);
        this.active.delete(transactionId);
        this.hasOpenTransaction = false;

        const editorReply = await this.editorClient.send('transaction.commit', {
            transaction_id: transactionId,
        });

        // Best-effort runtime ack. We swallow the result on purpose: the
        // commit succeeds as soon as the editor confirms it, and the
        // runtime bridge is only being notified so observers can react.
        if (this.runtimeClient.isConnected()) {
            try {
                await this.runtimeClient.send('transaction.commit', {
                    transaction_id: transactionId,
                });
            } catch {
                // Intentionally ignored — runtime observers are advisory.
            }
        }

        return editorReply ?? { committed: true };
    }

    // -------------------------------------------------------------------
    // transaction.rollback
    // -------------------------------------------------------------------

    private async handleRollback(params: unknown): Promise<unknown> {
        const transactionId = readTransactionIdParam(params);
        this.checkTimedOut(transactionId);

        const state = this.active.get(transactionId);
        if (state === undefined) {
            throw new CrossDispatchError(INVALID_PARAMS, 'unknown transaction_id', {
                transaction_id: transactionId,
            });
        }

        clearTimeout(state.timer);
        this.active.delete(transactionId);
        this.hasOpenTransaction = false;

        const editorReply = await this.editorClient.send('transaction.rollback', {
            transaction_id: transactionId,
        });

        return editorReply ?? { rolled_back: true };
    }

    // -------------------------------------------------------------------
    // Internals
    // -------------------------------------------------------------------

    /**
     * Fired by the per-transaction timer when the deadline is crossed
     * without commit / rollback. Issues an editor-side rollback and
     * marks the id as timed-out so the next API call surfaces
     * `-32004 TRANSACTION_TIMEOUT`.
     */
    private async autoRollback(transactionId: number): Promise<void> {
        const state = this.active.get(transactionId);
        if (state === undefined) {
            // The transaction was already closed by the user.
            return;
        }
        this.active.delete(transactionId);
        this.hasOpenTransaction = false;
        this.timedOut.add(transactionId);

        try {
            await this.editorClient.send('transaction.rollback', {
                transaction_id: transactionId,
            });
        } catch {
            // The editor may already be gone; the timeout error will
            // still be surfaced to the next caller through `timedOut`.
        }
    }

    /** Throws `-32004` if the id is in the timed-out set; consumes it. */
    private checkTimedOut(transactionId: number): void {
        if (!this.timedOut.has(transactionId)) return;
        // Consume the id so subsequent calls report "unknown transaction"
        // instead of repeatedly returning `TRANSACTION_TIMEOUT`.
        this.timedOut.delete(transactionId);
        throw new CrossDispatchError(TRANSACTION_TIMEOUT, 'TRANSACTION_TIMEOUT', {
            transaction_id: transactionId,
            timeout_ms: this.transactionTimeoutMs,
        });
    }
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function extractTransactionId(reply: unknown): number | undefined {
    if (reply === null || typeof reply !== 'object') return undefined;
    const id = (reply as { transaction_id?: unknown }).transaction_id;
    return typeof id === 'number' && Number.isFinite(id) ? id : undefined;
}

function readTransactionIdParam(params: unknown): number {
    if (params === null || typeof params !== 'object') {
        throw new CrossDispatchError(INVALID_PARAMS, 'params must be an object', {
            params,
        });
    }
    const id = (params as { transaction_id?: unknown }).transaction_id;
    if (typeof id !== 'number' || !Number.isFinite(id)) {
        throw new CrossDispatchError(
            INVALID_PARAMS,
            'transaction_id must be a finite number',
            { transaction_id: id },
        );
    }
    return id;
}
