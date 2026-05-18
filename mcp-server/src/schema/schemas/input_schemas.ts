/**
 * Schemas for the `input.*` tool family (7 tools).
 *
 * Reference: design.md section 5.4.6.
 */

import { defineSchema, type ToolSchema } from '../define_schema.js';
import { noParams, vector2 } from './_common.js';

export const inputSchemas: ReadonlyArray<ToolSchema> = [
    defineSchema('input.simulate_action', () => ({
        description:
            'Synthesizes an `InputEventAction` for `action`. `pressed` toggles ' +
            'the press state and `strength` overrides the analog value.',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', minLength: 1 },
                strength: { type: 'number', minimum: 0, maximum: 1 },
                pressed: { type: 'boolean' },
            },
            required: ['action'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { emitted: { type: 'boolean' } },
            required: ['emitted'],
            additionalProperties: true,
        },
    })),

    defineSchema('input.simulate_key', () => ({
        description:
            'Synthesizes a keyboard event. `keycode` matches Godot Key enum ' +
            'values. `echo` mirrors Godot key-repeat semantics.',
        inputSchema: {
            type: 'object',
            properties: {
                keycode: { type: 'integer' },
                pressed: { type: 'boolean' },
                echo: { type: 'boolean' },
            },
            required: ['keycode', 'pressed'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { emitted: { type: 'boolean' } },
            required: ['emitted'],
            additionalProperties: true,
        },
    })),

    defineSchema('input.simulate_mouse_button', () => ({
        description:
            'Synthesizes a mouse button event. `button` matches Godot ' +
            '`MouseButton` enum values.',
        inputSchema: {
            type: 'object',
            properties: {
                button: { type: 'integer' },
                pressed: { type: 'boolean' },
                position: vector2,
            },
            required: ['button', 'pressed'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { emitted: { type: 'boolean' } },
            required: ['emitted'],
            additionalProperties: true,
        },
    })),

    defineSchema('input.simulate_mouse_motion', () => ({
        description:
            'Synthesizes an absolute mouse motion event at `position`, with ' +
            'optional `relative` delta.',
        inputSchema: {
            type: 'object',
            properties: {
                position: vector2,
                relative: vector2,
            },
            required: ['position'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { emitted: { type: 'boolean' } },
            required: ['emitted'],
            additionalProperties: true,
        },
    })),

    defineSchema('input.list_actions', () => ({
        description: 'Returns every InputAction along with its bound events.',
        inputSchema: noParams,
        outputSchema: {
            type: 'object',
            properties: {
                actions: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            name: { type: 'string' },
                            events: { type: 'array' },
                        },
                        required: ['name', 'events'],
                        additionalProperties: true,
                    },
                },
            },
            required: ['actions'],
            additionalProperties: true,
        },
    })),

    defineSchema('input.configure_action', () => ({
        description:
            'Configures action `action` with the supplied `events` array and ' +
            'optional `deadzone`. Atomic write to `project.godot`. Other ' +
            'actions are preserved.',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', minLength: 1 },
                events: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            device: { type: ['integer', 'string'] },
                            event_type: { type: 'string' },
                        },
                        additionalProperties: true,
                    },
                },
                deadzone: { type: 'number', minimum: 0, maximum: 1 },
            },
            required: ['action', 'events'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                applied: { type: 'object', additionalProperties: true },
                previous: { type: 'object', additionalProperties: true },
            },
            required: ['applied'],
            additionalProperties: true,
        },
    })),

    defineSchema('input.remove_action', () => ({
        description: 'Removes the InputAction `action` from `project.godot`.',
        inputSchema: {
            type: 'object',
            properties: { action: { type: 'string', minLength: 1 } },
            required: ['action'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { removed: { type: 'boolean' } },
            required: ['removed'],
            additionalProperties: true,
        },
    })),
] as const;
