/**
 * Schemas for `search.*` and `analysis.*` tools (4 tools).
 *
 * Reference: design.md section 5.4.24.
 */

import { defineSchema, type ToolSchema } from '../define_schema.js';

export const searchAnalysisSchemas: ReadonlyArray<ToolSchema> = [
    defineSchema('search.code', () => ({
        description:
            'Recursive regex search across project files. `include`/`exclude` ' +
            'are glob patterns.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', minLength: 1 },
                include: { type: 'string' },
                exclude: { type: 'string' },
            },
            required: ['query'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                matches: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            file: { type: 'string' },
                            line: { type: 'integer', minimum: 1 },
                            preview: { type: 'string' },
                        },
                        required: ['file', 'line', 'preview'],
                        additionalProperties: true,
                    },
                },
            },
            required: ['matches'],
            additionalProperties: true,
        },
    })),

    defineSchema('search.references', () => ({
        description:
            'Finds every reference to `symbol`, optionally narrowed to ' +
            '`class`. Returns matching files plus line numbers.',
        inputSchema: {
            type: 'object',
            properties: {
                symbol: { type: 'string', minLength: 1 },
                class: { type: 'string' },
            },
            required: ['symbol'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                refs: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            file: { type: 'string' },
                            line: { type: 'integer' },
                        },
                        required: ['file', 'line'],
                        additionalProperties: true,
                    },
                },
            },
            required: ['refs'],
            additionalProperties: true,
        },
    })),

    defineSchema('analysis.count_nodes_by_type', () => ({
        description:
            'Returns a `{type: count}` map of nodes in the active scene tree.',
        inputSchema: {
            type: 'object',
            properties: { root: { type: 'string' } },
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                counts: {
                    type: 'object',
                    additionalProperties: { type: 'integer', minimum: 0 },
                },
            },
            required: ['counts'],
            additionalProperties: true,
        },
    })),

    defineSchema('analysis.dependency_graph', () => ({
        description:
            'Returns the project dependency graph as `nodes`/`edges`. ' +
            '`format` selects the serialization (`"json"` or `"dot"`).',
        inputSchema: {
            type: 'object',
            properties: {
                root: { type: 'string' },
                format: { type: 'string', enum: ['json', 'dot'] },
            },
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                nodes: { type: 'array' },
                edges: { type: 'array' },
            },
            required: ['nodes', 'edges'],
            additionalProperties: true,
        },
    })),
] as const;
