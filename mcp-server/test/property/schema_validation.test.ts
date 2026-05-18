/**
 * Feature: forgekit, Property 55: tools/call params validate against inputSchema
 *
 * Validates: Wymagania 17.1, 17.2, 17.3.
 *
 * Property 55 — for every one of the 271 tools declared in
 * `profiles.json`, the MCP `tools/call` handler must:
 *
 *   1. Dispatch the call when `params` satisfy the tool's `inputSchema`
 *      (the dispatcher receives the verbatim `(method, params)` pair,
 *      and the response surfaces as a JSON-text content envelope).
 *   2. Reject the call with `-32602 InvalidParams` *without* reaching
 *      the dispatcher when `params` violate the schema. The error
 *      envelope's `data.code` mirrors the JSON-RPC code so MCP clients
 *      that only expose `data` still see `-32602`.
 *
 * The property runs 100 fast-check iterations. Each iteration picks
 * one tool from the active profile, generates either a schema-valid
 * params object or a one-field-mutated invalid one, dispatches via
 * `client.callTool`, and asserts the outcome described above.
 *
 * Schema shape coverage (verified against the live registry):
 *   - Root types: `object` only, `additionalProperties: false`
 *     everywhere. Adding an extra property therefore always
 *     invalidates the params (used for tools with no defined fields).
 *   - Property types in use: string (with optional `pattern`,
 *     `minLength`, `enum`), integer / number (with optional
 *     `minimum`, `maximum`, `enum`), boolean, array (with optional
 *     `items`, `minItems`, `maxItems`), object (with optional
 *     `properties`, `required`, `additionalProperties`), plus a
 *     single union type `[integer, string]` used by
 *     `input.configure_action.events[].device`.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';

import { applyProfile, loadProfiles } from '../../src/profiles.js';
import { getToolSchemas } from '../../src/schema/tool_schemas.js';
import {
    registerToolHandlers,
    type ChannelDispatcher,
} from '../../src/server/tool_request_handlers.js';
import type { DispatchResult } from '../../src/stdio_bridge.js';

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const PROFILES_PATH = resolve(HERE, '..', '..', 'profiles.json');

/** Per `tasks.md` 8.16: 100 iterations. */
const NUM_RUNS = 100 as const;

/** Sentinel result returned by the stub dispatcher on a successful call. */
const OK_RESULT = { __forgekit_test_dispatch_ok__: true } as const;

// --------------------------------------------------------------------------
// JSON Schema helpers — generators for "valid" and "invalid" params.
//
// The generators only need to cover the keyword subset that actually
// appears in the registry (see file header). Schema fragments outside
// that subset fall through to permissive defaults rather than
// throwing, so adding a new keyword to the registry will degrade to
// "skip the constraint" instead of crashing the test.
// --------------------------------------------------------------------------

interface JsonSchemaLike {
    readonly type?: string | readonly string[];
    readonly enum?: readonly unknown[];
    readonly pattern?: string;
    readonly minLength?: number;
    readonly minimum?: number;
    readonly maximum?: number;
    readonly minItems?: number;
    readonly maxItems?: number;
    readonly properties?: Readonly<Record<string, JsonSchemaLike>>;
    readonly required?: readonly string[];
    readonly items?: JsonSchemaLike;
    readonly additionalProperties?: boolean | JsonSchemaLike;
}

/** Generator producing values that satisfy `schema`. */
function genValidValue(schema: JsonSchemaLike): fc.Arbitrary<unknown> {
    if (schema.enum && schema.enum.length > 0) {
        return fc.constantFrom(...schema.enum);
    }
    if (Array.isArray(schema.type)) {
        return fc.oneof(
            ...schema.type.map((t) =>
                genValidValue({ ...schema, type: t, enum: undefined }),
            ),
        );
    }
    switch (schema.type) {
        case 'string':
            return genValidString(schema);
        case 'integer':
            return fc.integer({
                min: schema.minimum ?? -1_000_000,
                max: schema.maximum ?? 1_000_000,
            });
        case 'number':
            return fc.double({
                min: schema.minimum ?? -1_000_000,
                max: schema.maximum ?? 1_000_000,
                noNaN: true,
                noDefaultInfinity: true,
            });
        case 'boolean':
            return fc.boolean();
        case 'array':
            return genValidArray(schema);
        case 'object':
            return genValidObject(schema);
        default:
            // Permissive fallback for undeclared types (e.g. nested
            // schemas missing `type`). Tools in the registry never
            // require such fields at the root, so this branch only
            // matters for optional nested values.
            return fc.constant(null);
    }
}

function genValidString(schema: JsonSchemaLike): fc.Arbitrary<string> {
    if (typeof schema.pattern === 'string' && schema.pattern.length > 0) {
        // `fc.stringMatching` honours the regex; the two patterns in
        // the registry (`^res://` and `^res://.*\.tscn$`) both produce
        // strings comfortably above any `minLength` constraint.
        return fc.stringMatching(new RegExp(schema.pattern));
    }
    const minLength = schema.minLength ?? 0;
    return fc.string({ minLength, maxLength: minLength + 8 });
}

