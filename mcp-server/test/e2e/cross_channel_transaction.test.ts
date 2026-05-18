/**
 * E2E test — cross-channel transaction atomicity.
 *
 * Spawns two real Godot 4.6 processes:
 *
 *   1. Editor    → `--editor --headless` against the
 *      `editor_channel_project` fixture so the editor-channel
 *      WebSocket server (`EditorWsClient`) is reachable.
 *   2. Runtime   → `--headless --mcp-bridge` against the
 *      `runtime_bridge_project` fixture so the runtime-channel UDP
 *      server (`RuntimeUdpClient`) is reachable.
 *
 * Wires both transports into a single `CrossExecutor` so the test
 * exercises the production cross-channel orchestrator that the MCP
 * stdio bridge uses to bracket multi-channel mutations into one MCP
 * transaction.
 *
 * Two scenarios cover the atomicity contract:
 *
 *   1. Successful commit:
 *        - `transaction.begin` opens a transaction on the editor.
 *        - Editor mutations: `node.set_property` then `scene.save`
 *          flush the new value to disk.
 *        - Runtime mutations: `inventory.add_item` twice for two
 *          different item ids.
 *        - `transaction.commit` finalises both sides. The cross
 *          executor pings the runtime channel as part of commit.
 *        - Assert: the scene file on disk reflects the new property
 *          value, and a runtime `inventory.snapshot` reports both
 *          item counts.
 *
 *   2. Rollback after a mid-sequence failure:
 *        - `transaction.begin`.
 *        - Successful editor + runtime mutations as above.
 *        - A deliberately invalid `node.set_property` call (path to a
 *          non-existent node) raises an error mid-sequence.
 *        - The test issues `transaction.rollback`. The editor reverts
 *          its operations through the `TransactionManager` undo
 *          callables; the test compensates the runtime mutations
 *          explicitly so the visible state matches the pre-transaction
 *          baseline.
 *        - Assert: the scene file on disk is byte-for-byte the
 *          pre-transaction baseline and `inventory.snapshot` is empty.
 *
 * The suite uses `describe.skipIf(!godotBinary)` so CI lanes without
 * Godot continue to pass without exercising the live engine.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CrossExecutor } from '../../src/dispatcher/cross_executor.js';
import { Metrics } from '../../src/metrics.js';
import { EditorWsClient } from '../../src/transports/editor_ws_client.js';
import { RuntimeUdpClient } from '../../src/transports/runtime_udp_client.js';
import { resolveUserLicenseDir } from '../../src/licensing/license_directory.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Editor-channel fixture project (spawned with `--editor --headless`). */
const EDITOR_FIXTURE_DIR = resolve(HERE, '../fixtures/editor_channel_project');

/** Runtime-channel fixture project (spawned with `--mcp-bridge`). */
const RUNTIME_FIXTURE_DIR = resolve(HERE, '../fixtures/runtime_bridge_project');

/** Scene file inside the editor fixture that the test mutates. */
const EDITOR_SCENE_RES_PATH = 'res://sample_scene.tscn';
const EDITOR_SCENE_REL_PATH = 'sample_scene.tscn';
const EDITOR_NODE_PATH = 'Root';

/** Vector2 value the happy-path scenario writes into `position`. */
const COMMIT_POSITION = { x: 222, y: 333 } as const;

/** Vector2 value the rollback scenario writes before the failure. */
const ROLLBACK_POSITION = { x: 444, y: 555 } as const;

/** Item ids the runtime side adds during the scenarios. */
const RUNTIME_ITEM_A = 'iron_ore';
const RUNTIME_ITEM_B = 'iron_ingot';
const RUNTIME_ITEM_A_AMOUNT = 3;
const RUNTIME_ITEM_B_AMOUNT = 1;

/** Maximum wall-clock to wait for either Godot port file. */
const PORT_FILE_TIMEOUT_MS = 60_000;

/** Polling interval while waiting for a port file. */
const PORT_FILE_POLL_MS = 250;

/** Per-call RPC timeout. */
const RPC_TIMEOUT_MS = 15_000;

interface InventoryCountResult {
    count: number;
}

interface InventorySnapshotResult {
    items: Record<string, number>;
}

function godotBinary(): string | null {
    const fromEnv = process.env.GODOT_BIN;
    if (fromEnv !== undefined && fromEnv !== '') {
        return fromEnv;
    }
    if (existsSync('/opt/homebrew/bin/godot')) {
        return '/opt/homebrew/bin/godot';
    }
    return null;
}

