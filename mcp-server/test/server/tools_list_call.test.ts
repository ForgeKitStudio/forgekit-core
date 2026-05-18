/**
 * Integration tests for the MCP `tools/list` and `tools/call` handlers
 * registered by `registerToolHandlers` (`src/server/tool_request_handlers.ts`).
 *
 * The tests stand up a real MCP `Server` and `Client` connected via
 * `InMemoryTransport.createLinkedPair()` so the handlers run through
 * the full SDK request pipeline (initialize handshake, capability
 * negotiation, request validation). For every scenario the test
 * supplies a fixture `ProfilesFile`, a fixture `ToolSchema` map, and
 * a stub `ChannelDispatcher` so the assertions stay focused on the
 * handler contract rather than the channel router internals.
 *
 * Scenarios:
 *   - `tools/list` returns every tool exposed by the active profile.
 *   - `tools/list` differs for `--profile RPG-only` with vs. without
 *     `forgekit_rpg.key`.
 *   - `tools/call` routes successful dispatches to a JSON-stringified
 *     text payload.
 *   - `tools/call` rejects params that fail Ajv validation with a
 *     JSON-RPC `-32602 InvalidParams` error envelope (`data.code`
 *     preserved).
 *   - `tools/call` returns the JSON-RPC `-32000` envelope when the
 *     dispatcher reports `channel-unavailable`.
 *   - `tools/call` returns the JSON-RPC `-32001` envelope when the
 *     dispatcher reports a channel timeout.
 */

import { describe, expect, it } from 'vitest';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

import {
    registerToolHandlers,
    type ChannelDispatcher,
    type ToolSchema,
} from '../../src/server/tool_request_handlers.js';
import type { DispatchResult } from '../../src/stdio_bridge.js';
import type { ProfilesFile } from '../../src/profiles.js';

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
            outputSchema: {
                type: 'object',
                additionalProperties: true,
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
            outputSchema: {
                type: 'object',
                additionalProperties: true,
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
                    name: { type: 'string' },
                },
                required: ['parent', 'type'],
                additionalProperties: false,
            },
            outputSchema: {
                type: 'object',
                additionalProperties: true,
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
            outputSchema: {
                type: 'object',
                additionalProperties: true,
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
            outputSchema: {
                type: 'object',
                additionalProperties: true,
            },
        },
    ],
]);

// ---------- helpers ----------------------------------------------------

interface HarnessOptions {
    readonly profile: 'Full' | 'Lite' | 'Minimal' | 'RPG-only';
    readonly unlockedModules?: ReadonlySet<string>;
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
        { capabilities: { tools: { listChanged: false } } },
    );
    registerToolHandlers(server, {
        profiles: FIXTURE_PROFILES,
        profile: options.profile,
        unlockedModules: options.unlockedModules ?? new Set<string>(),
        schemas: FIXTURE_SCHEMAS,
        dispatcher: options.dispatcher,
    });

    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

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

function dispatcherFromMap(
    table: ReadonlyMap<string, DispatchResult>,
): ChannelDispatcher {
    return {
        async dispatch(method: string): Promise<DispatchResult> {
            const result = table.get(method);
            if (result === undefined) {
                return {
                    kind: 'error',
                    code: -32601,
                    message: 'Method not found',
                    data: { method },
                };
            }
            return result;
        },
    };
}

// ---------- tests ------------------------------------------------------

