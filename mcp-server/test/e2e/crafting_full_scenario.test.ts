/**
 * E2E test — full inventory + crafting scenario via the runtime UDP
 * bridge.
 *
 * Spawns a real Godot 4.6 process headless with `--mcp-bridge`, waits
 * until the runtime port appears in `user://mcp_active_port.json`,
 * connects a `RuntimeUdpClient`, then exercises two scenarios that
 * mirror the gameplay flow declared in the spec:
 *
 *   1. Happy path (Wymaganie 13.2): start with an empty inventory,
 *      `inventory.add_item("iron_ore", 2)`, `crafting.execute("iron_ingot")`,
 *      `inventory.get_count("iron_ore")` (expect 0),
 *      `inventory.get_count("iron_ingot")` (expect 1). Status returned
 *      by `crafting.execute` must be `"ok"`.
 *
 *   2. Missing inputs (Wymagania 11.3, 13.3): start with an empty
 *      inventory and call `crafting.execute("iron_ingot")` directly.
 *      The recipe needs 2 `iron_ore` so the result must carry
 *      `status: "insufficient_inputs"`. The inventory must remain
 *      untouched: both `iron_ore` and `iron_ingot` counts stay at 0.
 *
 * Validates: Wymagania 11.1, 11.2, 11.3, 11.4, 13.2, 13.3.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

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

/** Per-scenario RPC call timeout. */
const RPC_TIMEOUT_MS = 10_000;

const RECIPE_ID = 'iron_ingot';
const INPUT_ITEM_ID = 'iron_ore';
const OUTPUT_ITEM_ID = 'iron_ingot';
const RECIPE_INPUT_AMOUNT = 2;
const RECIPE_OUTPUT_AMOUNT = 1;

interface InventoryCountResult {
    count: number;
}

interface CraftingExecuteResult {
    status: string;
    missing_items: Array<{ item_id: string; amount: number }>;
    outputs: Array<{ item_id: string; amount: number }>;
    error_message: string;
}

function godotBinary(): string {
    const fromEnv = process.env.GODOT_BIN;
    if (fromEnv !== undefined && fromEnv !== '') {
        return fromEnv;
    }
    return 'godot';
}

/**
 * The runtime-bridge fixture's `addons/forgekit_rpg/` symlink points at
 * a sibling `forgekit-rpg/` checkout. The paid module is private, so
 * public lanes (CI on `forgekit-core` alone) only see the `.gitkeep`
 * placeholder and `mcp_bridge_registrar.gd` cannot preload
 * `crafting_tools.gd` / `inventory_tools.gd`. This helper signals the
 * rpg checkout is present so the suite can `describe.skipIf` itself
 * out gracefully on public-only runs (mirroring the GUT integration
 * suites that `pending("forgekit_rpg module not installed")`).
 */
