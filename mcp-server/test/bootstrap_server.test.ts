/**
 * Tests for the new `bootstrapServer` entrypoint function.
 *
 * `bootstrapServer` replaces the old eager skeleton-line behaviour of
 * `main()`. It exposes three modes:
 *
 *   1. `--smoke` — prints the legacy skeleton acknowledgement line to
 *      stderr and resolves immediately. Used by the existing CLI smoke
 *      tests so we keep observable behaviour for QA tooling.
 *
 *   2. `--stdio` — instantiates a real `@modelcontextprotocol/sdk`
 *      `Server` over a `StdioServerTransport`, registers empty
 *      `ListToolsRequestSchema` and `CallToolRequestSchema` handlers,
 *      and resolves when the stdio transport closes.
 *
 *   3. headless (default) — installs a SIGTERM/SIGINT lifecycle and
 *      blocks until either signal fires or the test-only
 *      `shutdownSignal` AbortSignal aborts. Future phases (8.10 health
 *      endpoint, 8.3 WebSocket fallback) plug into the same lifecycle.
 *
 * The tests drive `bootstrapServer` with PassThrough streams and a
 * recording stderr so we can assert the visible side effects without
 * spawning a child process.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';

import {
    bootstrapServer,
    parseCliArgs,
    type CliOptions,
} from '../src/index.js';

interface RecordedWrite {
    data: string;
}

function makeRecordingStderr(): { stream: PassThrough; chunks: RecordedWrite[] } {
    const stream = new PassThrough();
    const chunks: RecordedWrite[] = [];
    stream.on('data', (chunk: Buffer | string) => {
        chunks.push({ data: chunk.toString('utf8') });
    });
    return { stream, chunks };
}

function joinChunks(chunks: RecordedWrite[]): string {
    return chunks.map((c) => c.data).join('');
}

function defaultOptions(overrides: Partial<CliOptions> = {}): CliOptions {
    return {
        stdio: false,
        profile: 'Minimal',
        logLevel: 'info',
        licenseDir: undefined,
        smoke: false,
        ...overrides,
    };
}

/**
 * Encodes a JSON-RPC value using the newline-delimited JSON framing
 * the MCP SDK's stdio transport uses (one `\n`-terminated JSON object
 * per message).
 */
function encodeFrame(value: unknown): Buffer {
    return Buffer.from(JSON.stringify(value) + '\n', 'utf8');
}

interface FrameParseResult {
    messages: unknown[];
    consumed: number;
}

function parseFrames(buffer: Buffer): FrameParseResult {
    const messages: unknown[] = [];
    let offset = 0;
    while (offset < buffer.length) {
        const newlineIdx = buffer.indexOf('\n', offset);
        if (newlineIdx === -1) {
            break;
        }
        const line = buffer
            .toString('utf8', offset, newlineIdx)
            .replace(/\r$/, '');
        if (line.length > 0) {
            try {
                messages.push(JSON.parse(line));
            } catch {
                messages.push(undefined);
            }
        }
        offset = newlineIdx + 1;
    }
    return { messages, consumed: offset };
}

const pendingShutdowns: Array<() => Promise<void>> = [];

afterEach(async () => {
    while (pendingShutdowns.length > 0) {
        const stop = pendingShutdowns.pop();
        if (stop) {
            await stop().catch(() => undefined);
        }
    }
});

describe('parseCliArgs — --smoke flag', () => {
    it('defaults --smoke to false', () => {
        expect(parseCliArgs([]).smoke).toBe(false);
    });

    it('recognises --smoke as a boolean flag', () => {
        const opts = parseCliArgs(['--smoke']);
        expect(opts.smoke).toBe(true);
    });

    it('combines with other flags', () => {
        const opts = parseCliArgs(['--smoke', '--profile', 'Lite', '--stdio']);
        expect(opts).toEqual({
            stdio: true,
            profile: 'Lite',
            logLevel: 'info',
            licenseDir: undefined,
            smoke: true,
        });
    });
});

describe('bootstrapServer — smoke mode', () => {
    it('prints the legacy skeleton line to stderr and resolves', async () => {
        const stderr = makeRecordingStderr();
        await bootstrapServer(defaultOptions({ smoke: true }), {
            stderr: stderr.stream,
            discoverUnlockedModules: async () => new Set<string>(),
        });
        const output = joinChunks(stderr.chunks);
        expect(output).toContain('[license] unlocked modules: []');
        expect(output).toContain('@forgekitstudio/core-mcp');
        expect(output).toContain('skeleton');
        expect(output).toContain('Transport bridges are not wired up yet.');
    });

    it('reports the unlocked modules in stderr', async () => {
        const stderr = makeRecordingStderr();
        await bootstrapServer(defaultOptions({ smoke: true }), {
            stderr: stderr.stream,
            discoverUnlockedModules: async () => new Set<string>(['combat', 'crafting']),
        });
        const output = joinChunks(stderr.chunks);
        expect(output).toContain('[license] unlocked modules: [combat, crafting]');
    });
});

