/**
 * Profile + license filtering at runtime (refresh).
 *
 * Covers the four scenarios required by task 8.13.3:
 *   1. No license active — RPG subsystem tool is not callable; MCP
 *      `tools/call` returns the JSON-RPC -32024 PROFILE_TOOL_FILTERED
 *      envelope with `data.required_modules` and a
 *      `data.suggestion: "activate license: <module>"` hint.
 *   2. License activated mid-session — the file watcher started by
 *      `watchLicenseDir` fires when `<license_dir>/forgekit_rpg.key`
 *      appears on disk. The unlocked-modules set is refreshed in
 *      place and the next `tools/call` for the same RPG tool succeeds
 *      without restarting the server.
 *   3. License expired — the watcher fires when the `.key` file is
 *      deleted, the unlocked-modules set drops the affected modules,
 *      and the next `tools/call` for the RPG tool again returns
 *      -32024 PROFILE_TOOL_FILTERED.
 *   4. Profile mismatch — a tool that exists in `profiles.json` but
 *      whose module is not selected by the active profile (and is
 *      not unlocked by license) returns -32024 PROFILE_TOOL_FILTERED.
 *      Tools that do not exist in `profiles.json` at all keep
 *      returning -32601 Method not found.
 *
 * Uses the same in-memory MCP transport pattern as
 * `test/server/tools_list_call.test.ts` so the assertions exercise
 * the real SDK request pipeline.
 */

import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import {
    registerToolHandlers,
    type ChannelDispatcher,
    type ToolSchema,
} from '../../src/server/tool_request_handlers.js';
import type { DispatchResult } from '../../src/stdio_bridge.js';
import type { ProfilesFile, ToolModule } from '../../src/profiles.js';
import {
    loadActiveLicenses,
    unlockedModulesFromLicenses,
    watchLicenseDir,
} from '../../src/licensing/startup.js';

// ---------- fixtures ---------------------------------------------------

const FIXTURE_PROFILES: ProfilesFile = {
    version: 'test-1.0',
    tools: [
        {
            name: 'project.info',
            scope: 'core',
            channel: 'editor',
            module: 'core-minimal',
        },
        {
            name: 'scene.open',
            scope: 'core',
            channel: 'editor',
            module: 'core-minimal',
        },
        {
            name: 'node.add',
            scope: 'core',
            channel: 'editor',
            module: 'core',
        },
        {
            name: 'combat.create_hitbox',
            scope: 'module',
            channel: 'runtime',
            module: 'combat',
        },
        {
            name: 'crafting.execute',
            scope: 'module',
            channel: 'runtime',
            module: 'crafting',
        },
    ],
};

const FIXTURE_SCHEMAS: ReadonlyMap<string, ToolSchema> = new Map<
    string,
    ToolSchema
>([
    [
        'project.info',
        {
            name: 'project.info',
            description: 'Returns minimal project metadata.',
            inputSchema: {
                type: 'object',
                properties: {},
                additionalProperties: false,
            },
        },
    ],
    [
        'scene.open',
        {
            name: 'scene.open',
            description: 'Opens a scene resource by path.',
            inputSchema: {
                type: 'object',
                properties: { path: { type: 'string', minLength: 1 } },
                required: ['path'],
                additionalProperties: false,
            },
        },
    ],
    [
        'node.add',
        {
            name: 'node.add',
            description: 'Adds a node to the active scene.',
            inputSchema: {
                type: 'object',
                properties: {
                    parent: { type: 'string' },
                    type: { type: 'string' },
                },
                required: ['parent', 'type'],
                additionalProperties: false,
            },
        },
    ],
    [
        'combat.create_hitbox',
        {
            name: 'combat.create_hitbox',
            description: 'Creates a hitbox volume on the active actor.',
            inputSchema: {
                type: 'object',
                properties: {
                    actor_path: { type: 'string' },
                    dimension: { type: 'string', enum: ['2d', '3d'] },
                },
                required: ['actor_path', 'dimension'],
                additionalProperties: false,
            },
        },
    ],
    [
        'crafting.execute',
        {
            name: 'crafting.execute',
            description: 'Executes a crafting recipe.',
            inputSchema: {
                type: 'object',
                properties: { recipe_id: { type: 'string' } },
                required: ['recipe_id'],
                additionalProperties: false,
            },
        },
    ],
]);

// ---------- helpers ----------------------------------------------------

interface HarnessOptions {
    readonly profile: 'Full' | 'Lite' | 'Minimal' | 'RPG-only';
    readonly getUnlockedModules: () => ReadonlySet<ToolModule | string>;
    readonly dispatcher: ChannelDispatcher;
}

