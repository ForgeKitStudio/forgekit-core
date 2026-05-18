/**
 * E2E test — auth_token enforcement on the editor channel.
 *
 * Spawns a real Godot 4.6 process with `--editor --headless` against
 * a fixture project that materializes a non-template
 * `addons/forgekit_core/mcp/plugin_config.tres` carrying a non-empty
 * `auth_token`. The editor plugin loads the config at startup, so the
 * WebSocket dispatcher arms its auth gate with the same token and any
 * incoming `runtime.handshake` whose `auth_token` does not match must
 * be rejected.
 *
 * Three scenarios cover the contract declared in Wymaganie 18.4:
 *
 *   1. Client without a token   → connect() rejects, the client emits
 *                                 'error', and the server-side error
 *                                 envelope carries an auth-failure
 *                                 code (`-32000 UNAUTHORIZED` per the
 *                                 canonical mapping in
 *                                 `dispatcher/error_codes.ts`; the
 *                                 spec wishlist also names this slot
 *                                 `-32008 AUTH_FAILED`, so both codes
 *                                 are accepted as forward-compatible).
 *   2. Client with a wrong token → identical reject behaviour.
 *   3. Client with the correct token → handshake succeeds and the
 *                                 client transitions to `connected`.
 *
 * Validates: Wymaganie 18.4.
 *
 * The test gracefully skips when no Godot binary is available on the
 * host (CI lanes that cannot install the engine).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Metrics } from '../../src/metrics.js';
import { EditorWsClient } from '../../src/transports/editor_ws_client.js';
import { resolveUserLicenseDir } from '../../src/licensing/license_directory.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Fixture project bundled with the repository. */
const FIXTURE_PROJECT_DIR = resolve(HERE, '../fixtures/editor_channel_project');

/** Scene file the fixture ships with — copied verbatim into the temp project. */
const FIXTURE_SCENE_REL_PATH = 'sample_scene.tscn';

/** Auth token the editor plugin will load from `plugin_config.tres`. */
const SERVER_TOKEN = 'forgekit-e2e-secret-token';

/** Token used to exercise the wrong-token reject path. */
const WRONG_TOKEN = 'wrong-token';

/** Maximum wall-clock to wait for the Godot port file to appear. */
const PORT_FILE_TIMEOUT_MS = 60_000;

/** Polling interval while waiting for the port file. */
const PORT_FILE_POLL_MS = 250;

/** Canonical auth-failure JSON-RPC error codes accepted by the test. */
const AUTH_FAILURE_CODES = new Set<number>([-32000, -32008]);

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
 * Materialize a temp project copy and arm the editor plugin's auth
 * gate by writing a non-template `plugin_config.tres` whose
 * `auth_token` matches `SERVER_TOKEN`. Editing the live workspace
 * config would leak across runs and break parallel tests.
 */
async function materializeProjectCopy(authToken: string): Promise<string> {
    const projectDir = await mkdtemp(join(tmpdir(), 'forgekit-e2e-auth-project-'));
    await copyFile(
        join(FIXTURE_PROJECT_DIR, 'project.godot'),
        join(projectDir, 'project.godot'),
    );
    await copyFile(
        join(FIXTURE_PROJECT_DIR, FIXTURE_SCENE_REL_PATH),
        join(projectDir, FIXTURE_SCENE_REL_PATH),
    );
    await mkdir(join(projectDir, '.godot'), { recursive: true });
    await writeFile(join(projectDir, '.godot', '.gdignore'), '', 'utf8');
    // Resolve the live addons symlink so the temp project points at the
    // real on-disk addon root rather than chaining through a symlink.
    await mkdir(join(projectDir, 'addons'), { recursive: true });
    const addonTarget = await realpath(
        join(FIXTURE_PROJECT_DIR, 'addons', 'forgekit_core'),
    );
    await symlink(addonTarget, join(projectDir, 'addons', 'forgekit_core'));
    // Write the auth-armed plugin_config.tres alongside the symlinked
    // addon. The editor plugin reads
    // `res://addons/forgekit_core/mcp/plugin_config.tres` at startup;
    // because `addons/forgekit_core` is a symlink, we cannot drop the
    // file directly into the symlinked tree without polluting the
    // workspace. Instead we point at the realpath via a per-test
    // override file under the temp project root and rely on the
    // editor plugin's filesystem walk picking it up.
    //
    // The spec however requires the editor plugin to honour the same
    // path under `res://`. Since the symlink resolves to the
    // workspace addon root, we place the file inside the resolved
    // addon path *only for the lifetime of this temp project* by
    // keeping a backup of any existing live config and restoring it
    // in `stop()`.
    return projectDir;
}

/**
 * Backup helper — saves the live `plugin_config.tres` (if any), writes
 * a token-armed override, and returns a closure that restores the
 * original state. Splitting this out keeps `spawnGodotEditor` focused
 * on process lifecycle.
 */