function genValidArray(schema: JsonSchemaLike): fc.Arbitrary<unknown[]> {
    const minItems = schema.minItems ?? 0;
    const maxItems = schema.maxItems ?? Math.max(minItems + 2, 3);
    const itemArb = schema.items
        ? genValidValue(schema.items)
        : fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null));
    return fc.array(itemArb, { minLength: minItems, maxLength: maxItems });
}

function genValidObject(
    schema: JsonSchemaLike,
): fc.Arbitrary<Record<string, unknown>> {
    const properties = schema.properties ?? {};
    const required = schema.required ?? [];
    const requiredEntries: Record<string, fc.Arbitrary<unknown>> = {};
    for (const name of required) {
        const propSchema = properties[name];
        if (propSchema) {
            requiredEntries[name] = genValidValue(propSchema);
        }
    }
    if (Object.keys(requiredEntries).length === 0) {
        // No required fields → empty object satisfies the schema for
        // every tool in the registry (all roots use
        // `additionalProperties: false`).
        return fc.constant({});
    }
    return fc.record(requiredEntries);
}

/**
 * Generator producing values that *violate* `schema`. The mutation
 * strategy picks one of two invalidating moves at random:
 *
 *   - "wrong-type" — replace one required field's value with a
 *     payload whose JSON type is mutually exclusive with the declared
 *     type. Skipped when the schema has no required fields with a
 *     constrained type (e.g. `value: {}` accepts everything).
 *   - "extra-property" — add an unknown top-level key. Every root
 *     schema in the registry uses `additionalProperties: false`, so
 *     this rejection path is universally available.
 *
 * The generator always falls back to "extra-property" when the chosen
 * required field has no usable type constraint, guaranteeing the
 * resulting object is rejected by Ajv for every tool in the registry.
 */
function genInvalidParams(
    schema: JsonSchemaLike,
): fc.Arbitrary<Record<string, unknown>> {
    const properties = schema.properties ?? {};
    const required = schema.required ?? [];

    // Required fields with a declared, mutually-exclusive type that
    // we can violate via `pickWrongTypedValue`.
    const violableRequired = required.filter((name) => {
        const ps = properties[name];
        return ps !== undefined && hasUsableTypeConstraint(ps);
    });

    if (violableRequired.length === 0) {
        // No field can be invalidated by type mutation — use an
        // unknown extra property (rejected by
        // `additionalProperties: false`).
        return genValidObject(schema).map((base) => ({
            ...base,
            __forgekit_invalid_extra__: 'unexpected-property',
        }));
    }

    const fieldArb = fc.constantFrom(...violableRequired);
    return genValidObject(schema)
        .chain((base) => fieldArb.map((field) => ({ base, field })))
        .map(({ base, field }) => {
            const propSchema = properties[field]!;
            return {
                ...base,
                [field]: pickWrongTypedValue(propSchema),
            };
        });
}

/**
 * `true` when `propSchema` declares a single concrete type or a union
 * of types that does *not* include every JSON kind. Otherwise the
 * schema accepts any value and cannot be invalidated by type mutation.
 */
function hasUsableTypeConstraint(propSchema: JsonSchemaLike): boolean {
    const declared = new Set<string>();
    if (Array.isArray(propSchema.type)) {
        for (const t of propSchema.type) declared.add(t);
    } else if (typeof propSchema.type === 'string') {
        declared.add(propSchema.type);
    }
    if (declared.size === 0) {
        // No `type` keyword and no enum constraint — schema accepts
        // any JSON value.
        return propSchema.enum !== undefined && propSchema.enum.length > 0;
    }
    return true;
}

/**
 * Returns a value whose JSON type is incompatible with every type
 * declared in `propSchema`. The registry uses `string`, `integer`,
 * `number`, `boolean`, `array`, `object`, and a single
 * `[integer | string]` union — `pickWrongTypedValue` emits a value
 * outside each combination so Ajv will always reject it.
 */
function pickWrongTypedValue(propSchema: JsonSchemaLike | undefined): unknown {
    if (propSchema === undefined) {
        return null;
    }
    const declared = new Set<string>();
    if (Array.isArray(propSchema.type)) {
        for (const t of propSchema.type) declared.add(t);
    } else if (typeof propSchema.type === 'string') {
        declared.add(propSchema.type);
    }

    // Try candidate values in order of "most clearly wrong"; the first
    // one whose JSON type is not in `declared` wins.
    const candidates: Array<{ jsonType: string; value: unknown }> = [
        { jsonType: 'boolean', value: true },
        { jsonType: 'string', value: '__forgekit_wrong_type__' },
        { jsonType: 'integer', value: 12_345 },
        { jsonType: 'array', value: [] },
        { jsonType: 'object', value: { __forgekit_wrong_type__: true } },
    ];
    for (const candidate of candidates) {
        if (jsonTypeMatchesAny(candidate.jsonType, declared)) continue;
        return candidate.value;
    }
    // Defensive default: every JSON type is allowed by the schema (not
    // observed in the registry, but we still need to invalidate
    // somehow).
    return null;
}

