/**
 * Feature: forgekit, Property 52: Trace ID propagation
 *
 * Property 52 — every dispatch line and every Godot-side log line for
 * the same JSON-RPC request share the same `trace_id`.
 *
 * Validates: Wymagania 31.2, 31.3.
 *
 * Setup
 * -----
 *
 * The property exercises both halves of the trace pipeline:
 *
 *   1. Server-side. A `DispatchLoggerMiddleware` wrapping the
 *      `ChannelRouter` pattern emits one before-line and one
 *      after-line per `dispatch()` call, both carrying the trace
 *      context the middleware injected into `params.trace`.
 *
 *   2. GDScript-side. A headless Godot run exercises the production
 *      `McpJsonRpcDispatcher` plus `McpJsonlLogger`. Each request
 *      carries an explicit `_forgekit_trace = {trace_id, span_id}`
 *      envelope which the dispatcher extracts via
 *      `_extract_or_mint_trace_context`; the driver then forwards
 *      the trace into `McpJsonlLogger.set_trace_context()` so the
 *      handler-side log line inherits the same trace without the
 *      handler explicitly threading it through every log call.
 *
 * For every iteration the test asserts that:
 *   - the dispatcher returns the trace_id sent in `_forgekit_trace`
 *     (Subtask 8.11.4 / Wymaganie 31.3 — propagation through
 *     `params.trace`).
 *   - the GDScript-side log line written by the handler carries that
 *     same trace_id (Subtask 8.11.3 / Wymaganie 31.2 — propagation
 *     of `trace_id` from incoming request to outgoing log lines).
 *   - the server-side `DispatchLoggerMiddleware` before-line and
 *     after-line for the same dispatch share the same trace_id and
 *     span_id (Subtask 8.11.1 — dispatch logger correlation).
 *
 * The Godot driver is invoked once per test run and processes every
 * fast-check sample inside a single headless spawn so the property
 * stays cheap enough for `vitest run`.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { JsonlLogger } from '../../src/observability/jsonl_logger.js';
import { DispatchLoggerMiddleware } from '../../src/observability/dispatch_logger.js';
import type {
    ChannelDispatcher,
    DispatchResult,
} from '../../src/stdio_bridge.js';
import { resolveUserLicenseDir } from '../../src/licensing/license_directory.js';

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

const NUM_RUNS = 100 as const;

/** Logical names of MCP tools exercised by Property 52. */
const TOOL_METHODS: readonly string[] = [
    'combat.spawn_enemy',
    'combat.apply_damage',
    'inventory.add_item',
    'inventory.remove_item',
    'project.info',
    'project.list_files',
    'scene.open',
    'scene.add_node',
];

const TRACE_BEGIN = '<<<FORGEKIT_TRACE_BEGIN>>>';
const TRACE_END = '<<<FORGEKIT_TRACE_END>>>';

const HERE = dirname(fileURLToPath(import.meta.url));

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/**
 * Walk upward from this file's directory to locate ForgeKit Core's
 * `project.godot`.
 */
function findProjectRoot(startDir: string): string {
    let cur = startDir;
    for (let i = 0; i < 16; i++) {
        if (existsSync(resolve(cur, 'project.godot'))) {
            return cur;
        }
        const parent = dirname(cur);
        if (parent === cur) {
            break;
        }
        cur = parent;
    }
    throw new Error(`could not find project.godot walking up from ${startDir}`);
}

function godotBinary(): string {
    const fromEnv = process.env.GODOT_BIN;
    if (fromEnv !== undefined && fromEnv !== '') {
        return fromEnv;
    }
    return 'godot';
}

interface SpawnResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}

function runGodot(
    cwd: string,
    args: readonly string[],
    payload: string,
): Promise<SpawnResult> {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(godotBinary(), [...args], {
            cwd,
            env: { ...process.env },
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString('utf8');
        });
        child.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString('utf8');
        });
        child.on('error', (err) => rejectPromise(err));
        child.on('close', (code) => {
            resolvePromise({ stdout, stderr, exitCode: code ?? -1 });
        });

        child.stdin.end(payload, 'utf8');
    });
}

interface DriverResult {
    method: string;
    trace_id: string;
    span_id: string;
}