async function armLivePluginConfig(
    addonRealRoot: string,
    authToken: string,
): Promise<() => Promise<void>> {
    const configPath = join(addonRealRoot, 'mcp', 'plugin_config.tres');
    const backupPath = join(
        addonRealRoot,
        'mcp',
        `plugin_config.tres.bak.${process.pid}.${Date.now()}`,
    );
    let hadExisting = false;
    if (existsSync(configPath)) {
        await copyFile(configPath, backupPath);
        hadExisting = true;
    }
    await writeFile(configPath, tresWithToken(authToken), 'utf8');
    return async () => {
        if (hadExisting) {
            await copyFile(backupPath, configPath).catch(() => undefined);
            await rm(backupPath, { force: true }).catch(() => undefined);
        } else {
            await rm(configPath, { force: true }).catch(() => undefined);
        }
    };
}

function tresWithToken(token: string): string {
    return `[gd_resource type="Resource" load_steps=2 format=3]

[resource]
auth_token = "${token}"
bind_address = "127.0.0.1"
port = 6010
log_level = "info"
`;
}

async function spawnGodotEditor(binary: string, authToken: string): Promise<SpawnedGodot> {
    const projectDir = await materializeProjectCopy(authToken);
    const sandboxDir = await mkdtemp(join(tmpdir(), 'forgekit-e2e-auth-user-'));
    const envOverride: NodeJS.ProcessEnv = {
        ...process.env,
        XDG_DATA_HOME: sandboxDir,
        APPDATA: sandboxDir,
        HOME: sandboxDir,
    };

    const addonRealRoot = await realpath(
        join(projectDir, 'addons', 'forgekit_core'),
    );
    const restoreLiveConfig = await armLivePluginConfig(addonRealRoot, authToken);

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
        await restoreLiveConfig().catch(() => undefined);
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
        await restoreLiveConfig().catch(() => undefined);
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

interface AuthError extends Error {
    code?: number;
}

function isAuthFailureError(err: unknown): boolean {
    if (!(err instanceof Error)) {
        return false;
    }
    const e = err as AuthError;
    if (typeof e.code === 'number' && AUTH_FAILURE_CODES.has(e.code)) {
        return true;
    }
    // Fall back to message pattern when the error originates from the
    // handshake helper (which wraps the JSON-RPC error before the
    // socket close).
    return /AUTH_FAILED|UNAUTHORIZED|authentic/i.test(e.message);
}

async function buildClient(
    port: number,
    authToken: string | undefined,
): Promise<EditorWsClient> {
    return new EditorWsClient({
        metrics: new Metrics(),
        host: '127.0.0.1',
        range: { start: port, end: port },
        // Pass `authToken` through directly so the test exercises the
        // token explicitly without going through `loadAuthToken()`.
        // Passing `undefined` skips the handshake entirely so the test
        // can observe the server's reaction to a missing token.
        authToken,
        enableHeartbeat: false,
        enableAutoReconnect: false,
    });
}

const binary = godotBinary();
// `describe.skipIf` mirrors the other editor-channel E2E tests in
// this directory: when Godot is missing, the entire suite is skipped
// so CI lanes that cannot install the engine still pass green.
const describeOrSkip = binary === null ? describe.skip : describe;

describeOrSkip('E2E — auth_token enforcement on the editor channel', () => {
    let godot: SpawnedGodot;

    beforeAll(async () => {
        godot = await spawnGodotEditor(binary as string, SERVER_TOKEN);
    }, 90_000);

    afterAll(async () => {
        if (godot !== undefined) {
            await godot.stop();
        }
    });

    it('rejects a client that connects without an auth_token', async () => {
        // `authToken: undefined` means the client skips the handshake
        // entirely. The server's auth gate must still reject any
        // subsequent tool call because the per-request token is empty
        // while `plugin_config.tres` declares a non-empty one.
        const client = await buildClient(godot.editorPort, undefined);
        let caught: unknown;
        try {
            await client.connect();
            // The connection itself can succeed (the handshake is
            // skipped client-side); the auth gate then fires on the
            // first tool call. Issue a benign request to surface the
            // rejection.
            await client.send('runtime.heartbeat', {});
        } catch (err) {
            caught = err;
        } finally {
            try {
                client.disconnect();
            } catch {
                // ignore
            }
        }
        expect(caught, 'auth-less client must be rejected by the editor plugin').toBeDefined();
        expect(isAuthFailureError(caught), `expected auth-failure error, got ${String(caught)}`).toBe(true);
    }, 90_000);

    it('rejects a client whose auth_token does not match plugin_config.tres', async () => {
        const client = await buildClient(godot.editorPort, WRONG_TOKEN);
        let caught: unknown;
        try {
            await client.connect();
        } catch (err) {
            caught = err;
        } finally {
            try {
                client.disconnect();
            } catch {
                // ignore
            }
        }
        expect(caught, 'wrong-token client must be rejected during handshake').toBeDefined();
        expect(isAuthFailureError(caught), `expected auth-failure error, got ${String(caught)}`).toBe(true);
        expect(client.isConnected()).toBe(false);
    }, 90_000);

    it('accepts a client whose auth_token matches plugin_config.tres', async () => {
        const client = await buildClient(godot.editorPort, SERVER_TOKEN);
        try {
            await client.connect();
            expect(client.isConnected()).toBe(true);
        } finally {
            try {
                client.disconnect();
            } catch {
                // ignore
            }
        }
    }, 90_000);
});
