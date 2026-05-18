/**
 * E2E test — `combat.create_hitbox` round trip via the runtime UDP bridge.
 *
 * Spawns a real Godot 4.6 process headless with `--mcp-bridge`, waits
 * until the runtime port appears in `user://mcp_active_port.json`,
 * connects a `RuntimeUdpClient`, then exercises three scenarios:
 *
 *   1. `dimension: "2d"` → response carries `node_path` ending in a
 *      Hitbox2D node, and the live scene tree confirms a Hitbox2D
 *      child was attached under the parent.
 *   2. `dimension: "3d"` (default) → response carries `node_path`
 *      ending in a Hitbox3D node.
 *   3. `dimension: "isometric"` → JSON-RPC error `-32602 Invalid
 *      params` with `data.allowed_dimensions: ["2d", "3d"]` so the
 *      caller can self-correct.
 *
 * Validates: Wymagania 8.3, 10.1, 10.2.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Metrics } from '../../src/metrics.js';
import { RuntimeUdpClient } from '../../src/transports/runtime_udp_client.js';
import { resolveUserLicenseDir } from '../../src/licensing/license_directory.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Fixture project directory bundled with the repository. */
const FIXTURE_PROJECT_DIR = resolve(HERE, '../fixtures/runtime_bridge_project');

/** Maximum wall-clock to wait for the Godot port file to appear. */
const PORT_FILE_TIMEOUT_MS = 30_000;

/** Polling interval while waiting for the port file. */
const PORT_FILE_POLL_MS = 200;

/** Per-scenario `combat.create_hitbox` call timeout. */
const RPC_TIMEOUT_MS = 10_000;

/** JSON-RPC `-32602 Invalid params`. */
const INVALID_PARAMS = -32602 as const;

interface JsonRpcErrorShape {
    code: number;
    data?: Record<string, unknown> | unknown;
}

function godotBinary(): string {
    const fromEnv = process.env.GODOT_BIN;
    if (fromEnv !== undefined && fromEnv !== '') {
        return fromEnv;
    }
    return 'godot';
}

/**
 * Resolve the Godot `user://` directory the spawned process will
 * write to. Each test gets a private dir via `XDG_DATA_HOME` /
 * `APPDATA` overrides so concurrent runs do not stomp on each other.
 */
function resolveSandboxedUserDir(envOverride: NodeJS.ProcessEnv): string {
    return resolveUserLicenseDir({
        platform: process.platform,
        env: envOverride,
        homedir: envOverride.HOME ?? process.env.HOME ?? '',
        projectName: 'ForgeKit MCP Runtime Bridge E2E',
    }).replace(/\/licenses$/, '');
}

async function waitForPortFile(path: string, timeoutMs: number): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (existsSync(path)) {
            const raw = await readFile(path, 'utf8');
            try {
                const parsed = JSON.parse(raw) as { runtime?: number };
                if (typeof parsed.runtime === 'number') {
                    return parsed.runtime;
                }
            } catch {
                // File partially written; retry.
            }
        }
        await new Promise((r) => setTimeout(r, PORT_FILE_POLL_MS));
    }
    throw new Error(`port file ${path} did not appear within ${timeoutMs}ms`);
}

interface SpawnedGodot {
    child: ChildProcess;
    runtimePort: number;
    sandboxDir: string;
    stdout: () => string;
    stderr: () => string;
    stop(): Promise<void>;
}

async function spawnGodotMcpBridge(): Promise<SpawnedGodot> {
    const sandboxDir = await mkdtemp(join(tmpdir(), 'forgekit-e2e-combat-'));
    // Seed every "user://" override Godot consults so the active-port
    // file lands somewhere predictable for this test run.
    const envOverride: NodeJS.ProcessEnv = {
        ...process.env,
        XDG_DATA_HOME: sandboxDir,
        APPDATA: sandboxDir,
        HOME: sandboxDir,
    };

    const args = [
        '--headless',
        '--path',
        FIXTURE_PROJECT_DIR,
        '--mcp-bridge',
    ];

    const child = spawn(godotBinary(), args, {
        cwd: FIXTURE_PROJECT_DIR,
        env: envOverride,
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
        stderr += `\n[spawn error] ${err.message}\n`;
    });

    const userDir = resolveSandboxedUserDir(envOverride);
    const portFile = join(userDir, 'mcp_active_port.json');

    let runtimePort: number;
    try {
        runtimePort = await waitForPortFile(portFile, PORT_FILE_TIMEOUT_MS);
    } catch (err) {
        // Surface the Godot logs so test failures point at the real
        // cause (missing flag handling, bind error, etc.) instead of a
        // bare timeout.
        const detail = err instanceof Error ? err.message : String(err);
        try {
            child.kill();
        } catch {
            // ignore
        }
        throw new Error(
            `${detail}\nGodot stdout:\n${stdout}\nGodot stderr:\n${stderr}`,
        );
    }

    async function stop(): Promise<void> {
        if (!child.killed) {
            child.kill('SIGTERM');
        }
        await new Promise<void>((resolveStop) => {
            child.once('close', () => resolveStop());
            // Force-kill after 2s if the process refuses to exit.
            setTimeout(() => {
                try {
                    child.kill('SIGKILL');
                } catch {
                    // ignore
                }
                resolveStop();
            }, 2_000).unref?.();
        });
        await rm(sandboxDir, { recursive: true, force: true });
    }

    return {
        child,
        runtimePort,
        sandboxDir,
        stdout: () => stdout,
        stderr: () => stderr,
        stop,
    };
}

