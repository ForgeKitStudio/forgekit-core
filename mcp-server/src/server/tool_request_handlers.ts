/**
 * MCP `tools/list` and `tools/call` handler registration.
 *
 * Wires the active `ProfilesFile` + license-derived unlock set into the
 * `@modelcontextprotocol/sdk` `Server` instance so every connected MCP
 * client (Claude Desktop, Cursor, Kiro, Antigravity) sees the same
 * filtered tool surface that the channel router can actually route.
 *
 * Responsibilities:
 *   1. `tools/list` — runs `applyProfile(profiles, profile,
 *      {unlockedModules})` and returns each surviving tool with its
 *      `description` and `inputSchema` taken from the in-process
 *      `ToolSchema` registry.
 *   2. `tools/call` —
 *        a) verifies the requested tool name is in the active profile,
 *        b) validates `params` against the tool's `inputSchema` via
 *           Ajv 8 (Draft 2020-12),
 *        c) delegates to a pluggable `ChannelDispatcher` (typically
 *           the `ChannelRouter` from
 *           `src/dispatcher/channel_router.ts`),
 *        d) shapes the dispatcher's `DispatchResult` into either a
 *           `CallToolResult` (`{content: [{type: "text", ...}]}`) on
 *           success, or an `McpError` JSON-RPC envelope on failure.
 *
 * Error mapping for the JSON-RPC envelope keeps `code` mirrored on
 * `data.code` so MCP clients that surface only `data` see the original
 * JSON-RPC error code (`-32601`, `-32000`, `-32001`, `-32602`, etc.).
 *
 * Resources / prompts are intentionally not registered: the server
 * advertises only `capabilities: {tools: {listChanged: false}}`. The
 * SDK's `Server` rejects unsolicited `resources/list` and
 * `prompts/list` requests with `MethodNotFound` automatically when no
 * matching capability is declared.
 */

import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
    CallToolRequestSchema,
    ErrorCode,
    ListToolsRequestSchema,
    McpError,
    type Tool,
} from '@modelcontextprotocol/sdk/types.js';

import {
    applyProfile,
    type ProfileName,
    type ProfilesFile,
    type ToolEntry,
    type ToolModule,
} from '../profiles.js';
import type { DispatchResult } from '../stdio_bridge.js';

/**
 * Subset of `ToolSchema` from `src/schema/define_schema.ts` consumed by
 * the handlers. Re-declared here so callers may inject a fixture map
 * during tests without dragging the full registry into scope.
 */
export interface ToolSchema {
    readonly name: string;
    readonly description: string;
    readonly inputSchema: {
        readonly type: 'object';
        readonly [key: string]: unknown;
    };
    readonly outputSchema?: {
        readonly type: 'object';
        readonly [key: string]: unknown;
    };
}

/**
 * Pluggable dispatcher contract — same shape as
 * `src/stdio_bridge.ts::ChannelDispatcher`. The MCP handlers never
 * peek at the channel directly; they hand the method + params to the
 * dispatcher and shape its `DispatchResult` for the MCP wire.
 */
export interface ChannelDispatcher {
    dispatch(method: string, params: unknown): Promise<DispatchResult>;
}

export interface RegisterToolHandlersOptions {
    /** Loaded `profiles.json` contents. */
    readonly profiles: ProfilesFile;
    /** Active profile name selected via `--profile`. */
    readonly profile: ProfileName;
    /**
     * Modules unlocked by the on-disk license mirror at registration
     * time. Used for the initial `tools/list` snapshot. When
     * `getUnlockedModules` is also supplied, that callback wins for
     * every subsequent `tools/call`.
     */
    readonly unlockedModules?: ReadonlySet<ToolModule | string>;
    /**
     * Live accessor for the unlocked-modules set. Invoked on every
     * `tools/call` so license activations or expirations observed by
     * the file watcher are honoured without re-registering handlers.
     * When omitted, the static `unlockedModules` set is used instead.
     */
    readonly getUnlockedModules?: () =>
        | ReadonlySet<ToolModule | string>
        | undefined;
    /** Per-tool JSON Schema registry (description + inputSchema). */
    readonly schemas: ReadonlyMap<string, ToolSchema>;
    /** Channel router (or test stub) that executes calls. */
    readonly dispatcher: ChannelDispatcher;
}