describe('tools/list — profile filtering', () => {
    it('returns every tool exposed by the active profile (Full)', async () => {
        const dispatcher: ChannelDispatcher = {
            async dispatch(): Promise<DispatchResult> {
                return { kind: 'ok', result: null };
            },
        };
        const harness = await buildHarness({
            profile: 'Full',
            dispatcher,
        });
        try {
            const list = await harness.client.listTools();
            const names = list.tools.map((t) => t.name).sort();
            expect(names).toEqual([
                'combat.create_hitbox',
                'crafting.execute',
                'node.add',
                'project.info',
                'scene.open',
            ]);
            const projectInfo = list.tools.find((t) => t.name === 'project.info');
            expect(projectInfo).toBeDefined();
            expect(projectInfo?.description).toBe(
                'Returns minimal project metadata.',
            );
            expect(projectInfo?.inputSchema).toMatchObject({
                type: 'object',
                additionalProperties: false,
            });
        } finally {
            await harness.close();
        }
    });

    it('Minimal profile only exposes core-minimal tools', async () => {
        const dispatcher: ChannelDispatcher = {
            async dispatch(): Promise<DispatchResult> {
                return { kind: 'ok', result: null };
            },
        };
        const harness = await buildHarness({
            profile: 'Minimal',
            dispatcher,
        });
        try {
            const list = await harness.client.listTools();
            const names = list.tools.map((t) => t.name).sort();
            expect(names).toEqual(['project.info', 'scene.open']);
        } finally {
            await harness.close();
        }
    });

    it('RPG-only without license exposes only core-minimal tools', async () => {
        const dispatcher: ChannelDispatcher = {
            async dispatch(): Promise<DispatchResult> {
                return { kind: 'ok', result: null };
            },
        };
        const harness = await buildHarness({
            profile: 'RPG-only',
            unlockedModules: new Set<string>(),
            dispatcher,
        });
        try {
            const list = await harness.client.listTools();
            const names = list.tools.map((t) => t.name).sort();
            expect(names).toEqual(['project.info', 'scene.open']);
        } finally {
            await harness.close();
        }
    });

    it('RPG-only with forgekit_rpg license unlocks RPG subsystem tools', async () => {
        const dispatcher: ChannelDispatcher = {
            async dispatch(): Promise<DispatchResult> {
                return { kind: 'ok', result: null };
            },
        };
        const harness = await buildHarness({
            profile: 'RPG-only',
            unlockedModules: new Set<string>(['combat', 'crafting']),
            dispatcher,
        });
        try {
            const list = await harness.client.listTools();
            const names = list.tools.map((t) => t.name).sort();
            expect(names).toEqual([
                'combat.create_hitbox',
                'crafting.execute',
                'project.info',
                'scene.open',
            ]);
        } finally {
            await harness.close();
        }
    });
});

