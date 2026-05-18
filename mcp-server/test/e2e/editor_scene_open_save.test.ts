/**
 * E2E test — editor-channel scene operation via the WebSocket bridge.
 *
 * Spawns a real Godot 4.6 process with `--editor --headless` against a
 * fixture project that enables the ForgeKit Core addon, waits until the
 * editor port appears in `user://mcp_active_port.json`, connects an
 * `EditorWsClient`, then exercises two scenarios that mirror the
 * editor-channel contract declared in the spec:
 *
 *   1. Open + mutate + save round trip:
 *        - `scene.open(scene_path)` opens the fixture scene in the
 *          editor, returning `{node_count, root_path}`.
 *        - `node.set_property(scene_path, node_path, property, value)`
 *          mutates the root node's `position` to a fresh Vector2 value
 *          and returns the new value.
 *        - `scene.save()` serialises the open scene back to disk.
 *        - The saved `.tscn` file on disk must contain the new property
 *          value verbatim (line `position = Vector2(<x>, <y>)`).
 *
 *   2. Undo round trip:
 *        - After the save above, `editor.undo()` rolls the mutation
 *          back through `EditorUndoRedoManager`. A subsequent
 *          `scene.save()` serialises the reverted scene back to disk.
 *        - The saved `.tscn` file must once again equal the byte-for-
 *          byte baseline so a single undo restores the file.
 *
 * Validates: Wymagania 5.2, 5.3, 6.1, 6.3.
 *
 * The test gracefully skips when no Godot binary is available on the
 * host (CI lanes that cannot install the engine). When Godot is
 * available the test runs end-to-end against the live editor.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Metrics } from '../../src/metrics.js';
import { EditorWsClient } from '../../src/transports/editor_ws_client.js';
import { resolveUserLicenseDir } from '../../src/licensing/license_directory.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Fixture project directory bundled with the repository. */
const FIXTURE_PROJECT_DIR = resolve(HERE, '../fixtures/editor_channel_project');

/** Scene file inside the fixture project that the test mutates. */
const FIXTURE_SCENE_RES_PATH = 'res://sample_scene.tscn';
const FIXTURE_SCENE_REL_PATH = 'sample_scene.tscn';
const FIXTURE_NODE_PATH = 'Root';

/** New Vector2 value the test writes into the root node's `position`. */
const MUTATED_POSITION = { x: 123, y: 456 } as const;

/** Maximum wall-clock to wait for the Godot port file to appear. */
const PORT_FILE_TIMEOUT_MS = 60_000;

/** Polling interval while waiting for the port file. */
const PORT_FILE_POLL_MS = 250;

/** Per-scenario RPC call timeout. */
const RPC_TIMEOUT_MS = 15_000;

function godotBinary(): string | null {
    const fromEnv = process.env.GODOT_BIN;
    if (fromEnv !== undefined && fromEnv !== '') {
        return fromEnv;
    }
    // Fall back to the well-known Homebrew location used in this repo.
    if (existsSync('/opt/homebrew/bin/godot')) {
        return '/opt/homebrew/bin/godot';
    }
    return null;
}

/**
 * Resolve the Godot `user://` directory the spawned process will write
 * to. Each test run gets a private dir via `XDG_DATA_HOME` / `APPDATA`
 * overrides so concurrent runs do not stomp on each other.
 */