/**
 * Returns the filtered tool list as MCP `Tool` records. Pure helper
 * exported so callers can pre-compute the list (e.g. for `/health`
 * diagnostics) without going through the `tools/list` request handler.
 */
export function buildToolList(
    options: Pick<
        RegisterToolHandlersOptions,
        'profiles' | 'profile' | 'unlockedModules' | 'getUnlockedModules' | 'schemas'
    >,
): Tool[] {
    const entries = filterEntries(options);
    const tools: Tool[] = [];
    for (const entry of entries) {
        const schema = options.schemas.get(entry.name);
        if (schema === undefined) {
            // Without a schema the tool cannot be exposed to MCP
            // clients (the SDK requires `inputSchema`). The CI script
            // `validate-schemas.ts` already enforces full coverage, so
            // a missing schema here only happens during early
            // development and is safe to skip.
            continue;
        }
        tools.push({
            name: schema.name,
            description: schema.description,
            inputSchema: schema.inputSchema as Tool['inputSchema'],
        });
    }
    return tools;
}

function filterEntries(
    options: Pick<
        RegisterToolHandlersOptions,
        'profiles' | 'profile' | 'unlockedModules' | 'getUnlockedModules'
    >,
): ToolEntry[] {
    // `applyProfile` accepts a `ReadonlySet<ToolModule>` for the
    // explicit unlock set; cast through `unknown` because we accept
    // any string-typed module id at the public boundary.
    const live = options.getUnlockedModules?.();
    const fallback = options.unlockedModules;
    const unlocked = (live ?? fallback ?? new Set<string>()) as ReadonlySet<ToolModule>;
    return applyProfile(options.profiles, options.profile, {
        unlockedModules: unlocked,
    });
}

/**
 * Wire the `tools/list` and `tools/call` handlers onto `server`.
 *
 * The handlers re-evaluate the active tool set on every request when
 * `getUnlockedModules` is supplied so license activations or
 * expirations observed by the file watcher are honoured without
 * re-registering handlers. When only the static `unlockedModules`
 * snapshot is supplied, the active set is fixed for the lifetime of
 * the registration.
 */