describe('tools/call — routing through ChannelRouter', () => {
    it('forwards params to the dispatcher and returns the result as JSON text', async () => {
        const calls: Array<{ method: string; params: unknown }> = [];
        const dispatcher: ChannelDispatcher = {
            async dispatch(method, params) {
                calls.push({ method, params });
                return { kind: 'ok', result: { ok: true, opened: '/scene/main.tscn' } };
            },
        };
        const harness = await buildHarness({
            profile: 'Full',
            dispatcher,
        });
        try {
            const result = await harness.client.callTool({
                name: 'scene.open',
                arguments: { path: '/scene/main.tscn' },
            });
            expect(result.isError).not.toBe(true);
            expect(result.content).toEqual([
                {
                    type: 'text',
                    text: JSON.stringify({ ok: true, opened: '/scene/main.tscn' }),
                },
            ]);
            expect(calls).toEqual([
                {
                    method: 'scene.open',
                    params: { path: '/scene/main.tscn' },
                },
            ]);
        } finally {
            await harness.close();
        }
    });

    it('rejects params that fail Ajv validation with -32602', async () => {
        const dispatcher: ChannelDispatcher = {
            async dispatch(): Promise<DispatchResult> {
                throw new Error('dispatcher should not be reached on validation failure');
            },
        };
        const harness = await buildHarness({
            profile: 'Full',
            dispatcher,
        });
        try {
            // Missing required `path` property triggers validation failure.
            await expect(
                harness.client.callTool({
                    name: 'scene.open',
                    arguments: {},
                }),
            ).rejects.toMatchObject({
                code: ErrorCode.InvalidParams,
                data: expect.objectContaining({ code: ErrorCode.InvalidParams }),
            });
        } finally {
            await harness.close();
        }
    });

    it('returns -32024 PROFILE_TOOL_FILTERED for declared tools that are not in the active profile', async () => {
        const dispatcher: ChannelDispatcher = {
            async dispatch(): Promise<DispatchResult> {
                throw new Error('dispatcher should not be reached for filtered tools');
            },
        };
        const harness = await buildHarness({
            profile: 'Minimal',
            dispatcher,
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

    it('returns -32601 for tool names that are not declared in profiles.json at all', async () => {
        const dispatcher: ChannelDispatcher = {
            async dispatch(): Promise<DispatchResult> {
                throw new Error('dispatcher should not be reached for unknown tools');
            },
        };
        const harness = await buildHarness({
            profile: 'Minimal',
            dispatcher,
        });
        try {
            await expect(
                harness.client.callTool({
                    name: 'this.tool.does.not.exist',
                    arguments: {},
                }),
            ).rejects.toMatchObject({
                code: ErrorCode.MethodNotFound,
                data: expect.objectContaining({ code: ErrorCode.MethodNotFound }),
            });
        } finally {
            await harness.close();
        }
    });

    it('maps DispatchChannelUnavailable to the -32000 envelope', async () => {
        const dispatcher = dispatcherFromMap(
            new Map<string, DispatchResult>([
                [
                    'scene.open',
                    { kind: 'channel-unavailable', channel: 'editor' },
                ],
            ]),
        );
        const harness = await buildHarness({
            profile: 'Full',
            dispatcher,
        });
        try {
            await expect(
                harness.client.callTool({
                    name: 'scene.open',
                    arguments: { path: '/main.tscn' },
                }),
            ).rejects.toMatchObject({
                code: ErrorCode.ConnectionClosed, // -32000
                data: expect.objectContaining({
                    code: ErrorCode.ConnectionClosed,
                    channel: 'editor',
                }),
            });
        } finally {
            await harness.close();
        }
    });

    it('maps channel timeout DispatchError to the -32001 envelope', async () => {
        const dispatcher = dispatcherFromMap(
            new Map<string, DispatchResult>([
                [
                    'scene.open',
                    {
                        kind: 'error',
                        code: -32001,
                        message: 'channel_timeout',
                        data: {
                            channel: 'editor',
                            method: 'scene.open',
                            elapsed_ms: 30_000,
                        },
                    },
                ],
            ]),
        );
        const harness = await buildHarness({
            profile: 'Full',
            dispatcher,
        });
        try {
            await expect(
                harness.client.callTool({
                    name: 'scene.open',
                    arguments: { path: '/main.tscn' },
                }),
            ).rejects.toMatchObject({
                code: -32001,
                data: expect.objectContaining({
                    code: -32001,
                    channel: 'editor',
                    method: 'scene.open',
                }),
            });
        } finally {
            await harness.close();
        }
    });

    it('preserves McpError thrown shape (instanceof McpError) on every error path', async () => {
        const dispatcher = dispatcherFromMap(
            new Map<string, DispatchResult>([
                [
                    'scene.open',
                    {
                        kind: 'error',
                        code: -32603,
                        message: 'Internal error',
                        data: { detail: 'boom' },
                    },
                ],
            ]),
        );
        const harness = await buildHarness({
            profile: 'Full',
            dispatcher,
        });
        try {
            try {
                await harness.client.callTool({
                    name: 'scene.open',
                    arguments: { path: '/main.tscn' },
                });
                expect.fail('expected callTool to reject');
            } catch (err) {
                expect(err).toBeInstanceOf(McpError);
                expect((err as McpError).code).toBe(-32603);
            }
        } finally {
            await harness.close();
        }
    });
});

describe('initialize — capabilities advertise tools.listChanged: false', () => {
    it('does not advertise resources or prompts capabilities', async () => {
        const dispatcher: ChannelDispatcher = {
            async dispatch(): Promise<DispatchResult> {
                return { kind: 'ok', result: null };
            },
        };
        const harness = await buildHarness({
            profile: 'Minimal',
            dispatcher,
        });
        try {
            const caps = harness.client.getServerCapabilities();
            expect(caps).toBeDefined();
            // tools capability advertised, with listChanged false
            expect(caps?.tools).toMatchObject({ listChanged: false });
            // We do not advertise prompts or resources.
            expect(caps?.prompts).toBeUndefined();
            expect(caps?.resources).toBeUndefined();
        } finally {
            await harness.close();
        }
    });
});
