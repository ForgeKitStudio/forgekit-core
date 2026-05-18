/**
 * Schemas for the `editor.*` tool family (9 tools).
 *
 * Reference: design.md section 5.4.5.
 */

import { defineSchema, type ToolSchema } from '../define_schema.js';
import { noParams, nodePath } from './_common.js';

export const editorSchemas: ReadonlyArray<ToolSchema> = [
    defineSchema('editor.get_selection', () => ({
        description: 'Returns the currently selected node paths in the editor.',
        inputSchema: noParams,
        outputSchema: {
            type: 'object',
            properties: {
                selected: { type: 'array', items: nodePath },
            },
            required: ['selected'],
            additionalProperties: true,
        },
    })),

    defineSchema('editor.set_selection', () => ({
        description: 'Replaces the editor selection with `node_paths`.',
        inputSchema: {
            type: 'object',
            properties: {
                node_paths: { type: 'array', items: nodePath, minItems: 0 },
            },
            required: ['node_paths'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { selected: { type: 'array' } },
            required: ['selected'],
            additionalProperties: true,
        },
    })),

    defineSchema('editor.get_output_log', () => ({
        description: 'Returns the most recent editor output log lines.',
        inputSchema: {
            type: 'object',
            properties: { max_lines: { type: 'integer', minimum: 1 } },
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { lines: { type: 'array', items: { type: 'string' } } },
            required: ['lines'],
            additionalProperties: true,
        },
    })),

    defineSchema('editor.get_errors', () => ({
        description:
            'Returns every active editor error or warning, with file, line, ' +
            'message, and severity.',
        inputSchema: noParams,
        outputSchema: {
            type: 'object',
            properties: {
                errors: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            file: { type: 'string' },
                            line: { type: 'integer' },
                            msg: { type: 'string' },
                            severity: { type: 'string' },
                        },
                        required: ['file', 'line', 'msg', 'severity'],
                        additionalProperties: true,
                    },
                },
            },
            required: ['errors'],
            additionalProperties: true,
        },
    })),

    defineSchema('editor.clear_output', () => ({
        description: 'Clears the editor Output dock.',
        inputSchema: noParams,
        outputSchema: {
            type: 'object',
            properties: { cleared: { type: 'boolean' } },
            required: ['cleared'],
            additionalProperties: true,
        },
    })),

    defineSchema('editor.focus_node', () => ({
        description: 'Focuses the SceneTree dock on `node_path`.',
        inputSchema: {
            type: 'object',
            properties: { node_path: nodePath },
            required: ['node_path'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { focused: { type: 'boolean' } },
            required: ['focused'],
            additionalProperties: true,
        },
    })),

    defineSchema('editor.undo', () => ({
        description:
            'Undoes the last editor action and returns whether anything was ' +
            'undone plus the action name.',
        inputSchema: noParams,
        outputSchema: {
            type: 'object',
            properties: {
                undone: { type: 'boolean' },
                action_name: { type: 'string' },
            },
            required: ['undone'],
            additionalProperties: true,
        },
    })),

    defineSchema('editor.redo', () => ({
        description: 'Redoes the most recently undone action.',
        inputSchema: noParams,
        outputSchema: {
            type: 'object',
            properties: {
                redone: { type: 'boolean' },
                action_name: { type: 'string' },
            },
            required: ['redone'],
            additionalProperties: true,
        },
    })),

    defineSchema('editor.get_undo_stack', () => ({
        description:
            'Returns the most recent undo stack entries, capped by `max`.',
        inputSchema: {
            type: 'object',
            properties: { max: { type: 'integer', minimum: 1 } },
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                entries: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            name: { type: 'string' },
                            id: { type: ['string', 'integer'] },
                        },
                        required: ['name'],
                        additionalProperties: true,
                    },
                },
            },
            required: ['entries'],
            additionalProperties: true,
        },
    })),
] as const;