interface Harness {
    readonly client: Client;
    readonly server: Server;
    close(): Promise<void>;
}

async function buildHarness(options: HarnessOptions): Promise<Harness> {
    const server = new Server(
        { name: 'test-server', version: '0.0.0' },
        { capabilities: { tools: { listChanged: true } } },
    );
    registerToolHandlers(server, {
        profiles: FIXTURE_PROFILES,
        profile: options.profile,
        getUnlockedModules: options.getUnlockedModules,
        schemas: FIXTURE_SCHEMAS,
        dispatcher: options.dispatcher,
    });

    const [serverTransport, clientTransport] =
        InMemoryTransport.createLinkedPair();

    const client = new Client(
        { name: 'test-client', version: '0.0.0' },
        { capabilities: {} },
    );

    await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
    ]);

    return {
        client,
        server,
        async close() {
            await client.close();
            await server.close();
        },
    };
}

const okDispatcher: ChannelDispatcher = {
    async dispatch(method: string, _params: unknown): Promise<DispatchResult> {
        return { kind: 'ok', result: { ok: true, method } };
    },
};

const RPG_KEY_BODY = JSON.stringify({
    license_id: 'forgekit_rpg',
    activated_at: '2025-01-02T03:04:05',
    fingerprint: 'a'.repeat(64),
});

/** Polls `predicate` every `intervalMs` until it returns true or `timeoutMs` elapses. */
async function waitFor(
    predicate: () => boolean,
    timeoutMs = 2_000,
    intervalMs = 25,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) {
            return;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
    }
    if (!predicate()) {
        throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    }
}

// ---------- tests ------------------------------------------------------

