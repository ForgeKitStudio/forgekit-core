/**
 * Schemas for `scene3d.*` tools (6 tools).
 *
 * Reference: design.md section 5.4.17.
 */

import { defineSchema, type ToolSchema } from '../define_schema.js';
import {
    appliedOutput,
    dictBag,
    nodePath,
    resourcePath,
    transform,
} from './_common.js';

export const scene3dSchemas: ReadonlyArray<ToolSchema> = [
    defineSchema('scene3d.add_mesh_instance', () => ({
        description:
            'Adds a `MeshInstance3D` under `parent_path` referencing the mesh ' +
            'at `mesh_path` with optional initial `transform`.',
        inputSchema: {
            type: 'object',
            properties: {
                scene_path: { type: 'string', minLength: 1 },
                parent_path: nodePath,
                mesh_path: resourcePath,
                transform: transform,
            },
            required: ['scene_path', 'parent_path', 'mesh_path'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { node_path: nodePath },
            required: ['node_path'],
            additionalProperties: true,
        },
    })),

    defineSchema('scene3d.add_light', () => ({
        description:
            'Adds a 3D light of type `type` ("directional", "omni", "spot") ' +
            'under `parent_path`.',
        inputSchema: {
            type: 'object',
            properties: {
                scene_path: { type: 'string', minLength: 1 },
                parent_path: nodePath,
                type: { type: 'string', enum: ['directional', 'omni', 'spot'] },
                transform: transform,
                params: dictBag,
            },
            required: ['scene_path', 'parent_path', 'type'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { node_path: nodePath },
            required: ['node_path'],
            additionalProperties: true,
        },
    })),

    defineSchema('scene3d.add_camera', () => ({
        description:
            'Adds a `Camera3D` under `parent_path`. When `current` is true, ' +
            'the new camera becomes the active camera.',
        inputSchema: {
            type: 'object',
            properties: {
                scene_path: { type: 'string', minLength: 1 },
                parent_path: nodePath,
                transform: transform,
                current: { type: 'boolean' },
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

    defineSchema('scene3d.set_environment', () => ({
        description: 'Applies the `Environment` resource at `env_path` to the scene.',
        inputSchema: {
            type: 'object',
            properties: {
                scene_path: { type: 'string', minLength: 1 },
                env_path: resourcePath,
            },
            required: ['scene_path', 'env_path'],
            additionalProperties: false,
        },
        outputSchema: appliedOutput,
    })),

    defineSchema('scene3d.bake_lightmap', () => ({
        description:
            'Bakes the `LightmapGI` for the scene at `scene_path` with the ' +
            'requested `quality`.',
        inputSchema: {
            type: 'object',
            properties: {
                scene_path: { type: 'string', minLength: 1 },
                quality: { type: 'string', enum: ['low', 'medium', 'high', 'ultra'] },
            },
            required: ['scene_path'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                baked: { type: 'boolean' },
                duration_ms: { type: 'integer', minimum: 0 },
            },
            required: ['baked', 'duration_ms'],
            additionalProperties: true,
        },
    })),

    defineSchema('scene3d.import_gltf', () => ({
        description:
            'Imports a glTF asset from `source_path` (filesystem) to ' +
            '`target_path` inside the project.',
        inputSchema: {
            type: 'object',
            properties: {
                source_path: { type: 'string', minLength: 1 },
                target_path: resourcePath,
            },
            required: ['source_path', 'target_path'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                saved: { type: 'boolean' },
                node_count: { type: 'integer', minimum: 0 },
            },
            required: ['saved', 'node_count'],
            additionalProperties: true,
        },
    })),
] as const;