interface DriverEnvelope {
    log_dir: string;
    results: ReadonlyArray<DriverResult>;
    error?: string;
}

function extractEnvelope(stdout: string): DriverEnvelope {
    const beginIdx = stdout.indexOf(TRACE_BEGIN);
    const endIdx = stdout.indexOf(TRACE_END);
    if (beginIdx === -1 || endIdx === -1 || endIdx <= beginIdx) {
        throw new Error(`driver did not emit fenced envelope; stdout was:\n${stdout}`);
    }
    const body = stdout.slice(beginIdx + TRACE_BEGIN.length, endIdx).trim();
    const parsed = JSON.parse(body) as DriverEnvelope;
    if (!Array.isArray(parsed.results)) {
        throw new Error(`driver envelope missing results[]: ${body}`);
    }
    return parsed;
}

interface LogLine {
    trace_id?: string;
    span_id?: string;
    method?: string;
    component?: string;
    [key: string]: unknown;
}

async function readJsonlLines(path: string): Promise<LogLine[]> {
    const raw = await readFile(path, 'utf8');
    return raw
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as LogLine);
}

/** Resolve the host filesystem path for a `user://...` Godot path. */
function resolveUserPath(godotPath: string): string {
    if (!godotPath.startsWith('user://')) {
        throw new Error(`expected user:// prefix, got ${godotPath}`);
    }
    // Reuse the license-directory resolver to get the on-disk root for
    // `user://`; replace the trailing `licenses` segment with the
    // caller-supplied subdirectory.
    const userRoot = resolveUserLicenseDir({
        platform: process.platform,
        env: process.env,
        homedir: process.env.HOME ?? '',
        projectName: 'ForgeKit Core Template',
    }).replace(/\/licenses$/, '');
    return join(userRoot, godotPath.slice('user://'.length));
}

function todayUtcDate(): string {
    const d = new Date();
    return `${d.getUTCFullYear().toString().padStart(4, '0')}-${(d.getUTCMonth() + 1).toString().padStart(2, '0')
        }-${d.getUTCDate().toString().padStart(2, '0')}`;
}

// --------------------------------------------------------------------------
// Property
// --------------------------------------------------------------------------

interface TestEnv {
    serverLogDir: string;
    middleware: DispatchLoggerMiddleware;
    serverLines(): Promise<LogLine[]>;
}

async function newServerSide(): Promise<TestEnv> {
    const baseDir = await mkdtemp(join(tmpdir(), 'forgekit-trace-prop-'));
    const logger = new JsonlLogger({
        baseDir,
        level: 'debug',
        clock: () => new Date(`${todayUtcDate()}T12:00:00.000Z`),
    });
    const inner: ChannelDispatcher = {
        async dispatch(method, _params): Promise<DispatchResult> {
            // Echo the method back so the test can correlate ordering.
            return { kind: 'ok', result: { echoed: method } };
        },
    };
    const middleware = new DispatchLoggerMiddleware(inner, { logger });

    return {
        serverLogDir: baseDir,
        middleware,
        async serverLines(): Promise<LogLine[]> {
            const file = join(baseDir, `${todayUtcDate()}.jsonl`);
            return await readJsonlLines(file);
        },
    };
}

let env: TestEnv;

beforeEach(async () => {
    env = await newServerSide();
});

afterEach(async () => {
    await rm(env.serverLogDir, { recursive: true, force: true });
});