export function registerToolHandlers(
    server: Server,
    options: RegisterToolHandlersOptions,
): void {
    const ajv = new Ajv2020({
        // Match the strict-mode setting from `validate-schemas.ts`: MCP
        // schemas use `additionalProperties: true` in places that Ajv
        // strict mode would otherwise reject.
        strict: false,
        allErrors: true,
    });

    // Compile every known tool's input schema once. The set of allowed
    // tools is recomputed per request (see `currentlyAllowed`).
    const validators = new Map<string, ValidateFunction>();
    for (const [name, schema] of options.schemas) {
        try {
            validators.set(name, ajv.compile(schema.inputSchema));
        } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            throw new Error(
                `tool_request_handlers: failed to compile inputSchema for "${name}": ${detail}`,
            );
        }
    }

    // Index every tool declared in `profiles.json` by name so we can
    // tell "filtered out" apart from "does not exist at all".
    const toolByName = new Map<string, ToolEntry>();
    for (const entry of options.profiles.tools) {
        if (!toolByName.has(entry.name)) {
            toolByName.set(entry.name, entry);
        }
    }

    const currentTools = (): Tool[] => buildToolList(options);
    const currentlyAllowed = (): Set<string> => {
        const allowed = new Set<string>();
        for (const t of currentTools()) {
            allowed.add(t.name);
        }
        return allowed;
    };

    server.setRequestHandler(ListToolsRequestSchema, async () => {
        return { tools: currentTools() };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const name = request.params.name;
        const args = request.params.arguments ?? {};

        const allowed = currentlyAllowed();
        if (!allowed.has(name)) {
            // Distinguish between "tool exists but is not exposed by
            // the active profile/license set" (PROFILE_TOOL_FILTERED)
            // and "tool does not exist at all" (Method not found).
            const declared = toolByName.get(name);
            if (declared !== undefined) {
                const requiredModule = declared.module;
                throw mcpError(
                    -32024,
                    'PROFILE_TOOL_FILTERED',
                    {
                        code: -32024,
                        method: name,
                        required_modules: [requiredModule],
                        suggestion: `activate license: ${requiredModule}`,
                    },
                );
            }
            throw mcpError(ErrorCode.MethodNotFound, 'Method not found', {
                code: ErrorCode.MethodNotFound,
                method: name,
            });
        }

        const validate = validators.get(name);
        if (validate !== undefined && !validate(args)) {
            const detail = ajv.errorsText(validate.errors, { separator: '; ' });
            throw mcpError(ErrorCode.InvalidParams, 'Invalid params', {
                code: ErrorCode.InvalidParams,
                method: name,
                errors: validate.errors,
                detail,
            });
        }

        let result: DispatchResult;
        try {
            result = await options.dispatcher.dispatch(name, args);
        } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            throw mcpError(ErrorCode.InternalError, 'Internal error', {
                code: ErrorCode.InternalError,
                method: name,
                detail,
            });
        }

        return shapeDispatchResult(name, result);
    });
}

/**
 * Translate a dispatcher result into either a `CallToolResult`
 * (success) or a thrown `McpError` (failure).
 *
 * The `data.code` field on every error envelope mirrors the JSON-RPC
 * `code` so MCP clients that surface only `data` see the original
 * code (`-32601`, `-32000`, `-32001`, ...). The thrown `McpError` is
 * re-shaped by the SDK's `Protocol` layer into a JSON-RPC error
 * response, so the client receives a structured failure rather than a
 * `{isError: true}` content envelope.
 */
function shapeDispatchResult(
    method: string,
    result: DispatchResult,
): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
    switch (result.kind) {
        case 'ok': {
            return {
                content: [
                    {
                        type: 'text',
                        text: stringifyResult(result.result),
                    },
                ],
            };
        }
        case 'channel-unavailable': {
            // -32000 ConnectionClosed mirrors the JSON-RPC envelope
            // surfaced by `stdio_bridge.ts` for the same condition.
            const envelopeMessage =
                result.channel === 'editor'
                    ? 'editor_channel_unavailable'
                    : 'runtime_channel_unavailable';
            throw mcpError(
                ErrorCode.ConnectionClosed,
                envelopeMessage,
                {
                    code: ErrorCode.ConnectionClosed,
                    method,
                    channel: result.channel,
                },
            );
        }
        case 'error': {
            const data: Record<string, unknown> = {
                code: result.code,
                method,
            };
            if (result.data !== undefined) {
                if (
                    typeof result.data === 'object' &&
                    result.data !== null &&
                    !Array.isArray(result.data)
                ) {
                    Object.assign(data, result.data as Record<string, unknown>);
                } else {
                    data.detail = result.data;
                }
            }
            throw mcpError(result.code, result.message, data);
        }
        default: {
            const never: never = result;
            throw mcpError(ErrorCode.InternalError, 'Internal error', {
                code: ErrorCode.InternalError,
                detail: `Unexpected dispatch result: ${String(never)}`,
            });
        }
    }
}

function stringifyResult(value: unknown): string {
    try {
        return JSON.stringify(value ?? null);
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return JSON.stringify({
            forgekit_serialization_error: true,
            detail,
        });
    }
}

function mcpError(
    code: number,
    message: string,
    data?: unknown,
): McpError {
    return new McpError(code, message, data);
}