function rpgFixtureInstalled(): boolean {
    const target = join(
        FIXTURE_PROJECT_DIR,
        'addons',
        'forgekit_rpg',
        'crafting',
        'crafting_tools.gd',
    );
    if (!existsSync(target)) {
        return false;
    }
    // `existsSync` follows symlinks, so a chain that ultimately
    // resolves to a real file passes. Also confirm the file is
    // readable via `statSync` so a directory entry that does not
    // resolve to a regular file (e.g. a `.gitkeep` placeholder where
    // the symlink dangles into a fresh checkout) is rejected.
    try {
        return statSync(target).isFile();
    } catch {
        return false;
    }
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
    const sandboxDir = await mkdtemp(join(tmpdir(), 'forgekit-e2e-crafting-'));
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

async function clearInventory(client: RuntimeUdpClient): Promise<void> {
    await callWithTimeout(
        client.send('inventory.clear', {}),
        RPC_TIMEOUT_MS,
        'inventory.clear (reset)',
    );
}

// Skip the entire suite when:
//   1. No Godot binary is available (matches the convention used by
//      every other E2E test in this directory).
//   2. The forgekit_rpg checkout is missing (public-only CI). The
//      fixture's autoload preloads RPG tool scripts; when the symlink
//      dangles the registrar parse-errors and the bridge never starts.
const describeOrSkip =
    process.env.GODOT_BIN === undefined && !existsSync('/opt/homebrew/bin/godot')
        ? describe.skip
        : !rpgFixtureInstalled()
            ? describe.skip
            : describe;

describeOrSkip('E2E — inventory + crafting full scenario via runtime UDP bridge', () => {
    let bridge: RuntimeBridge;

    beforeAll(async () => {
        bridge = await startRuntimeBridge();
    }, 60_000);

    afterAll(async () => {
        if (bridge !== undefined) {
            await bridge.teardown();
        }
    });

    afterEach(async () => {
        // Reset the shared inventory between scenarios so the second
        // test starts from the documented "empty" precondition.
        await clearInventory(bridge.client);
    });

    it('crafts iron_ingot end-to-end: 2 iron_ore in, 1 iron_ingot out, sources consumed', async () => {
        const addReply = (await callWithTimeout(
            bridge.client.send('inventory.add_item', {
                item_id: INPUT_ITEM_ID,
                amount: RECIPE_INPUT_AMOUNT,
            }),
            RPC_TIMEOUT_MS,
            'inventory.add_item iron_ore',
        )) as InventoryCountResult;
        expect(addReply.count).toBe(RECIPE_INPUT_AMOUNT);

        const craftReply = (await callWithTimeout(
            bridge.client.send('crafting.execute', {
                recipe_id: RECIPE_ID,
            }),
            RPC_TIMEOUT_MS,
            'crafting.execute iron_ingot (happy path)',
        )) as CraftingExecuteResult;
        expect(
            craftReply.status,
            `expected status "ok", got ${JSON.stringify(craftReply)}`,
        ).toBe('ok');
        expect(craftReply.outputs).toEqual([
            { item_id: OUTPUT_ITEM_ID, amount: RECIPE_OUTPUT_AMOUNT },
        ]);

        const oreCount = (await callWithTimeout(
            bridge.client.send('inventory.get_count', { item_id: INPUT_ITEM_ID }),
            RPC_TIMEOUT_MS,
            'inventory.get_count iron_ore',
        )) as InventoryCountResult;
        expect(oreCount.count).toBe(0);

        const ingotCount = (await callWithTimeout(
            bridge.client.send('inventory.get_count', { item_id: OUTPUT_ITEM_ID }),
            RPC_TIMEOUT_MS,
            'inventory.get_count iron_ingot',
        )) as InventoryCountResult;
        expect(ingotCount.count).toBe(RECIPE_OUTPUT_AMOUNT);
    }, 60_000);

    it('returns insufficient_inputs and leaves the inventory untouched when inputs are missing', async () => {
        // Sanity check: the inventory really is empty after the
        // afterEach reset (or at the start of the suite when this runs
        // first).
        const oreBefore = (await callWithTimeout(
            bridge.client.send('inventory.get_count', { item_id: INPUT_ITEM_ID }),
            RPC_TIMEOUT_MS,
            'inventory.get_count iron_ore (before)',
        )) as InventoryCountResult;
        expect(oreBefore.count).toBe(0);
        const ingotBefore = (await callWithTimeout(
            bridge.client.send('inventory.get_count', { item_id: OUTPUT_ITEM_ID }),
            RPC_TIMEOUT_MS,
            'inventory.get_count iron_ingot (before)',
        )) as InventoryCountResult;
        expect(ingotBefore.count).toBe(0);

        const craftReply = (await callWithTimeout(
            bridge.client.send('crafting.execute', {
                recipe_id: RECIPE_ID,
            }),
            RPC_TIMEOUT_MS,
            'crafting.execute iron_ingot (missing inputs)',
        )) as CraftingExecuteResult;
        expect(
            craftReply.status,
            `expected status "insufficient_inputs", got ${JSON.stringify(craftReply)}`,
        ).toBe('insufficient_inputs');
        // The shortfall must enumerate the missing iron_ore amount so
        // the AI agent can self-heal by adding the missing inputs.
        expect(craftReply.missing_items).toEqual([
            { item_id: INPUT_ITEM_ID, amount: RECIPE_INPUT_AMOUNT },
        ]);

        // Inventory must be unchanged — neither input nor output
        // counts may shift on a failed craft (Wymaganie 11.3).
        const oreAfter = (await callWithTimeout(
            bridge.client.send('inventory.get_count', { item_id: INPUT_ITEM_ID }),
            RPC_TIMEOUT_MS,
            'inventory.get_count iron_ore (after)',
        )) as InventoryCountResult;
        expect(oreAfter.count).toBe(0);
        const ingotAfter = (await callWithTimeout(
            bridge.client.send('inventory.get_count', { item_id: OUTPUT_ITEM_ID }),
            RPC_TIMEOUT_MS,
            'inventory.get_count iron_ingot (after)',
        )) as InventoryCountResult;
        expect(ingotAfter.count).toBe(0);
    }, 60_000);
});