describe('Property 52 — Trace ID propagation', () => {
    it('shares the same trace_id across server dispatch lines and Godot log lines', async () => {
        const projectRoot = findProjectRoot(HERE);
        const driverPath = 'tools/cli_runner/trace_propagation_batch.gd';
        const godotLogDir = `user://forgekit_pbt_trace_propagation_${process.pid}`;

        // ----------------------------------------------------------------
        // 1. Run the server-side dispatch loop end-to-end so each sample
        //    leaves its own trace_id on disk before we hand the cases to
        //    the Godot driver.
        // ----------------------------------------------------------------
        const traceIdGen = fc
            .uint8Array({ minLength: 4, maxLength: 4 })
            .map((bytes) =>
                Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''),
            );
        const spanIdGen = fc
            .uint8Array({ minLength: 2, maxLength: 2 })
            .map((bytes) =>
                Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''),
            );
        const methodGen = fc.constantFrom(...TOOL_METHODS);
        const caseGen = fc.record({
            trace_id: traceIdGen,
            span_id: spanIdGen,
            method: methodGen,
        });

        const cases: ReadonlyArray<{ trace_id: string; span_id: string; method: string }> =
            fc.sample(caseGen, NUM_RUNS);

        // De-duplicate trace ids so the per-trace assertions below are
        // unambiguous when the random generator picks the same hex
        // string twice. The dedup keeps the first occurrence and walks
        // a small disambiguator suffix until the trace id is unique.
        const seen = new Set<string>();
        const uniqueCases: Array<{ trace_id: string; span_id: string; method: string }> = [];
        for (const c of cases) {
            let tid = c.trace_id;
            if (seen.has(tid)) {
                let suffix = 0;
                while (seen.has(tid)) {
                    tid =
                        c.trace_id.slice(0, 6) + suffix.toString(16).padStart(2, '0');
                    suffix++;
                }
            }
            seen.add(tid);
            uniqueCases.push({ ...c, trace_id: tid });
        }

        for (const c of uniqueCases) {
            // Inject the upstream trace into params so the dispatch
            // logger reuses it instead of minting a fresh one.
            await env.middleware.dispatch(c.method, {
                trace: { trace_id: c.trace_id, span_id: c.span_id },
            });
        }

        // ----------------------------------------------------------------
        // 2. Run the Godot driver. The driver routes every case through
        //    McpJsonRpcDispatcher and writes one line per case to the
        //    runtime_bridge component log under `<godotLogDir>/runtime_bridge/`.
        // ----------------------------------------------------------------
        const args: string[] = [
            '--headless',
            '--path',
            projectRoot,
            '--script',
            driverPath,
        ];
        const payload = JSON.stringify({
            log_dir: godotLogDir,
            cases: uniqueCases.map((c) => ({
                trace_id: c.trace_id,
                span_id: c.span_id,
                method: c.method,
                params: {},
            })),
        });
        const { stdout, stderr, exitCode } = await runGodot(projectRoot, args, payload);
        if (exitCode !== 0) {
            throw new Error(
                `godot exited with code ${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
            );
        }
        const envelope = extractEnvelope(stdout);
        if (envelope.error !== undefined) {
            throw new Error(`driver reported error: ${envelope.error}`);
        }

        // ----------------------------------------------------------------
        // 3. Read both log streams and assert per-trace consistency.
        // ----------------------------------------------------------------
        const serverLines = await env.serverLines();
        const godotLogPath = resolveUserPath(godotLogDir).concat(
            `/runtime_bridge/${todayUtcDate()}.jsonl`,
        );
        const godotLines = await readJsonlLines(godotLogPath);

        try {
            // The dispatcher's reported trace_id must equal the upstream id.
            for (let i = 0; i < uniqueCases.length; i++) {
                const expected = uniqueCases[i]!;
                const observed = envelope.results[i]!;
                expect(observed.trace_id).toBe(expected.trace_id);
            }

            // Every Godot-side log line must match exactly one of the
            // upstream trace ids. (The driver writes one line per case
            // so we get a full per-case map.)
            const traceIdsExpected = new Set(uniqueCases.map((c) => c.trace_id));
            for (const line of godotLines) {
                expect(line.trace_id).toBeDefined();
                expect(traceIdsExpected.has(line.trace_id ?? '')).toBe(true);
            }

            // The middleware before- and after-lines for the same
            // dispatch share the same trace_id and span_id. We pair them
            // up by ordering — server lines come out two-per-dispatch.
            expect(serverLines.length).toBe(uniqueCases.length * 2);
            for (let i = 0; i < uniqueCases.length; i++) {
                const before = serverLines[i * 2]!;
                const after = serverLines[i * 2 + 1]!;
                expect(before.trace_id).toBe(uniqueCases[i]!.trace_id);
                expect(after.trace_id).toBe(uniqueCases[i]!.trace_id);
                expect(before.span_id).toBe(after.span_id);
            }
        } finally {
            // Clean up the Godot-side scratch log dir so reruns start
            // from a known state.
            await rm(resolveUserPath(godotLogDir), {
                recursive: true,
                force: true,
            });
        }
    }, 60_000);
});