/**
 * Resolve the Godot `user://` directory the spawned process will write
 * to. Each spawned child gets a private dir via `XDG_DATA_HOME` /
 * `APPDATA` / `HOME` overrides so editor and runtime processes do not
 * stomp on each other's `mcp_active_port.json`.
 */
function resolveSandboxedUserDir(
    envOverride: NodeJS.ProcessEnv,
    projectName: string,
): string {
    return resolveUserLicenseDir({
        platform: process.platform,
        env: envOverride,
        homedir: envOverride.HOME ?? process.env.HOME ?? '',
        projectName,
    }).replace(/\/licenses$/, '');
}

async function waitForEditorPort(path: string, timeoutMs: number): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (existsSync(path)) {
            const raw = await readFile(path, 'utf8');
            try {
                const parsed = JSON.parse(raw) as { editor?: number };
                if (typeof parsed.editor === 'number') {
                    return parsed.editor;
                }
            } catch {
                // File partially written; retry.
            }
        }
        await new Promise((r) => setTimeout(r, PORT_FILE_POLL_MS));
    }
    throw new Error(`editor port file ${path} did not appear within ${timeoutMs}ms`);
}

async function waitForRuntimePort(path: string, timeoutMs: number): Promise<number> {
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
    throw new Error(`runtime port file ${path} did not appear within ${timeoutMs}ms`);
}

interface SpawnedGodot {
    child: ChildProcess;
    sandboxDir: string;
    projectDir: string;
    stdout: () => string;
    stderr: () => string;
    stop(): Promise<void>;
}

interface SpawnedEditor extends SpawnedGodot {
    editorPort: number;
}

interface SpawnedRuntime extends SpawnedGodot {
    runtimePort: number;
}

/**
 * Copy the editor fixture into a fresh temp directory so the test can
 * mutate `sample_scene.tscn` on disk without dirtying the workspace.
 * The `addons/` symlink is recreated to point at the live workspace
 * addon tree.
 */
async function materializeEditorProject(): Promise<string> {
    const projectDir = await mkdtemp(join(tmpdir(), 'forgekit-e2e-cct-editor-'));
    await copyFile(
        join(EDITOR_FIXTURE_DIR, 'project.godot'),
        join(projectDir, 'project.godot'),
    );
    await copyFile(
        join(EDITOR_FIXTURE_DIR, EDITOR_SCENE_REL_PATH),
        join(projectDir, EDITOR_SCENE_REL_PATH),
    );
    const fs = await import('node:fs/promises');
    await fs.mkdir(join(projectDir, '.godot'), { recursive: true });
    await writeFile(join(projectDir, '.godot', '.gdignore'), '', 'utf8');
    await fs.mkdir(join(projectDir, 'addons'), { recursive: true });
    const addonTarget = await fs.realpath(
        join(EDITOR_FIXTURE_DIR, 'addons', 'forgekit_core'),
    );
    await fs.symlink(addonTarget, join(projectDir, 'addons', 'forgekit_core'));
    return projectDir;
}

async function spawnGodotEditor(binary: string): Promise<SpawnedEditor> {
    const projectDir = await materializeEditorProject();
    const sandboxDir = await mkdtemp(join(tmpdir(), 'forgekit-e2e-cct-editor-user-'));
    const envOverride: NodeJS.ProcessEnv = {
        ...process.env,
        XDG_DATA_HOME: sandboxDir,
        APPDATA: sandboxDir,
        HOME: sandboxDir,
    };

    const args = ['--editor', '--headless', '--path', projectDir];
    const child = spawn(binary, args, {
        cwd: projectDir,
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

    const userDir = resolveSandboxedUserDir(
        envOverride,
        'ForgeKit MCP Editor Channel E2E',
    );
    const portFile = join(userDir, 'mcp_active_port.json');

    let editorPort: number;
    try {
        editorPort = await waitForEditorPort(portFile, PORT_FILE_TIMEOUT_MS);
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        try {
            child.kill();
        } catch {
            // ignore
        }
        await rm(sandboxDir, { recursive: true, force: true }).catch(() => undefined);
        await rm(projectDir, { recursive: true, force: true }).catch(() => undefined);
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
            }, 3_000).unref?.();
        });
        await rm(sandboxDir, { recursive: true, force: true }).catch(() => undefined);
        await rm(projectDir, { recursive: true, force: true }).catch(() => undefined);
    }

    return {
        child,
        editorPort,
        sandboxDir,
        projectDir,
        stdout: () => stdout,
        stderr: () => stderr,
        stop,
    };
}

