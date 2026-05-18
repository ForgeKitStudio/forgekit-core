/**
 * Reusable schema fragments used by the tool registry.
 *
 * Every helper returns a plain JSON value (not a typed object) so we
 * can spread it into a category schema's `properties` map without
 * fighting `readonly` rules. JSON Schema does not prescribe
 * representation for Godot domain types, so we lean on TypeScript
 * primitives (`number`, `string`, `array`).
 */

/** Plain JSON-RPC `success: true` envelope. */
export const successEnvelope = {
    type: 'object' as const,
    properties: {
        success: { type: 'boolean' },
    },
    additionalProperties: true,
};

/** Schema for a project-relative path (`res://...`). */
export const resourcePath = {
    type: 'string',
    pattern: '^res://',
    description: 'Project-relative resource path (must start with "res://").',
};

/** Schema for an absolute filesystem path. */
export const absolutePath = {
    type: 'string',
    minLength: 1,
    description: 'Absolute filesystem path.',
};

/** Schema for an in-tree node path (`/root/Main/Player`). */
export const nodePath = {
    type: 'string',
    minLength: 1,
    description: 'Godot scene tree node path.',
};

/** Schema for a Godot scene path (`res://...tscn`). */
export const scenePath = {
    type: 'string',
    pattern: '^res://.*\\.tscn$',
    description: 'Project-relative scene path ending in `.tscn`.',
};

/** Schema for a 2D vector represented as `[x, y]`. */
export const vector2 = {
    type: 'array',
    items: { type: 'number' },
    minItems: 2,
    maxItems: 2,
    description: '2D vector [x, y].',
};

/** Schema for a 3D vector represented as `[x, y, z]`. */
export const vector3 = {
    type: 'array',
    items: { type: 'number' },
    minItems: 3,
    maxItems: 3,
    description: '3D vector [x, y, z].',
};

/** Schema for a Godot Transform2D / Transform3D opaque dictionary. */
export const transform = {
    type: 'object',
    description:
        'Godot transform serialized as `{origin, basis}` for 3D or ' +
        '`{origin, x, y}` for 2D.',
    additionalProperties: true,
};

/** Schema for a non-negative integer. */
export const nonNegativeInt = {
    type: 'integer',
    minimum: 0,
};

/** Schema for a positive integer (`>= 1`). */
export const positiveInt = {
    type: 'integer',
    minimum: 1,
};

/** Schema for a finite float in any range. */
export const finiteNumber = {
    type: 'number',
};

/** Schema for the `dimension` discriminator used by combat tools. */
export const dimension = {
    type: 'string',
    enum: ['2d', '3d'],
    description: '`"2d"` for Hit/Hurtbox2D, `"3d"` for Hit/Hurtbox3D.',
};

/** Shorthand: `additionalProperties: true` permissive bag. */
export const dictBag = {
    type: 'object' as const,
    additionalProperties: true,
};

/**
 * Standard shape for an output containing a single `node_path` entry —
 * used by every "create node" tool (combat.create_hitbox,
 * scene3d.add_mesh_instance, particle.create_gpu, ...).
 */
export const nodeCreatedOutput = {
    type: 'object' as const,
    properties: {
        node_path: nodePath,
    },
    required: ['node_path'],
    additionalProperties: true,
};

/** Standard `{applied: true}` envelope. */
export const appliedOutput = {
    type: 'object' as const,
    properties: {
        applied: { type: 'boolean' },
    },
    required: ['applied'],
    additionalProperties: true,
};

/** Standard atomic-write `{applied, previous}` envelope. */
export const appliedPreviousOutput = {
    type: 'object' as const,
    properties: {
        applied: { type: 'boolean' },
        previous: dictBag,
    },
    required: ['applied'],
    additionalProperties: true,
};

/** Standard `{ok: bool, errors: [{line, col, msg}]}` validator output. */
export const validatorOutput = {
    type: 'object' as const,
    properties: {
        ok: { type: 'boolean' },
        errors: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    line: { type: 'integer' },
                    col: { type: 'integer' },
                    msg: { type: 'string' },
                },
                additionalProperties: true,
            },
        },
    },
    required: ['ok'],
    additionalProperties: true,
};

/** Empty `properties: {}` schema for tools that take no parameters. */
export const noParams = {
    type: 'object' as const,
    properties: {},
    additionalProperties: false,
};

/**
 * `TestReport` value object — used by every `tests.run_*` tool. The
 * full structure mirrors `addons/forgekit_core/testing/test_report.gd`.
 */
export const testReport = {
    type: 'object' as const,
    properties: {
        run_id: { type: 'string' },
        timestamp: { type: 'string' },
        total: { type: 'integer', minimum: 0 },
        passed: { type: 'integer', minimum: 0 },
        failed: { type: 'integer', minimum: 0 },
        tests: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    status: { type: 'string' },
                    duration_ms: { type: 'integer', minimum: 0 },
                    assertions: { type: 'array' },
                    failure_message: { type: 'string' },
                    stack_trace: { type: 'string' },
                },
                additionalProperties: true,
            },
        },
        suggested_action: { type: 'string' },
    },
    required: ['run_id', 'total', 'passed', 'failed'],
    additionalProperties: true,
};
