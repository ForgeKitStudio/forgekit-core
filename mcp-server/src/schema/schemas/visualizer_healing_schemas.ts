/**
 * Schemas for `visualizer.*` (5) and `healing.*` (5) tools.
 *
 * Reference: design.md sections 5.4.34 and 5.4.32.
 */

import { defineSchema, type ToolSchema } from '../define_schema.js';
import { dictBag, noParams, resourcePath, testReport } from './_common.js';

export const visualizerHealingSchemas: ReadonlyArray<ToolSchema> = [
    defineSchema('visualizer.start', () => ({
        description:
            'Starts the in-editor browser visualizer on the requested `port` ' +
            '(default 6030, auto-scan 6030–6039).',
        inputSchema: {
            type: 'object',
            properties: {
                port: { type: 'integer', minimum: 1, maximum: 65535 },
            },
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string' },
                port: { type: 'integer' },
            },
            required: ['url', 'port'],
            additionalProperties: true,
        },
    })),

    defineSchema('visualizer.stop', () => ({
        description: 'Stops the running visualizer.',
        inputSchema: noParams,
        outputSchema: {
            type: 'object',
            properties: { stopped: { type: 'boolean' } },
            required: ['stopped'],
            additionalProperties: true,
        },
    })),

    defineSchema('visualizer.render_scene_tree', () => ({
        description:
            'Renders the scene tree as an HTML page (or JSON document) and ' +
            'returns the URL.',
        inputSchema: {
            type: 'object',
            properties: {
                scene_path: resourcePath,
                format: { type: 'string', enum: ['html', 'json'] },
            },
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { url: { type: 'string' } },
            required: ['url'],
            additionalProperties: true,
        },
    })),

    defineSchema('visualizer.render_module_graph', () => ({
        description:
            'Renders the module dependency graph (forgekit_core / ' +
            'forgekit_rpg) and returns nodes/edges plus the page URL.',
        inputSchema: {
            type: 'object',
            properties: { format: { type: 'string', enum: ['html', 'json', 'dot'] } },
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string' },
                nodes: { type: 'array' },
                edges: { type: 'array' },
            },
            required: ['url', 'nodes', 'edges'],
            additionalProperties: true,
        },
    })),

    defineSchema('visualizer.render_event_bus', () => ({
        description:
            'Renders the GameEvents bus signal/subscriber graph as HTML or JSON.',
        inputSchema: {
            type: 'object',
            properties: { format: { type: 'string', enum: ['html', 'json'] } },
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string' },
                signals: { type: 'array' },
                subscribers: { type: 'array' },
            },
            required: ['url', 'signals', 'subscribers'],
            additionalProperties: true,
        },
    })),

    defineSchema('healing.suggest_action', () => ({
        description:
            'Reads a `TestReport`, classifies the most likely failure mode and ' +
            'returns the suggested next action plus a target identifier.',
        inputSchema: {
            type: 'object',
            properties: { report: testReport },
            required: ['report'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                suggested_action: { type: 'string' },
                target: { type: 'string' },
            },
            required: ['suggested_action'],
            additionalProperties: true,
        },
    })),

    defineSchema('healing.inspect_failure', () => ({
        description:
            'Inspects a failure either by `report_id` or by raw ' +
            '`failure_message`. Returns the inferred root cause and candidate ' +
            'fix locations.',
        inputSchema: {
            type: 'object',
            properties: {
                report_id: { type: 'string' },
                failure_message: { type: 'string' },
            },
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                root_cause: { type: 'string' },
                candidates: { type: 'array' },
            },
            required: ['root_cause'],
            additionalProperties: true,
        },
    })),

    defineSchema('healing.get_retry_count', () => ({
        description:
            'Returns the current retry count for the resource at ' +
            '`resource_path`, plus the hard retry cap.',
        inputSchema: {
            type: 'object',
            properties: { resource_path: resourcePath },
            required: ['resource_path'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                attempts: { type: 'integer', minimum: 0 },
                limit: { type: 'integer', minimum: 1 },
            },
            required: ['attempts', 'limit'],
            additionalProperties: true,
        },
    })),

    defineSchema('healing.reset_retry_count', () => ({
        description:
            'Resets the retry counter for `resource_path` so the self-healing ' +
            'loop can attempt fixes again.',
        inputSchema: {
            type: 'object',
            properties: { resource_path: resourcePath },
            required: ['resource_path'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { reset: { type: 'boolean' } },
            required: ['reset'],
            additionalProperties: true,
        },
    })),

    defineSchema('healing.apply_and_retest', () => ({
        description:
            'Applies the supplied `fix` patch and re-runs `test_command`. ' +
            'Returns whether the patch was applied and the new test report.',
        inputSchema: {
            type: 'object',
            properties: {
                fix: dictBag,
                test_command: { type: 'string', minLength: 1 },
            },
            required: ['fix', 'test_command'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                applied: { type: 'boolean' },
                report: testReport,
            },
            required: ['applied', 'report'],
            additionalProperties: true,
        },
    })),
] as const;
