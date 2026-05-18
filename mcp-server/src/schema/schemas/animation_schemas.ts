/**
 * Schemas for `animation.*`, `animation_tree.*`, `state_machine.*`, and
 * `blend_tree.*` tools (14 tools total).
 *
 * Reference: design.md sections 5.4.8, 5.4.21, 5.4.22, 5.4.23.
 */

import { defineSchema, type ToolSchema } from '../define_schema.js';
import { dictBag, nodePath } from './_common.js';

export const animationSchemas: ReadonlyArray<ToolSchema> = [
    defineSchema('animation.list', () => ({
        description: 'Returns every animation defined on the AnimationPlayer at `player_path`.',
        inputSchema: {
            type: 'object',
            properties: { player_path: nodePath },
            required: ['player_path'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                animations: { type: 'array', items: { type: 'string' } },
            },
            required: ['animations'],
            additionalProperties: true,
        },
    })),

    defineSchema('animation.play', () => ({
        description: 'Plays animation `name` on the AnimationPlayer at `player_path`.',
        inputSchema: {
            type: 'object',
            properties: {
                player_path: nodePath,
                name: { type: 'string', minLength: 1 },
                speed: { type: 'number' },
            },
            required: ['player_path', 'name'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { playing: { type: 'string' } },
            required: ['playing'],
            additionalProperties: true,
        },
    })),

    defineSchema('animation.stop', () => ({
        description: 'Stops the AnimationPlayer at `player_path`.',
        inputSchema: {
            type: 'object',
            properties: { player_path: nodePath },
            required: ['player_path'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { stopped: { type: 'boolean' } },
            required: ['stopped'],
            additionalProperties: true,
        },
    })),

    defineSchema('animation.add_track', () => ({
        description:
            'Adds a new track to `animation_name`. `track_type` mirrors ' +
            'Godot Animation.TYPE_* constants (e.g. "value", "method").',
        inputSchema: {
            type: 'object',
            properties: {
                player_path: nodePath,
                animation_name: { type: 'string', minLength: 1 },
                track_type: { type: 'string', minLength: 1 },
                path: { type: 'string', minLength: 1 },
            },
            required: ['player_path', 'animation_name', 'track_type', 'path'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { track_index: { type: 'integer', minimum: 0 } },
            required: ['track_index'],
            additionalProperties: true,
        },
    })),

    defineSchema('animation.insert_keyframe', () => ({
        description: 'Inserts a keyframe on `track` at `time` with `value`.',
        inputSchema: {
            type: 'object',
            properties: {
                player_path: nodePath,
                animation_name: { type: 'string', minLength: 1 },
                track: { type: 'integer', minimum: 0 },
                time: { type: 'number' },
                value: {},
            },
            required: ['player_path', 'animation_name', 'track', 'time', 'value'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { key_index: { type: 'integer', minimum: 0 } },
            required: ['key_index'],
            additionalProperties: true,
        },
    })),

    defineSchema('animation.remove_track', () => ({
        description: 'Removes the track at `track_index` from `animation_name`.',
        inputSchema: {
            type: 'object',
            properties: {
                player_path: nodePath,
                animation_name: { type: 'string', minLength: 1 },
                track_index: { type: 'integer', minimum: 0 },
            },
            required: ['player_path', 'animation_name', 'track_index'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { removed: { type: 'boolean' } },
            required: ['removed'],
            additionalProperties: true,
        },
    })),

    defineSchema('animation_tree.create', () => ({
        description:
            'Creates an AnimationTree under `parent_path` bound to ' +
            '`anim_player_path` for state-machine driven animation.',
        inputSchema: {
            type: 'object',
            properties: {
                scene_path: { type: 'string', minLength: 1 },
                parent_path: nodePath,
                anim_player_path: nodePath,
            },
            required: ['scene_path', 'parent_path', 'anim_player_path'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { node_path: nodePath },
            required: ['node_path'],
            additionalProperties: true,
        },
    })),

    defineSchema('animation_tree.set_parameter', () => ({
        description: 'Sets the AnimationTree parameter `param` to `value`.',
        inputSchema: {
            type: 'object',
            properties: {
                tree_path: nodePath,
                param: { type: 'string', minLength: 1 },
                value: {},
            },
            required: ['tree_path', 'param', 'value'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { applied: { type: 'boolean' } },
            required: ['applied'],
            additionalProperties: true,
        },
    })),

    defineSchema('animation_tree.get_parameters', () => ({
        description: 'Returns every parameter currently exposed by the AnimationTree.',
        inputSchema: {
            type: 'object',
            properties: { tree_path: nodePath },
            required: ['tree_path'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { parameters: dictBag },
            required: ['parameters'],
            additionalProperties: true,
        },
    })),

    defineSchema('animation_tree.set_active', () => ({
        description: 'Toggles the AnimationTree at `tree_path` active or inactive.',
        inputSchema: {
            type: 'object',
            properties: {
                tree_path: nodePath,
                active: { type: 'boolean' },
            },
            required: ['tree_path', 'active'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { active: { type: 'boolean' } },
            required: ['active'],
            additionalProperties: true,
        },
    })),

    defineSchema('state_machine.list_states', () => ({
        description:
            'Returns the list of states for the AnimationNodeStateMachine ' +
            'identified by `(tree_path, playback_param)`.',
        inputSchema: {
            type: 'object',
            properties: {
                tree_path: nodePath,
                playback_param: { type: 'string', minLength: 1 },
            },
            required: ['tree_path', 'playback_param'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                states: { type: 'array', items: { type: 'string' } },
            },
            required: ['states'],
            additionalProperties: true,
        },
    })),

    defineSchema('state_machine.travel', () => ({
        description: 'Requests the state machine to travel to `state_name`.',
        inputSchema: {
            type: 'object',
            properties: {
                tree_path: nodePath,
                playback_param: { type: 'string', minLength: 1 },
                state_name: { type: 'string', minLength: 1 },
            },
            required: ['tree_path', 'playback_param', 'state_name'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { travelled: { type: 'string' } },
            required: ['travelled'],
            additionalProperties: true,
        },
    })),

    defineSchema('state_machine.get_current', () => ({
        description: 'Returns the current state of the state machine.',
        inputSchema: {
            type: 'object',
            properties: {
                tree_path: nodePath,
                playback_param: { type: 'string', minLength: 1 },
            },
            required: ['tree_path', 'playback_param'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { current_state: { type: 'string' } },
            required: ['current_state'],
            additionalProperties: true,
        },
    })),

    defineSchema('blend_tree.configure_node', () => ({
        description:
            'Configures the blend tree node identified by `node_id` to be a ' +
            '`type` (e.g. "blend2", "blend_space_1d") with `params`.',
        inputSchema: {
            type: 'object',
            properties: {
                tree_path: nodePath,
                node_id: { type: 'string', minLength: 1 },
                type: { type: 'string', minLength: 1 },
                params: dictBag,
            },
            required: ['tree_path', 'node_id', 'type'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { applied: { type: 'boolean' } },
            required: ['applied'],
            additionalProperties: true,
        },
    })),
] as const;