describe('bootstrapServer — stdio mode', () => {
    it('does not print the skeleton line when --smoke is omitted', async () => {
        const stdin = new PassThrough();
        const stdout = new PassThrough();
        const stderr = makeRecordingStderr();
        const shutdown = new AbortController();

        const run = bootstrapServer(
            defaultOptions({ stdio: true, smoke: false }),
            {
                stdin,
                stdout,
                stderr: stderr.stream,
                shutdownSignal: shutdown.signal,
                discoverUnlockedModules: async () => new Set<string>(),
            },
        );
        pendingShutdowns.push(async () => {
            shutdown.abort();
            await run.catch(() => undefined);
        });

        // Give bootstrap a tick to register handlers.
        await new Promise((resolve) => setImmediate(resolve));
        shutdown.abort();
        await run;

        const output = joinChunks(stderr.chunks);
        expect(output).not.toContain('Transport bridges are not wired up yet.');
    });

    it('returns an empty tools list from ListToolsRequestSchema', async () => {
        const stdin = new PassThrough();
        const stdout = new PassThrough();
        const stderr = makeRecordingStderr();
        const stdoutChunks: Buffer[] = [];
        stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));

        const shutdown = new AbortController();
        const run = bootstrapServer(
            defaultOptions({ stdio: true }),
            {
                stdin,
                stdout,
                stderr: stderr.stream,
                shutdownSignal: shutdown.signal,
                discoverUnlockedModules: async () => new Set<string>(),
                // Inject empty profiles + schemas so the tools list is
                // empty regardless of the package's real profiles.json.
                loadProfiles: async () => ({ version: 'test', tools: [] }),
                toolSchemas: new Map(),
            },
        );
        pendingShutdowns.push(async () => {
            shutdown.abort();
            await run.catch(() => undefined);
        });

        // Send the MCP initialize handshake.
        stdin.write(
            encodeFrame({
                jsonrpc: '2.0',
                id: 1,
                method: 'initialize',
                params: {
                    protocolVersion: '2025-06-18',
                    capabilities: {},
                    clientInfo: { name: 'test', version: '0.0.0' },
                },
            }),
        );
        stdin.write(
            encodeFrame({
                jsonrpc: '2.0',
                method: 'notifications/initialized',
            }),
        );
        stdin.write(
            encodeFrame({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
        );

        // Wait for at least two responses (initialize, tools/list).
        const deadline = Date.now() + 3000;
        let parsed: { messages: unknown[] };
        while (true) {
            parsed = parseFrames(Buffer.concat(stdoutChunks));
            if (parsed.messages.length >= 2) {
                break;
            }
            if (Date.now() > deadline) {
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
        }

        shutdown.abort();
        await run;

        expect(parsed.messages.length).toBeGreaterThanOrEqual(2);
        const responses = parsed.messages as Array<Record<string, unknown>>;
        const toolsList = responses.find(
            (m) => (m as { id?: unknown }).id === 2,
        ) as { result?: { tools?: unknown[] } } | undefined;
        expect(toolsList).toBeDefined();
        expect(toolsList?.result?.tools).toEqual([]);
    });
});

describe('bootstrapServer — headless mode', () => {
    it('does not exit until the shutdown signal aborts', async () => {
        const stderr = makeRecordingStderr();
        const shutdown = new AbortController();

        let resolved = false;
        const run = bootstrapServer(
            defaultOptions({ stdio: false }),
            {
                stderr: stderr.stream,
                shutdownSignal: shutdown.signal,
                discoverUnlockedModules: async () => new Set<string>(),
                healthEndpointFactory: () => stubHealthEndpoint(),
            },
        ).then(() => {
            resolved = true;
        });
        pendingShutdowns.push(async () => {
            shutdown.abort();
            await run.catch(() => undefined);
        });

        // Wait a few ticks to confirm bootstrap is still running.
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(resolved).toBe(false);

        shutdown.abort();
        await run;
        expect(resolved).toBe(true);
    });

    it('starts the health endpoint and stops it when shutdown aborts', async () => {
        const stderr = makeRecordingStderr();
        const shutdown = new AbortController();

        const stub = stubHealthEndpoint();

        const run = bootstrapServer(
            defaultOptions({ stdio: false }),
            {
                stderr: stderr.stream,
                shutdownSignal: shutdown.signal,
                discoverUnlockedModules: async () => new Set<string>(),
                healthEndpointFactory: () => stub,
            },
        );
        pendingShutdowns.push(async () => {
            shutdown.abort();
            await run.catch(() => undefined);
        });

        // Poll for the health endpoint to come online to avoid flakes
        // under heavy parallel test load.
        const deadline = Date.now() + 5000;
        while (stub.startCalls === 0 && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
        expect(stub.startCalls).toBe(1);
        expect(stub.stopCalls).toBe(0);
        const output = joinChunks(stderr.chunks);
        expect(output).toContain('health endpoint listening on http://127.0.0.1:6040');

        shutdown.abort();
        await run;
        expect(stub.stopCalls).toBe(1);
    });
});

interface StubHealthEndpoint {
    start(): Promise<void>;
    stop(): Promise<void>;
    getPort(): number;
    startCalls: number;
    stopCalls: number;
}

function stubHealthEndpoint(port = 6040): StubHealthEndpoint {
    const stub: StubHealthEndpoint = {
        startCalls: 0,
        stopCalls: 0,
        async start() {
            this.startCalls += 1;
        },
        async stop() {
            this.stopCalls += 1;
        },
        getPort() {
            return port;
        },
    };
    return stub;
}