function resolveSandboxedUserDir(envOverride: NodeJS.ProcessEnv): string {
    return resolveUserLicenseDir({
        platform: process.platform,
        env: envOverride,
        homedir: envOverride.HOME ?? process.env.HOME ?? '',
        projectName: 'ForgeKit MCP Editor Channel E2E',
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

interface SpawnedGodot {
    child: ChildProcess;
    editorPort: number;
    sandboxDir: string;
    projectDir: string;
    stdout: () => string;
    stderr: () => string;
    stop(): Promise<void>;
}

/**
 * Copy the fixture project into a fresh temp directory so the test can
 * mutate `sample_scene.tscn` on disk without dirtying the workspace.
 * The `addons/` symlink is recreated to point at the live workspace
 * addon tree.
 */
async function materializeProjectCopy(): Promise<string> {
    const projectDir = await mkdtemp(join(tmpdir(), 'forgekit-e2e-editor-project-'));
    // project.godot
    await copyFile(
        join(FIXTURE_PROJECT_DIR, 'project.godot'),
        join(projectDir, 'project.godot'),
    );
    // sample_scene.tscn
    await copyFile(
        join(FIXTURE_PROJECT_DIR, FIXTURE_SCENE_REL_PATH),
        join(projectDir, FIXTURE_SCENE_REL_PATH),
    );
    // .godot/.gdignore so the editor does not pollute the source tree.
    const fs = await import('node:fs/promises');
    await fs.mkdir(join(projectDir, '.godot'), { recursive: true });
    await writeFile(join(projectDir, '.godot', '.gdignore'), '', 'utf8');
    // Symlink the live addons/forgekit_core into the temp project so
    // the editor plugin loads from the workspace. Resolve the symlink
    // ahead of time so the temp project points at the real on-disk
    // addon root rather than chaining through another symlink.
    await fs.mkdir(join(projectDir, 'addons'), { recursive: true });
    const addonTarget = await fs.realpath(
        join(FIXTURE_PROJECT_DIR, 'addons', 'forgekit_core'),
    );
    await fs.symlink(addonTarget, join(projectDir, 'addons', 'forgekit_core'));
    return projectDir;
}

async function spawnGodotEditor(binary: string): Promise<SpawnedGodot> {
    const projectDir = await materializeProjectCopy();
    const sandboxDir = await mkdtemp(join(tmpdir(), 'forgekit-e2e-editor-user-'));
    const envOverride: NodeJS.ProcessEnv = {
        ...process.env,
        XDG_DATA_HOME: sandboxDir,
        APPDATA: sandboxDir,
        HOME: sandboxDir,
    };

    // `--editor --headless` boots the editor without opening a window
    // so the editor plugin runs and the WebSocket server starts on a
    // port in the 6010-6019 range.
    const args = [
        '--editor',
        '--headless',
        '--path',
        projectDir,
    ];

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

    const userDir = resolveSandboxedUserDir(envOverride);
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

interface EditorBridge {
    godot: SpawnedGodot;
    client: EditorWsClient;
    teardown(): Promise<void>;
}

async function startEditorBridge(binary: string): Promise<EditorBridge> {
    const godot = await spawnGodotEditor(binary);
    const metrics = new Metrics();
    const client = new EditorWsClient({
        metrics,
        host: '127.0.0.1',
        range: { start: godot.editorPort, end: godot.editorPort },
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

const binary = godotBinary();
// `describe.skipIf` is the right primitive: when Godot is not on the
// host, the editor channel cannot be exercised end-to-end. Tests still
// fail loudly on machines that *do* have Godot when the editor channel
// regresses.
const describeOrSkip = binary === null ? describe.skip : describe;

describeOrSkip('E2E — editor channel scene round trip via WebSocket bridge', () => {
    let bridge: EditorBridge;

    beforeAll(async () => {
        bridge = await startEditorBridge(binary as string);
    }, 90_000);

    afterAll(async () => {
        if (bridge !== undefined) {
            await bridge.teardown();
        }
    });

    it('opens, mutates and saves a scene; the file on disk reflects the new value', async () => {
        const scenePath = join(bridge.godot.projectDir, FIXTURE_SCENE_REL_PATH);
        const baseline = await readFile(scenePath, 'utf8');
        // Sanity-check the baseline: the fixture starts at (0, 0).
        expect(baseline).toMatch(/position = Vector2\(0, 0\)/);

        const opened = (await callWithTimeout(
            bridge.client.send('scene.open', { scene_path: FIXTURE_SCENE_RES_PATH }),
            RPC_TIMEOUT_MS,
            'scene.open',
        )) as { node_count: number; root_path: string };
        expect(opened.node_count).toBeGreaterThanOrEqual(1);
        expect(opened.root_path).toBe('/root/Root');

        const mutated = (await callWithTimeout(
            bridge.client.send('node.set_property', {
                scene_path: FIXTURE_SCENE_RES_PATH,
                node_path: FIXTURE_NODE_PATH,
                property: 'position',
                value: `Vector2(${MUTATED_POSITION.x}, ${MUTATED_POSITION.y})`,
            }),
            RPC_TIMEOUT_MS,
            'node.set_property',
        )) as { property: string; new_value: unknown };
        expect(mutated.property).toBe('position');

        await callWithTimeout(
            bridge.client.send('scene.save', { scene_path: FIXTURE_SCENE_RES_PATH }),
            RPC_TIMEOUT_MS,
            'scene.save',
        );

        const after = await readFile(scenePath, 'utf8');
        expect(after).toMatch(
            new RegExp(
                `position\\s*=\\s*Vector2\\(\\s*${MUTATED_POSITION.x}\\s*,\\s*${MUTATED_POSITION.y}\\s*\\)`,
            ),
        );
    }, 90_000);

    it('rolls the mutation back through editor.undo and the saved file matches the baseline', async () => {
        const scenePath = join(bridge.godot.projectDir, FIXTURE_SCENE_REL_PATH);
        const baseline = await readFile(
            join(FIXTURE_PROJECT_DIR, FIXTURE_SCENE_REL_PATH),
            'utf8',
        );

        const undone = (await callWithTimeout(
            bridge.client.send('editor.undo', {}),
            RPC_TIMEOUT_MS,
            'editor.undo',
        )) as { undone: boolean; action_name: string };
        expect(undone.undone).toBe(true);
        // The undo action created by `node.set_property` on a Node2D's
        // `position` field is named after the MCP tool (Wymaganie 6.2).
        expect(undone.action_name).toMatch(/MCP:.*node\.set_property/);

        await callWithTimeout(
            bridge.client.send('scene.save', { scene_path: FIXTURE_SCENE_RES_PATH }),
            RPC_TIMEOUT_MS,
            'scene.save (post-undo)',
        );

        const after = await readFile(scenePath, 'utf8');
        expect(after).toBe(baseline);
    }, 90_000);
});
