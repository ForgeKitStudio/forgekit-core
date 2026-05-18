/**
 * Schemas for `tests.*` and `test_report.*` tools (6 tools).
 *
 * Reference: design.md section 5.4.25.
 */

import { defineSchema, type ToolSchema } from '../define_schema.js';
import { resourcePath, testReport } from './_common.js';

export const testingSchemas: ReadonlyArray<ToolSchema> = [
    defineSchema('tests.run_unit', () => ({
        description:
            'Runs every unit test under `path` matching optional `pattern`. ' +
            'Returns a `TestReport`.',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', minLength: 1 },
                pattern: { type: 'string' },
            },
            required: ['path'],
            additionalProperties: false,
        },
        outputSchema: testReport,
    })),

    defineSchema('tests.run_suite', () => ({
        description:
            'Runs the named GUT suite `suite_name` and returns a `TestReport`.',
        inputSchema: {
            type: 'object',
            properties: { suite_name: { type: 'string', minLength: 1 } },
            required: ['suite_name'],
            additionalProperties: false,
        },
        outputSchema: testReport,
    })),

    defineSchema('tests.run_gameplay', () => ({
        description:
            'Runs a gameplay scenario for the scene at `scene_path`. The ' +
            'optional `steps` array describes scripted user inputs.',
        inputSchema: {
            type: 'object',
            properties: {
                scene_path: resourcePath,
                steps: { type: 'array' },
            },
            required: ['scene_path'],
            additionalProperties: false,
        },
        outputSchema: testReport,
    })),

    defineSchema('tests.run_property', () => ({
        description:
            'Runs property-based tests at `path` for the requested ' +
            '`iterations` using `seed`. Counterexample is included when a ' +
            'property fails.',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', minLength: 1 },
                iterations: { type: 'integer', minimum: 1 },
                seed: { type: 'integer' },
            },
            required: ['path'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                ...testReport.properties,
                counterexample: { type: 'string' },
            },
            required: testReport.required,
            additionalProperties: true,
        },
    })),

    defineSchema('test_report.parse', () => ({
        description: 'Parses a JSON-encoded `TestReport` and returns the value object.',
        inputSchema: {
            type: 'object',
            properties: { json: { type: 'string', minLength: 1 } },
            required: ['json'],
            additionalProperties: false,
        },
        outputSchema: testReport,
    })),

    defineSchema('test_report.serialize', () => ({
        description: 'Serializes the supplied `TestReport` value object to JSON.',
        inputSchema: {
            type: 'object',
            properties: { report: testReport },
            required: ['report'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { json: { type: 'string' } },
            required: ['json'],
            additionalProperties: true,
        },
    })),
] as const;