function jsonTypeMatchesAny(
    candidateType: string,
    declared: ReadonlySet<string>,
): boolean {
    if (declared.has(candidateType)) return true;
    // JSON Schema's `integer` is a refinement of `number`; an integer
    // value also satisfies a `number`-typed field.
    if (candidateType === 'integer' && declared.has('number')) return true;
    return false;
}

// --------------------------------------------------------------------------
// Test harness
// --------------------------------------------------------------------------

interface DispatchLogEntry {
    readonly method: string;
    readonly params: unknown;
}

interface Harness {
    readonly client: Client;
    readonly server: Server;
    readonly log: DispatchLogEntry[];
    close(): Promise<void>;
}

async function buildHarness(): Promise<Harness> {
    const profiles = await loadProfiles(PROFILES_PATH);
    const schemas = getToolSchemas();

    const log: DispatchLogEntry[] = [];
    const dispatcher: ChannelDispatcher = {
        async dispatch(method, params): Promise<DispatchResult> {
            log.push({ method, params });
            return { kind: 'ok', result: OK_RESULT };
        },
    };

    const server = new Server(
        { name: 'schema-validation-test-server', version: '0.0.0' },
        { capabilities: { tools: { listChanged: false } } },
    );
    registerToolHandlers(server, {
        profiles,
        profile: 'Full',
        unlockedModules: new Set<string>(),
        schemas,
        dispatcher,
    });

    const [serverTransport, clientTransport] =
        InMemoryTransport.createLinkedPair();
    const client = new Client(
        { name: 'schema-validation-test-client', version: '0.0.0' },
        { capabilities: {} },
    );
    await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
    ]);

    return {
        client,
        server,
        log,
        async close() {
            await client.close();
            await server.close();
        },
    };
}

// --------------------------------------------------------------------------
// Property
// --------------------------------------------------------------------------

describe('Feature: forgekit, Property 55: tools/call params validate against inputSchema', () => {
    it('accepts schema-valid params (dispatch invoked) and rejects mutated params with -32602 (no dispatch)', async () => {
        const harness = await buildHarness();
        try {
            const profiles = await loadProfiles(PROFILES_PATH);
            const tools = applyProfile(profiles, 'Full', {
                unlockedModules: new Set<string>(),
            });
            // Sanity: the Full profile must surface every declared
            // tool from `profiles.json`.
            expect(tools.length).toBe(profiles.tools.length);
            expect(tools.length).toBeGreaterThanOrEqual(271);

            const schemas = getToolSchemas();

            // Index tools by name and pre-build per-tool valid /
            // invalid generators so the property body itself is just
            // an Ajv-vs-dispatcher comparison.
            const toolNameArb = fc.constantFrom(
                ...tools.map((t) => t.name),
            );
            const modeArb = fc.constantFrom('valid', 'invalid');

            await fc.assert(
                fc.asyncProperty(
                    toolNameArb,
                    modeArb,
                    fc.integer({ min: 0, max: 0xffff_ffff }),
                    async (toolName, mode, seed) => {
                        const schema = schemas.get(toolName);
                        if (schema === undefined) {
                            // Every tool in `profiles.json` must have
                            // a schema (CI's `validate-schemas`
                            // enforces this); fail loudly if not.
                            return false;
                        }

                        const paramsArb =
                            mode === 'valid'
                                ? genValidValue(schema.inputSchema)
                                : genInvalidParams(schema.inputSchema);
                        const params = fc.sample(paramsArb, {
                            numRuns: 1,
                            seed,
                        })[0];

                        const dispatchCountBefore = harness.log.length;

                        if (mode === 'valid') {
                            const response = await harness.client.callTool({
                                name: toolName,
                                arguments: params as Record<string, unknown>,
                            });
                            // Dispatch must have been invoked exactly
                            // once with the verbatim `(method, params)`
                            // pair; the response surfaces the
                            // dispatcher's result as JSON text.
                            expect(harness.log.length).toBe(
                                dispatchCountBefore + 1,
                            );
                            const last = harness.log[dispatchCountBefore]!;
                            expect(last.method).toBe(toolName);
                            expect(last.params).toEqual(params);
                            expect(response.isError).not.toBe(true);
                            expect(response.content).toEqual([
                                {
                                    type: 'text',
                                    text: JSON.stringify(OK_RESULT),
                                },
                            ]);
                            return true;
                        }

                        // Invalid path: callTool must reject with the
                        // -32602 envelope (mirrored on `data.code`)
                        // and the dispatcher must NEVER be reached.
                        await expect(
                            harness.client.callTool({
                                name: toolName,
                                arguments: params as Record<string, unknown>,
                            }),
                        ).rejects.toMatchObject({
                            code: ErrorCode.InvalidParams, // -32602
                            data: expect.objectContaining({
                                code: ErrorCode.InvalidParams,
                                method: toolName,
                            }),
                        });
                        expect(harness.log.length).toBe(dispatchCountBefore);
                        return true;
                    },
                ),
                { numRuns: NUM_RUNS },
            );
        } finally {
            await harness.close();
        }
    });
});