describe('tools/call — profile + license filtering at runtime', () => {
    it('1. without an active license the RPG tool is not callable and returns -32024 PROFILE_TOOL_FILTERED', async () => {
        const unlocked: Set<string> = new Set();
        const harness = await buildHarness({
            profile: 'RPG-only',
            getUnlockedModules: () => unlocked,
            dispatcher: okDispatcher,
        });
        try {
            await expect(
                harness.client.callTool({
                    name: 'combat.create_hitbox',
                    arguments: {
                        actor_path: '/root/Player',
                        dimension: '2d',
                    },
                }),
            ).rejects.toMatchObject({
                code: -32024,
                data: expect.objectContaining({
                    code: -32024,
                    method: 'combat.create_hitbox',
                    required_modules: ['combat'],
                    suggestion: 'activate license: combat',
                }),
            });
        } finally {
            await harness.close();
        }
    });

    it('2. license activated mid-session: file watcher refreshes the unlocked set and the RPG tool becomes callable', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'forgekit-watch-'));
        let unlocked: ReadonlySet<string> = new Set();
        let refreshes = 0;

        const watcher = await watchLicenseDir(dir, async () => {
            const records = await loadActiveLicenses(dir);
            unlocked = unlockedModulesFromLicenses(records);
            refreshes += 1;
        });

        const harness = await buildHarness({
            profile: 'RPG-only',
            getUnlockedModules: () => unlocked,
            dispatcher: okDispatcher,
        });
        try {
            // Sanity check: before activation the call is filtered.
            await expect(
                harness.client.callTool({
                    name: 'combat.create_hitbox',
                    arguments: {
                        actor_path: '/root/Player',
                        dimension: '2d',
                    },
                }),
            ).rejects.toMatchObject({ code: -32024 });

            // Activate by writing the license file the watcher monitors.
            await writeFile(join(dir, 'forgekit_rpg.key'), RPG_KEY_BODY, 'utf8');
            await waitFor(() => refreshes > 0 && unlocked.has('combat'));

            const result = await harness.client.callTool({
                name: 'combat.create_hitbox',
                arguments: {
                    actor_path: '/root/Player',
                    dimension: '2d',
                },
            });
            expect(result.isError).not.toBe(true);
            expect(result.content).toEqual([
                {
                    type: 'text',
                    text: JSON.stringify({
                        ok: true,
                        method: 'combat.create_hitbox',
                    }),
                },
            ]);
        } finally {
            await harness.close();
            await watcher.close();
            await rm(dir, { recursive: true, force: true });
        }
    });

    it('3. license expired: file watcher removes the modules and the RPG tool returns -32024 again', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'forgekit-expire-'));
        await writeFile(join(dir, 'forgekit_rpg.key'), RPG_KEY_BODY, 'utf8');

        let unlocked: ReadonlySet<string> = unlockedModulesFromLicenses(
            await loadActiveLicenses(dir),
        );
        let refreshes = 0;

        const watcher = await watchLicenseDir(dir, async () => {
            const records = await loadActiveLicenses(dir);
            unlocked = unlockedModulesFromLicenses(records);
            refreshes += 1;
        });

        const harness = await buildHarness({
            profile: 'RPG-only',
            getUnlockedModules: () => unlocked,
            dispatcher: okDispatcher,
        });
        try {
            // Sanity check: with the license file present the call succeeds.
            const ok = await harness.client.callTool({
                name: 'combat.create_hitbox',
                arguments: {
                    actor_path: '/root/Player',
                    dimension: '2d',
                },
            });
            expect(ok.isError).not.toBe(true);

            // Expire by deleting the key file.
            await unlink(join(dir, 'forgekit_rpg.key'));
            await waitFor(() => refreshes > 0 && !unlocked.has('combat'));

            await expect(
                harness.client.callTool({
                    name: 'combat.create_hitbox',
                    arguments: {
                        actor_path: '/root/Player',
                        dimension: '2d',
                    },
                }),
            ).rejects.toMatchObject({
                code: -32024,
                data: expect.objectContaining({
                    required_modules: ['combat'],
                    suggestion: 'activate license: combat',
                }),
            });
        } finally {
            await harness.close();
            await watcher.close();
            await rm(dir, { recursive: true, force: true });
        }
    });

    it('4. profile mismatch: a tool whose module is not selected by the active profile returns -32024', async () => {
        // `node.add` belongs to module "core" which is excluded by the
        // Minimal profile and is not an RPG subsystem so license unlock
        // does not surface it either.
        const harness = await buildHarness({
            profile: 'Minimal',
            getUnlockedModules: () => new Set<string>(),
            dispatcher: okDispatcher,
        });
        try {
            await expect(
                harness.client.callTool({
                    name: 'node.add',
                    arguments: { parent: '/root', type: 'Node2D' },
                }),
            ).rejects.toMatchObject({
                code: -32024,
                data: expect.objectContaining({
                    code: -32024,
                    method: 'node.add',
                    required_modules: ['core'],
                    suggestion: 'activate license: core',
                }),
            });
        } finally {
            await harness.close();
        }
    });

    it('4b. truly unknown tool names (not in profiles.json at all) keep returning -32601 Method not found', async () => {
        const harness = await buildHarness({
            profile: 'Minimal',
            getUnlockedModules: () => new Set<string>(),
            dispatcher: okDispatcher,
        });
        try {
            await expect(
                harness.client.callTool({
                    name: 'this.tool.does.not.exist',
                    arguments: {},
                }),
            ).rejects.toMatchObject({
                code: -32601,
                data: expect.objectContaining({ code: -32601 }),
            });
        } finally {
            await harness.close();
        }
    });
});

describe('watchLicenseDir', () => {
    let dir: string;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), 'forgekit-watch-unit-'));
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it('fires the listener when a `.key` file is created', async () => {
        let count = 0;
        const watcher = await watchLicenseDir(dir, () => {
            count += 1;
        });
        try {
            await writeFile(
                join(dir, 'forgekit_rpg.key'),
                RPG_KEY_BODY,
                'utf8',
            );
            await waitFor(() => count > 0);
            expect(count).toBeGreaterThan(0);
        } finally {
            await watcher.close();
        }
    });

    it('fires the listener when a `.key` file is removed', async () => {
        await writeFile(
            join(dir, 'forgekit_rpg.key'),
            RPG_KEY_BODY,
            'utf8',
        );
        let count = 0;
        const watcher = await watchLicenseDir(dir, () => {
            count += 1;
        });
        try {
            await unlink(join(dir, 'forgekit_rpg.key'));
            await waitFor(() => count > 0);
            expect(count).toBeGreaterThan(0);
        } finally {
            await watcher.close();
        }
    });

    it('does not throw when the directory does not yet exist; the watcher polls the parent', async () => {
        const missing = join(dir, 'not-yet-here');
        let count = 0;
        const watcher = await watchLicenseDir(missing, () => {
            count += 1;
        });
        try {
            await mkdir(missing, { recursive: true });
            await writeFile(
                join(missing, 'forgekit_rpg.key'),
                RPG_KEY_BODY,
                'utf8',
            );
            await waitFor(() => count > 0, 4_000);
            expect(count).toBeGreaterThan(0);
        } finally {
            await watcher.close();
        }
    });
});