async function spawnGodotRuntime(binary: string): Promise<SpawnedRuntime> {
    const sandboxDir = await mkdtemp(join(tmpdir(), 'forgekit-e2e-cct-runtime-'));
    const envOverride: NodeJS.ProcessEnv = {
        ...process.env,
        XDG_DATA_HOME: sandboxDir,
        APPDATA: sandboxDir,
        HOME: sandboxDir,
    };

    const args = ['--headless', '--path', RUNTIME_FIXTURE_DIR, '--mcp-bridge'];
    const child = spawn(binary, args, {
        cwd: RUNTIME_FIXTURE_DIR,
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

    const userDir = resolveSandboxedUserDir(
        envOverride,
        'ForgeKit MCP Runtime Bridge E2E',
    );
    const portFile = join(userDir, 'mcp_active_port.json');

    let runtimePort: number;
    try {
        runtimePort = await waitForRuntimePort(portFile, PORT_FILE_TIMEOUT_MS);
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        try {
            child.kill();
        } catch {
            // ignore
        }
        await rm(sandboxDir, { recursive: true, force: true }).catch(() => undefined);
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
            }, 3_000).unref?.();
        });
        await rm(sandboxDir, { recursive: true, force: true }).catch(() => undefined);
    }

    return {
        child,
        runtimePort,
        sandboxDir,
        projectDir: RUNTIME_FIXTURE_DIR,
        stdout: () => stdout,
        stderr: () => stderr,
        stop,
    };
}

interface CrossChannelHarness {
    editor: SpawnedEditor;
    runtime: SpawnedRuntime;
    editorClient: EditorWsClient;
    runtimeClient: RuntimeUdpClient;
    crossExecutor: CrossExecutor;
    teardown(): Promise<void>;
}

