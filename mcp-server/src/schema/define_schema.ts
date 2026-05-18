/**
 * Schema type definitions and the `defineSchema` factory used by every
 * category fragment.
 *
 * Lives in its own module to avoid a circular import: the fragment
 * files in `schemas/*` need `defineSchema`, and `tool_schemas.ts`
 * imports the fragment files. Routing the helper through this module
 * keeps the dependency graph one-way.
 */

/** A JSON Schema Draft 2020-12 object describing tool input or output. */
export interface JsonSchema {
    readonly type: 'object';
    readonly properties?: Readonly<Record<string, unknown>>;
    readonly required?: readonly string[];
    readonly additionalProperties?: boolean;
    readonly description?: string;
    readonly [key: string]: unknown;
}

/**
 * Schema entry stored per tool. Compatible with the MCP TypeScript
 * SDK's `Tool` shape consumed by `ListToolsRequestSchema`.
 */
export interface ToolSchema {
    readonly name: string;
    readonly description: string;
    readonly inputSchema: JsonSchema;
    readonly outputSchema: JsonSchema;
}

/**
 * Helper used by every category fragment. Validates basic invariants
 * at import time so a malformed schema fails fast at module load
 * instead of during the first MCP `tools/call`.
 */
export function defineSchema(
    name: string,
    fn: () => Omit<ToolSchema, 'name'>,
): ToolSchema {
    if (typeof name !== 'string' || name.length === 0) {
        throw new Error(`defineSchema: name must be a non-empty string`);
    }
    const body = fn();
    if (typeof body.description !== 'string' || body.description.length === 0) {
        throw new Error(
            `defineSchema(${name}): description must be a non-empty string`,
        );
    }
    if (body.inputSchema?.type !== 'object') {
        throw new Error(
            `defineSchema(${name}): inputSchema.type must be "object"`,
        );
    }
    if (body.outputSchema?.type !== 'object') {
        throw new Error(
            `defineSchema(${name}): outputSchema.type must be "object"`,
        );
    }
    return Object.freeze({
        name,
        description: body.description,
        inputSchema: body.inputSchema,
        outputSchema: body.outputSchema,
    });
}
