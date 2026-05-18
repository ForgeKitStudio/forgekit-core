/**
 * Schemas for the `node.*` tool family (14 tools in profiles.json).
 *
 * Reference: design.md section 5.4.3.
 */

import { defineSchema, type ToolSchema } from '../define_schema.js';
import { dictBag, nodePath, scenePath } from './_common.js';

const undoOutput = {
    type: 'object' as const,
    properties: {
        node_path: nodePath,
        undo_action_id: { type: ['string', 'integer'] },
    },
    required: ['node_path'],
    additionalProperties: true,
};

export const nodeSchemas: ReadonlyArray<ToolSchema> = [
    defineSchema('node.add', () => ({
        description:
            'Adds a new node of the given `type` named `name` under ' +
            '`parent_path` inside `scene_path`. Returns the resolved node path ' +
            'and the matching undo action id.',
        inputSchema: {
            type: 'object',
            properties: {
                scene_path: scenePath,
                parent_path: nodePath,
                type: { type: 'string', minLength: 1 },
                name: { type: 'string', minLength: 1 },
                properties: dictBag,
            },
            required: ['scene_path', 'parent_path', 'type', 'name'],
            additionalProperties: false,
        },
        outputSchema: undoOutput,
    })),

    defineSchema('node.remove', () => ({
        description: 'Removes the node at `node_path` inside `scene_path`.',
        inputSchema: {
            type: 'object',
            properties: {
                scene_path: scenePath,
                node_path: nodePath,
            },
            required: ['scene_path', 'node_path'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                removed_path: nodePath,
                undo_action_id: { type: ['string', 'integer'] },
            },
            required: ['removed_path'],
            additionalProperties: true,
        },
    })),

    defineSchema('node.set_property', () => ({
        description:
            'Sets `property` on the node at `node_path` to `value`. Returns the ' +
            'previous value alongside the new one and the undo action id.',
        inputSchema: {
            type: 'object',
            properties: {
                scene_path: scenePath,
                node_path: nodePath,
                property: { type: 'string', minLength: 1 },
                value: {},
            },
            required: ['scene_path', 'node_path', 'property', 'value'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                property: { type: 'string' },
                previous_value: {},
                new_value: {},
                undo_action_id: { type: ['string', 'integer'] },
            },
            required: ['property', 'new_value'],
            additionalProperties: true,
        },
    })),

    defineSchema('node.get_property', () => ({
        description: 'Returns the current value of `property` on `node_path`.',
        inputSchema: {
            type: 'object',
            properties: {
                node_path: nodePath,
                property: { type: 'string', minLength: 1 },
            },
            required: ['node_path', 'property'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { value: {} },
            required: ['value'],
            additionalProperties: true,
        },
    })),

    defineSchema('node.get_properties', () => ({
        description:
            'Returns every readable property on `node_path`, optionally ' +
            'filtered by a name pattern (`filter`).',
        inputSchema: {
            type: 'object',
            properties: {
                node_path: nodePath,
                filter: { type: 'string' },
            },
            required: ['node_path'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { properties: dictBag },
            required: ['properties'],
            additionalProperties: true,
        },
    })),

    defineSchema('node.rename', () => ({
        description: 'Renames the node at `node_path` to `new_name`.',
        inputSchema: {
            type: 'object',
            properties: {
                scene_path: scenePath,
                node_path: nodePath,
                new_name: { type: 'string', minLength: 1 },
            },
            required: ['scene_path', 'node_path', 'new_name'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { new_path: nodePath },
            required: ['new_path'],
            additionalProperties: true,
        },
    })),

    defineSchema('node.reparent', () => ({
        description: 'Reparents `node_path` under `new_parent_path`.',
        inputSchema: {
            type: 'object',
            properties: {
                scene_path: scenePath,
                node_path: nodePath,
                new_parent_path: nodePath,
            },
            required: ['scene_path', 'node_path', 'new_parent_path'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { new_path: nodePath },
            required: ['new_path'],
            additionalProperties: true,
        },
    })),

    defineSchema('node.duplicate', () => ({
        description:
            'Duplicates the node at `node_path`. `flags` mirrors Godot ' +
            '`Node.DUPLICATE_*` constants (signals, scripts, instancing).',
        inputSchema: {
            type: 'object',
            properties: {
                scene_path: scenePath,
                node_path: nodePath,
                flags: { type: 'integer' },
            },
            required: ['scene_path', 'node_path'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { new_path: nodePath },
            required: ['new_path'],
            additionalProperties: true,
        },
    })),

    defineSchema('node.find_by_type', () => ({
        description:
            'Returns every node whose Godot type matches `type`, optionally ' +
            'starting from `root` instead of the scene root.',
        inputSchema: {
            type: 'object',
            properties: {
                type: { type: 'string', minLength: 1 },
                root: nodePath,
            },
            required: ['type'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                matches: { type: 'array', items: nodePath },
            },
            required: ['matches'],
            additionalProperties: true,
        },
    })),

    defineSchema('node.find_by_name', () => ({
        description:
            'Returns every node whose name matches `name`. When `regex` is ' +
            'true, `name` is treated as a regular expression.',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', minLength: 1 },
                root: nodePath,
                regex: { type: 'boolean' },
            },
            required: ['name'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { matches: { type: 'array', items: nodePath } },
            required: ['matches'],
            additionalProperties: true,
        },
    })),

    defineSchema('node.get_signals', () => ({
        description: 'Lists every signal exposed by the node at `node_path`.',
        inputSchema: {
            type: 'object',
            properties: { node_path: nodePath },
            required: ['node_path'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                signals: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            name: { type: 'string' },
                            args: { type: 'array' },
                        },
                        required: ['name'],
                        additionalProperties: true,
                    },
                },
            },
            required: ['signals'],
            additionalProperties: true,
        },
    })),

    defineSchema('node.connect_signal', () => ({
        description:
            'Connects `signal` from `from_path` to `method` on `to_path`. ' +
            '`flags` mirrors Godot `Object.CONNECT_*` constants.',
        inputSchema: {
            type: 'object',
            properties: {
                from_path: nodePath,
                signal: { type: 'string', minLength: 1 },
                to_path: nodePath,
                method: { type: 'string', minLength: 1 },
                flags: { type: 'integer' },
            },
            required: ['from_path', 'signal', 'to_path', 'method'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { connected: { type: 'boolean' } },
            required: ['connected'],
            additionalProperties: true,
        },
    })),

    defineSchema('node.disconnect_signal', () => ({
        description:
            'Disconnects the connection identified by `(from_path, signal, ' +
            'to_path, method)`.',
        inputSchema: {
            type: 'object',
            properties: {
                from_path: nodePath,
                signal: { type: 'string', minLength: 1 },
                to_path: nodePath,
                method: { type: 'string', minLength: 1 },
            },
            required: ['from_path', 'signal', 'to_path', 'method'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { disconnected: { type: 'boolean' } },
            required: ['disconnected'],
            additionalProperties: true,
        },
    })),

    defineSchema('node.call_method', () => ({
        description:
            'Invokes the runtime method `method` on `node_path` with the ' +
            'positional arguments in `args`.',
        inputSchema: {
            type: 'object',
            properties: {
                node_path: nodePath,
                method: { type: 'string', minLength: 1 },
                args: { type: 'array' },
            },
            required: ['node_path', 'method'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { result: {} },
            additionalProperties: true,
        },
    })),
] as const;
