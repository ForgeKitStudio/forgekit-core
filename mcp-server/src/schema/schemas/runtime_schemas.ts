/**
 * Schemas for the `runtime.*` tool family (19 tools).
 *
 * Reference: design.md section 5.4.7.
 */

import { defineSchema, type ToolSchema } from '../define_schema.js';
import { dictBag, noParams, nodePath, scenePath } from './_common.js';

const sceneTreeNode = {
    type: 'object' as const,
    properties: {
        path: nodePath,
        type: { type: 'string' },
        children: { type: 'array' },
    },
    required: ['path', 'type'],
    additionalProperties: true,
};

export const runtimeSchemas: ReadonlyArray<ToolSchema> = [
    defineSchema('runtime.is_connected', () => ({
        description:
            'Returns whether the runtime UDP bridge is currently connected ' +
            'plus the bridge protocol version.',
        inputSchema: noParams,
        outputSchema: {
            type: 'object',
            properties: {
                connected: { type: 'boolean' },
                bridge_version: { type: 'string' },
            },
            required: ['connected'],
            additionalProperties: true,
        },
    })),

    defineSchema('runtime.handshake', () => ({
        description:
            'Establishes a runtime session. Authenticates the client using ' +
            '`auth_token` and returns the assigned `session_id` plus version ' +
            'metadata used for compat checks.',
        inputSchema: {
            type: 'object',
            properties: {
                client_id: { type: 'string', minLength: 1 },
                auth_token: { type: 'string' },
            },
            required: ['client_id'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                session_id: { type: 'string' },
                api_version: { type: 'string' },
                server: { type: 'object', additionalProperties: true },
                core_detected: { type: 'boolean' },
            },
            required: ['session_id', 'api_version'],
            additionalProperties: true,
        },
    })),

    defineSchema('runtime.heartbeat', () => ({
        description:
            'Roundtrip ping. Returns `pong` plus the server timestamp in ms.',
        inputSchema: noParams,
        outputSchema: {
            type: 'object',
            properties: {
                pong: { type: 'boolean' },
                ts: { type: ['integer', 'string'] },
            },
            required: ['pong', 'ts'],
            additionalProperties: true,
        },
    })),

    defineSchema('runtime.shutdown', () => ({
        description:
            'Stops the runtime bridge. When `graceful` is true, finishes ' +
            'in-flight requests before closing the socket.',
        inputSchema: {
            type: 'object',
            properties: { graceful: { type: 'boolean' } },
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { shutting_down: { type: 'boolean' } },
            required: ['shutting_down'],
            additionalProperties: true,
        },
    })),

    defineSchema('runtime.get_scene_tree', () => ({
        description: 'Returns the live scene tree, optionally bounded by `max_depth`.',
        inputSchema: {
            type: 'object',
            properties: { max_depth: { type: 'integer', minimum: 1 } },
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { tree: sceneTreeNode },
            required: ['tree'],
            additionalProperties: true,
        },
    })),

    defineSchema('runtime.get_current_scene', () => ({
        description: 'Returns the currently running scene path and its root node path.',
        inputSchema: noParams,
        outputSchema: {
            type: 'object',
            properties: {
                scene_path: { type: 'string' },
                root_path: nodePath,
            },
            required: ['scene_path', 'root_path'],
            additionalProperties: true,
        },
    })),

    defineSchema('runtime.change_scene', () => ({
        description: 'Changes the active scene to `scene_path`.',
        inputSchema: {
            type: 'object',
            properties: { scene_path: scenePath },
            required: ['scene_path'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { changed: { type: 'boolean' } },
            required: ['changed'],
            additionalProperties: true,
        },
    })),

    defineSchema('runtime.reload_current_scene', () => ({
        description: 'Reloads the active scene from disk.',
        inputSchema: noParams,
        outputSchema: {
            type: 'object',
            properties: { reloaded: { type: 'boolean' } },
            required: ['reloaded'],
            additionalProperties: true,
        },
    })),

    defineSchema('runtime.pause', () => ({
        description: 'Pauses the SceneTree.',
        inputSchema: noParams,
        outputSchema: {
            type: 'object',
            properties: { paused: { type: 'boolean' } },
            required: ['paused'],
            additionalProperties: true,
        },
    })),

    defineSchema('runtime.resume', () => ({
        description: 'Resumes the SceneTree.',
        inputSchema: noParams,
        outputSchema: {
            type: 'object',
            properties: { paused: { type: 'boolean' } },
            required: ['paused'],
            additionalProperties: true,
        },
    })),

    defineSchema('runtime.set_time_scale', () => ({
        description:
            'Sets `Engine.time_scale` to `scale`. Returns the new value plus ' +
            'the previous one.',
        inputSchema: {
            type: 'object',
            properties: { scale: { type: 'number', minimum: 0 } },
            required: ['scale'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                time_scale: { type: 'number', minimum: 0 },
                previous: { type: 'number', minimum: 0 },
            },
            required: ['time_scale', 'previous'],
            additionalProperties: true,
        },
    })),

    defineSchema('runtime.get_time_scale', () => ({
        description: 'Returns the current `Engine.time_scale` value.',
        inputSchema: noParams,
        outputSchema: {
            type: 'object',
            properties: { time_scale: { type: 'number', minimum: 0 } },
            required: ['time_scale'],
            additionalProperties: true,
        },
    })),

    defineSchema('runtime.screenshot', () => ({
        description:
            'Captures the runtime viewport. `format` is the image encoding ' +
            '(`"png"` for now).',
        inputSchema: {
            type: 'object',
            properties: { format: { type: 'string', enum: ['png'] } },
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                base64_png: { type: 'string' },
                size_bytes: { type: 'integer', minimum: 0 },
            },
            required: ['base64_png', 'size_bytes'],
            additionalProperties: true,
        },
    })),

    defineSchema('runtime.get_fps', () => ({
        description: 'Returns the current FPS and last frame time.',
        inputSchema: noParams,
        outputSchema: {
            type: 'object',
            properties: {
                fps: { type: 'number', minimum: 0 },
                frame_time_ms: { type: 'number', minimum: 0 },
            },
            required: ['fps', 'frame_time_ms'],
            additionalProperties: true,
        },
    })),

    defineSchema('runtime.list_autoloads', () => ({
        description: 'Returns the list of registered autoloads.',
        inputSchema: noParams,
        outputSchema: {
            type: 'object',
            properties: {
                autoloads: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            name: { type: 'string' },
                            path: { type: 'string' },
                        },
                        required: ['name', 'path'],
                        additionalProperties: true,
                    },
                },
            },
            required: ['autoloads'],
            additionalProperties: true,
        },
    })),

    defineSchema('runtime.get_autoload', () => ({
        description: 'Returns the exposed properties of the autoload `name`.',
        inputSchema: {
            type: 'object',
            properties: { name: { type: 'string', minLength: 1 } },
            required: ['name'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { properties: dictBag },
            required: ['properties'],
            additionalProperties: true,
        },
    })),

    defineSchema('runtime.eval_safe', () => ({
        description:
            'Evaluates the expression `expr` against the runtime scope using ' +
            'a whitelisted grammar.',
        inputSchema: {
            type: 'object',
            properties: { expr: { type: 'string', minLength: 1 } },
            required: ['expr'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { result: {} },
            required: ['result'],
            additionalProperties: true,
        },
    })),

    defineSchema('runtime.emit_event', () => ({
        description:
            'Emits a GameEvents signal with the supplied `payload`. Validates ' +
            'against the bound `_SIGNAL_SCHEMAS` entry.',
        inputSchema: {
            type: 'object',
            properties: {
                signal_name: { type: 'string', minLength: 1 },
                payload: dictBag,
            },
            required: ['signal_name', 'payload'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { emitted: { type: 'boolean' } },
            required: ['emitted'],
            additionalProperties: true,
        },
    })),

    defineSchema('runtime.get_logs', () => ({
        description:
            'Returns up to `max_lines` recent log lines, filtered by ' +
            'minimum `level`.',
        inputSchema: {
            type: 'object',
            properties: {
                max_lines: { type: 'integer', minimum: 1 },
                level: { type: 'string', enum: ['debug', 'info', 'warning', 'error'] },
            },
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { lines: { type: 'array', items: { type: 'string' } } },
            required: ['lines'],
            additionalProperties: true,
        },
    })),
] as const;