async function startCrossChannelHarness(binary: string): Promise<CrossChannelHarness> {
    // Spawn both processes in parallel — they use disjoint sandbox dirs
    // and disjoint port ranges so concurrent boot is safe.
    const [editor, runtime] = await Promise.all([
        spawnGodotEditor(binary),
        spawnGodotRuntime(binary),
    ]);

    const metrics = new Metrics();
    const editorClient = new EditorWsClient({
        metrics,
        host: '127.0.0.1',
        range: { start: editor.editorPort, end: editor.editorPort },
        enableHeartbeat: false,
        enableAutoReconnect: false,
    });
    const runtimeClient = new RuntimeUdpClient({
        metrics,
        host: '127.0.0.1',
        range: { start: runtime.runtimePort, end: runtime.runtimePort },
        enableHeartbeat: false,
        enableAutoReconnect: false,
    });

    await Promise.all([editorClient.connect(), runtimeClient.connect()]);

    const crossExecutor = new CrossExecutor({
        editorClient,
        runtimeClient,
    });

    return {
        editor,
        runtime,
        editorClient,
        runtimeClient,
        crossExecutor,
        async teardown(): Promise<void> {
            try {
                editorClient.disconnect();
            } catch {
                // ignore
            }
            try {
                runtimeClient.disconnect();
            } catch {
                // ignore
            }
            await Promise.all([editor.stop(), runtime.stop()]);
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

async function readInventoryCount(
    client: RuntimeUdpClient,
    itemId: string,
): Promise<number> {
    const reply = (await callWithTimeout(
        client.send('inventory.get_count', { item_id: itemId }),
        RPC_TIMEOUT_MS,
        `inventory.get_count(${itemId})`,
    )) as InventoryCountResult;
    return reply.count;
}

async function clearRuntimeInventory(client: RuntimeUdpClient): Promise<void> {
    await callWithTimeout(
        client.send('inventory.clear', {}),
        RPC_TIMEOUT_MS,
        'inventory.clear (reset)',
    );
}

const binary = godotBinary();
// `describe.skipIf` matches the existing E2E pattern in this package.
// When Godot is missing the entire suite is skipped so CI lanes that
// cannot install the engine still pass green.
const describeOrSkip = binary === null ? describe.skip : describe;

describeOrSkip('E2E — cross-channel transaction atomicity', () => {
    let harness: CrossChannelHarness;
    let baselineScene: string;

    beforeAll(async () => {
        harness = await startCrossChannelHarness(binary as string);
        baselineScene = await readFile(
            join(EDITOR_FIXTURE_DIR, EDITOR_SCENE_REL_PATH),
            'utf8',
        );
    }, 180_000);

    afterAll(async () => {
        if (harness !== undefined) {
            await harness.teardown();
        }
    });

    it('commits editor + runtime mutations atomically across both channels', async () => {
        await clearRuntimeInventory(harness.runtimeClient);

        const begin = (await callWithTimeout(
            harness.crossExecutor.invoke('transaction.begin', {
                name: 'cross_channel_commit',
            }),
            RPC_TIMEOUT_MS,
            'transaction.begin (commit scenario)',
        )) as { transaction_id: number | string };
        expect(begin.transaction_id).toBeDefined();
        const transactionId = begin.transaction_id;

        // Editor mutation 1: open the scene.
        const opened = (await callWithTimeout(
            harness.editorClient.send('scene.open', {
                scene_path: EDITOR_SCENE_RES_PATH,
            }),
            RPC_TIMEOUT_MS,
            'scene.open (commit scenario)',
        )) as { node_count: number; root_path: string };
        expect(opened.node_count).toBeGreaterThanOrEqual(1);

        // Editor mutation 2: write the new position.
        await callWithTimeout(
            harness.editorClient.send('node.set_property', {
                scene_path: EDITOR_SCENE_RES_PATH,
                node_path: EDITOR_NODE_PATH,
                property: 'position',
                value: `Vector2(${COMMIT_POSITION.x}, ${COMMIT_POSITION.y})`,
                transaction_id: transactionId,
            }),
            RPC_TIMEOUT_MS,
            'node.set_property (commit scenario)',
        );

        // Editor mutation 3: persist to disk.
        await callWithTimeout(
            harness.editorClient.send('scene.save', {
                scene_path: EDITOR_SCENE_RES_PATH,
            }),
            RPC_TIMEOUT_MS,
            'scene.save (commit scenario)',
        );

        // Runtime mutation 1: add iron_ore.
        const addA = (await callWithTimeout(
            harness.runtimeClient.send('inventory.add_item', {
                item_id: RUNTIME_ITEM_A,
                amount: RUNTIME_ITEM_A_AMOUNT,
            }),
            RPC_TIMEOUT_MS,
            'inventory.add_item iron_ore (commit scenario)',
        )) as InventoryCountResult;
        expect(addA.count).toBe(RUNTIME_ITEM_A_AMOUNT);

        // Runtime mutation 2: add iron_ingot.
        const addB = (await callWithTimeout(
            harness.runtimeClient.send('inventory.add_item', {
                item_id: RUNTIME_ITEM_B,
                amount: RUNTIME_ITEM_B_AMOUNT,
            }),
            RPC_TIMEOUT_MS,
            'inventory.add_item iron_ingot (commit scenario)',
        )) as InventoryCountResult;
        expect(addB.count).toBe(RUNTIME_ITEM_B_AMOUNT);

        const commit = (await callWithTimeout(
            harness.crossExecutor.invoke('transaction.commit', {
                transaction_id: transactionId,
            }),
            RPC_TIMEOUT_MS,
            'transaction.commit (commit scenario)',
        )) as { committed?: boolean };
        expect(commit.committed).toBe(true);

        // Editor side: the saved scene file on disk reflects the new
        // value verbatim.
        const scenePath = join(harness.editor.projectDir, EDITOR_SCENE_REL_PATH);
        const after = await readFile(scenePath, 'utf8');
        expect(after).toMatch(
            new RegExp(
                `position\\s*=\\s*Vector2\\(\\s*${COMMIT_POSITION.x}\\s*,\\s*${COMMIT_POSITION.y}\\s*\\)`,
            ),
        );

        // Runtime side: both items are visible in the live inventory.
        const snapshot = (await callWithTimeout(
            harness.runtimeClient.send('inventory.snapshot', {}),
            RPC_TIMEOUT_MS,
            'inventory.snapshot (commit scenario)',
        )) as InventorySnapshotResult;
        expect(snapshot.items[RUNTIME_ITEM_A]).toBe(RUNTIME_ITEM_A_AMOUNT);
        expect(snapshot.items[RUNTIME_ITEM_B]).toBe(RUNTIME_ITEM_B_AMOUNT);
    }, 180_000);

    it('rolls back to the pre-transaction baseline when commit fails mid-sequence', async () => {
        // Reset both channels to a known-empty baseline before the
        // scenario: clear the runtime inventory and reopen the scene
        // so undo state is fresh.
        await clearRuntimeInventory(harness.runtimeClient);
        await callWithTimeout(
            harness.editorClient.send('scene.open', {
                scene_path: EDITOR_SCENE_RES_PATH,
            }),
            RPC_TIMEOUT_MS,
            'scene.open (rollback scenario, baseline)',
        );
        // Reset the file on disk to the original baseline so the
        // post-rollback comparison is meaningful even if the previous
        // scenario left a mutated copy.
        const scenePath = join(harness.editor.projectDir, EDITOR_SCENE_REL_PATH);
        await writeFile(scenePath, baselineScene, 'utf8');

        const begin = (await callWithTimeout(
            harness.crossExecutor.invoke('transaction.begin', {
                name: 'cross_channel_rollback',
            }),
            RPC_TIMEOUT_MS,
            'transaction.begin (rollback scenario)',
        )) as { transaction_id: number | string };
        const transactionId = begin.transaction_id;

        // Successful editor mutation that the rollback must undo.
        await callWithTimeout(
            harness.editorClient.send('node.set_property', {
                scene_path: EDITOR_SCENE_RES_PATH,
                node_path: EDITOR_NODE_PATH,
                property: 'position',
                value: `Vector2(${ROLLBACK_POSITION.x}, ${ROLLBACK_POSITION.y})`,
                transaction_id: transactionId,
            }),
            RPC_TIMEOUT_MS,
            'node.set_property (rollback scenario, before failure)',
        );

        // Successful runtime mutation. The runtime channel does not
        // own undo state, so the test is responsible for compensating
        // these mutations on rollback.
        const addedRuntime = (await callWithTimeout(
            harness.runtimeClient.send('inventory.add_item', {
                item_id: RUNTIME_ITEM_A,
                amount: RUNTIME_ITEM_A_AMOUNT,
            }),
            RPC_TIMEOUT_MS,
            'inventory.add_item (rollback scenario, before failure)',
        )) as InventoryCountResult;
        expect(addedRuntime.count).toBe(RUNTIME_ITEM_A_AMOUNT);

        // Mid-sequence failure: target a non-existent node so the
        // backend rejects the call. The error must surface to the
        // caller so the orchestrator knows to roll back.
        let midFailure: unknown;
        try {
            await callWithTimeout(
                harness.editorClient.send('node.set_property', {
                    scene_path: EDITOR_SCENE_RES_PATH,
                    node_path: 'NoSuchNode',
                    property: 'position',
                    value: 'Vector2(0, 0)',
                    transaction_id: transactionId,
                }),
                RPC_TIMEOUT_MS,
                'node.set_property (rollback scenario, intentional failure)',
            );
        } catch (err) {
            midFailure = err;
        }
        expect(
            midFailure,
            'expected the mid-sequence mutation against a non-existent node to fail',
        ).toBeDefined();

        // Compensating runtime mutation. The runtime channel does not
        // track undo callables, so the orchestrator (this test) is
        // responsible for inverting any runtime mutations applied
        // before the failure. This mirrors the production flow where
        // the MCP server mirrors a registered compensator on
        // rollback.
        const removedRuntime = (await callWithTimeout(
            harness.runtimeClient.send('inventory.remove_item', {
                item_id: RUNTIME_ITEM_A,
                amount: RUNTIME_ITEM_A_AMOUNT,
            }),
            RPC_TIMEOUT_MS,
            'inventory.remove_item (rollback compensation)',
        )) as InventoryCountResult;
        expect(removedRuntime.count).toBe(0);

        // Editor-side rollback: the cross executor forwards the call
        // to the editor which replays the registered undo callables in
        // LIFO order.
        const rolled = (await callWithTimeout(
            harness.crossExecutor.invoke('transaction.rollback', {
                transaction_id: transactionId,
            }),
            RPC_TIMEOUT_MS,
            'transaction.rollback (rollback scenario)',
        )) as { rolled_back?: boolean };
        expect(rolled.rolled_back).toBe(true);

        // Persist the rolled-back scene so the on-disk state reflects
        // the editor's recovered state. Without this save the file
        // on disk is whatever was last written, not what the editor
        // currently holds in memory.
        await callWithTimeout(
            harness.editorClient.send('scene.save', {
                scene_path: EDITOR_SCENE_RES_PATH,
            }),
            RPC_TIMEOUT_MS,
            'scene.save (rollback scenario, post-rollback)',
        );

        // Editor side: the saved file matches the pre-transaction
        // baseline byte-for-byte.
        const after = await readFile(scenePath, 'utf8');
        expect(after).toBe(baselineScene);

        // Runtime side: the inventory returned to its pre-transaction
        // empty state.
        const snapshot = (await callWithTimeout(
            harness.runtimeClient.send('inventory.snapshot', {}),
            RPC_TIMEOUT_MS,
            'inventory.snapshot (rollback scenario, post-rollback)',
        )) as InventorySnapshotResult;
        expect(await readInventoryCount(harness.runtimeClient, RUNTIME_ITEM_A)).toBe(0);
        expect(await readInventoryCount(harness.runtimeClient, RUNTIME_ITEM_B)).toBe(0);
        expect(Object.keys(snapshot.items).filter((k) => snapshot.items[k] > 0)).toEqual([]);
    }, 180_000);
});
