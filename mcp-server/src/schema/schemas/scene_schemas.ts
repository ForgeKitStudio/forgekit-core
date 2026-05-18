/**
 * Schemas for the `scene.*` tool family (9 tools in profiles.json).
 *
 * Reference: design.md section 5.4.2.
 */

import { defineSchema, type ToolSchema } from '../define_schema.js';
import { dictBag, nodePath, scenePath, transform } from './_common.js';

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

export const sceneSchemas: ReadonlyArray<ToolSchema> = [
    defineSchema('scene.open', () => ({
        description: 'Opens a scene file in the editor and returns its node count.',
        inputSchema: {
            type: 'object',
            properties: { scene_path: scenePath },
            required: ['scene_path'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                node_count: { type: 'integer', minimum: 0 },
                root_path: nodePath,
            },
            required: ['node_count', 'root_path'],
            additionalProperties: true,
        },
    })),

    defineSchema('scene.save', () => ({
        description:
            'Saves the active or specified scene to disk. Returns the resolved ' +
            'path and final byte size.',
        inputSchema: {
            type: 'object',
            properties: { scene_path: scenePath },
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                saved_path: { type: 'string' },
                size_bytes: { type: 'integer', minimum: 0 },
            },
            required: ['saved_path', 'size_bytes'],
            additionalProperties: true,
        },
    })),

    defineSchema('scene.save_as', () => ({
        description: 'Saves the scene at `scene_path` to a new path `target_path`.',
        inputSchema: {
            type: 'object',
            properties: {
                scene_path: scenePath,
                target_path: scenePath,
            },
            required: ['scene_path', 'target_path'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { saved_path: { type: 'string' } },
            required: ['saved_path'],
            additionalProperties: true,
        },
    })),

    defineSchema('scene.close', () => ({
        description: 'Closes the open scene matching `scene_path`.',
        inputSchema: {
            type: 'object',
            properties: { scene_path: scenePath },
            required: ['scene_path'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { closed: { type: 'boolean' } },
            required: ['closed'],
            additionalProperties: true,
        },
    })),

    defineSchema('scene.list_open', () => ({
        description: 'Lists every scene currently open in the editor.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        outputSchema: {
            type: 'object',
            properties: {
                scenes: {
                    type: 'array',
                    items: { type: 'string' },
                },
            },
            required: ['scenes'],
            additionalProperties: true,
        },
    })),

    defineSchema('scene.get_tree', () => ({
        description:
            'Returns the scene tree as a recursive `{path, type, children[]}` ' +
            'structure, optionally bounded by `max_depth`.',
        inputSchema: {
            type: 'object',
            properties: {
                scene_path: scenePath,
                max_depth: { type: 'integer', minimum: 1 },
            },
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { tree: sceneTreeNode },
            required: ['tree'],
            additionalProperties: true,
        },
    })),

    defineSchema('scene.get_tree_snapshot', () => ({
        description:
            'Runtime equivalent of `scene.get_tree`: returns the live scene ' +
            'tree plus the snapshot timestamp `ts`.',
        inputSchema: {
            type: 'object',
            properties: { max_depth: { type: 'integer', minimum: 1 } },
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                tree: sceneTreeNode,
                ts: { type: ['integer', 'string'] },
            },
            required: ['tree', 'ts'],
            additionalProperties: true,
        },
    })),

    defineSchema('scene.instantiate', () => ({
        description:
            'Instantiates the packed scene at `scene_path` under `parent_path`.',
        inputSchema: {
            type: 'object',
            properties: {
                scene_path: scenePath,
                parent_path: nodePath,
                transform: transform,
            },
            required: ['scene_path', 'parent_path'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { node_path: nodePath },
            required: ['node_path'],
            additionalProperties: true,
        },
    })),

    defineSchema('scene.create', () => ({
        description:
            'Creates a fresh `.tscn` at `scene_path` with a single root node ' +
            'of type `root_type` named `root_name`.',
        inputSchema: {
            type: 'object',
            properties: {
                scene_path: scenePath,
                root_type: { type: 'string', minLength: 1 },
                root_name: { type: 'string', minLength: 1 },
            },
            required: ['scene_path', 'root_type', 'root_name'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { saved_path: { type: 'string' } },
            required: ['saved_path'],
            additionalProperties: true,
        },
    })),
] as const;