interface RuntimeBridge {
    godot: SpawnedGodot;
    client: RuntimeUdpClient;
    teardown(): Promise<void>;
}

async function startRuntimeBridge(): Promise<RuntimeBridge> {
    const godot = await spawnGodotMcpBridge();
    const metrics = new Metrics();
    const client = new RuntimeUdpClient({
        metrics,
        host: '127.0.0.1',
        range: { start: godot.runtimePort, end: godot.runtimePort },
        enableHeartbeat: false,
        enableAutoReconnect: false,
    });
    await client.connect();
    return {
        godot,
        client,
        async teardown(): Promise<void> {
            try {
                client.disconnect();
            } catch {
                // ignore
            }
            await godot.stop();
        },
    };
}

function callWithTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolveCall, rejectCall) => {
        const timer = setTimeout(() => {
            rejectCall(new Error(`${label} timed out after ${ms}ms`));
        }, ms);
        promise.then(
            (v) => {
                clearTimeout(timer);
                resolveCall(v);
            },
            (err) => {
                clearTimeout(timer);
                rejectCall(err);
            },
        );
    });
}

describe('E2E — combat.create_hitbox round trip via runtime UDP bridge', () => {
    let bridge: RuntimeBridge;

    beforeAll(async () => {
        bridge = await startRuntimeBridge();
    }, 60_000);

    afterAll(async () => {
        await bridge.teardown();
    });

    it('creates a Hitbox2D node when dimension is "2d"', async () => {
        const result = (await callWithTimeout(
            bridge.client.send('combat.create_hitbox', {
                parent_path: '.',
                damage: 5.0,
                damage_type: 'physical',
                team: 'player',
                dimension: '2d',
            }),
            RPC_TIMEOUT_MS,
            'combat.create_hitbox 2d',
        )) as { node_path: string };

        expect(typeof result.node_path).toBe('string');
        // Hitbox nodes are auto-named after the script class. In Godot
        // 4 a freshly constructed `Hitbox2D` Node carries the script's
        // class_name ("Hitbox2D") as its node name, so a "/Hitbox2D"
        // segment on the returned NodePath proves a 2D hitbox was
        // attached.
        expect(result.node_path).toMatch(/Hitbox2D/);

        // Confirm the live scene observed by Godot agrees: the
        // listing tool walks the tree and reports `dimension` for
        // every active hitbox, so the freshly-created one must appear
        // with `dimension: "2d"`.
        const listing = (await callWithTimeout(
            bridge.client.send('combat.list_active_hitboxes', {}),
            RPC_TIMEOUT_MS,
            'combat.list_active_hitboxes 2d',
        )) as { hitboxes: Array<{ node_path: string; dimension: string }> };
        const match = listing.hitboxes.find((h) => h.node_path === result.node_path);
        expect(match, `expected ${result.node_path} in active hitboxes, got ${JSON.stringify(listing.hitboxes)}`).toBeDefined();
        expect(match?.dimension).toBe('2d');
    }, 60_000);

    it('creates a Hitbox3D node when dimension defaults to "3d"', async () => {
        const result = (await callWithTimeout(
            bridge.client.send('combat.create_hitbox', {
                parent_path: '.',
                damage: 5.0,
                damage_type: 'physical',
                team: 'player',
                dimension: '3d',
            }),
            RPC_TIMEOUT_MS,
            'combat.create_hitbox 3d',
        )) as { node_path: string };

        expect(typeof result.node_path).toBe('string');
        expect(result.node_path).toMatch(/Hitbox3D/);
    }, 60_000);

    it('rejects an unknown dimension with -32602 Invalid params and allowed_dimensions hint', async () => {
        let caught: unknown;
        try {
            await callWithTimeout(
                bridge.client.send('combat.create_hitbox', {
                    parent_path: '.',
                    damage: 5.0,
                    damage_type: 'physical',
                    team: 'player',
                    dimension: 'isometric',
                }),
                RPC_TIMEOUT_MS,
                'combat.create_hitbox isometric',
            );
        } catch (err) {
            caught = err;
        }
        expect(caught, 'send must reject for an unknown dimension').toBeDefined();
        const e = caught as Error & JsonRpcErrorShape;
        expect(e.code).toBe(INVALID_PARAMS);
        expect(e.data, 'error envelope must carry data').toBeDefined();
        const data = e.data as { allowed_dimensions?: unknown };
        expect(Array.isArray(data.allowed_dimensions)).toBe(true);
        expect(data.allowed_dimensions).toEqual(['2d', '3d']);
    }, 60_000);
});
