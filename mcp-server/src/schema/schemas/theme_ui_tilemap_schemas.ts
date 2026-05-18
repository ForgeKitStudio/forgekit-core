/**
 * Schemas for `theme.*`, `ui.*`, and `tilemap.*` tools (12 tools).
 *
 * Reference: design.md sections 5.4.10 and 5.4.9.
 */

import { defineSchema, type ToolSchema } from '../define_schema.js';
import {
    appliedOutput,
    appliedPreviousOutput,
    dictBag,
    nodePath,
    resourcePath,
    vector2,
} from './_common.js';

export const themeUiTilemapSchemas: ReadonlyArray<ToolSchema> = [
    defineSchema('theme.create', () => ({
        description: 'Creates an empty `Theme` resource at `path`.',
        inputSchema: {
            type: 'object',
            properties: { path: resourcePath },
            required: ['path'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { created: { type: 'boolean' } },
            required: ['created'],
            additionalProperties: true,
        },
    })),

    defineSchema('theme.set_default_font', () => ({
        description:
            'Sets the default `Font` of the Theme at `path` to `font_path` ' +
            'with the given pixel `size`.',
        inputSchema: {
            type: 'object',
            properties: {
                path: resourcePath,
                font_path: resourcePath,
                size: { type: 'integer', minimum: 1 },
            },
            required: ['path', 'font_path', 'size'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { applied: { type: 'boolean' } },
            required: ['applied'],
            additionalProperties: true,
        },
    })),

    defineSchema('theme.set_color', () => ({
        description:
            'Sets a `Theme` color override for `control_type` and ' +
            '`color_name` to `value` (`#RRGGBB` or `#RRGGBBAA`).',
        inputSchema: {
            type: 'object',
            properties: {
                path: resourcePath,
                control_type: { type: 'string', minLength: 1 },
                color_name: { type: 'string', minLength: 1 },
                value: { type: 'string', minLength: 4 },
            },
            required: ['path', 'control_type', 'color_name', 'value'],
            additionalProperties: false,
        },
        outputSchema: appliedPreviousOutput,
    })),

    defineSchema('theme.set_stylebox', () => ({
        description:
            'Sets a `StyleBox` override for `control_type`/`stylebox_name` to ' +
            'the StyleBox resource at `stylebox_path`.',
        inputSchema: {
            type: 'object',
            properties: {
                path: resourcePath,
                control_type: { type: 'string', minLength: 1 },
                stylebox_name: { type: 'string', minLength: 1 },
                stylebox_path: resourcePath,
            },
            required: ['path', 'control_type', 'stylebox_name', 'stylebox_path'],
            additionalProperties: false,
        },
        outputSchema: appliedOutput,
    })),

    defineSchema('ui.build_control_tree', () => ({
        description:
            'Materializes a Control tree under the scene at `scene_path` from ' +
            'the declarative `spec` dictionary.',
        inputSchema: {
            type: 'object',
            properties: {
                scene_path: { type: 'string', minLength: 1 },
                spec: dictBag,
            },
            required: ['scene_path', 'spec'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { root_path: nodePath },
            required: ['root_path'],
            additionalProperties: true,
        },
    })),

    defineSchema('ui.apply_layout_preset', () => ({
        description:
            'Applies the named layout preset (e.g. "anchors_full_rect", ' +
            '"center", "top_wide") to the Control at `node_path`.',
        inputSchema: {
            type: 'object',
            properties: {
                node_path: nodePath,
                preset: { type: 'string', minLength: 1 },
            },
            required: ['node_path', 'preset'],
            additionalProperties: false,
        },
        outputSchema: appliedOutput,
    })),

    defineSchema('tilemap.set_cell', () => ({
        description:
            'Sets a single cell on `node_path` (TileMapLayer or TileMap) at ' +
            '`coords` to a `source_id` / `atlas_coords` tile.',
        inputSchema: {
            type: 'object',
            properties: {
                node_path: nodePath,
                layer: { type: 'integer', minimum: 0 },
                coords: vector2,
                source_id: { type: 'integer' },
                atlas_coords: vector2,
            },
            required: ['node_path', 'layer', 'coords', 'source_id'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { set: { type: 'boolean' } },
            required: ['set'],
            additionalProperties: true,
        },
    })),

    defineSchema('tilemap.get_cell', () => ({
        description: 'Returns the tile data at `(layer, coords)`.',
        inputSchema: {
            type: 'object',
            properties: {
                node_path: nodePath,
                layer: { type: 'integer', minimum: 0 },
                coords: vector2,
            },
            required: ['node_path', 'layer', 'coords'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                source_id: { type: 'integer' },
                atlas_coords: vector2,
            },
            required: ['source_id', 'atlas_coords'],
            additionalProperties: true,
        },
    })),

    defineSchema('tilemap.fill_rect', () => ({
        description:
            'Fills the rectangle `rect` (Godot Rect2) on `layer` with the ' +
            'specified atlas tile.',
        inputSchema: {
            type: 'object',
            properties: {
                node_path: nodePath,
                layer: { type: 'integer', minimum: 0 },
                rect: dictBag,
                source_id: { type: 'integer' },
                atlas_coords: vector2,
            },
            required: ['node_path', 'layer', 'rect', 'source_id', 'atlas_coords'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { cells_changed: { type: 'integer', minimum: 0 } },
            required: ['cells_changed'],
            additionalProperties: true,
        },
    })),

    defineSchema('tilemap.clear_layer', () => ({
        description: 'Clears every cell on `layer`.',
        inputSchema: {
            type: 'object',
            properties: {
                node_path: nodePath,
                layer: { type: 'integer', minimum: 0 },
            },
            required: ['node_path', 'layer'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { cleared: { type: 'boolean' } },
            required: ['cleared'],
            additionalProperties: true,
        },
    })),

    defineSchema('tilemap.import_from_json', () => ({
        description: 'Replaces the tilemap layout from the JSON file at `json_path`.',
        inputSchema: {
            type: 'object',
            properties: {
                node_path: nodePath,
                json_path: resourcePath,
            },
            required: ['node_path', 'json_path'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                layers: { type: 'integer', minimum: 0 },
                cells: { type: 'integer', minimum: 0 },
            },
            required: ['layers', 'cells'],
            additionalProperties: true,
        },
    })),

    defineSchema('tilemap.export_to_json', () => ({
        description: 'Exports the current tilemap layout to JSON at `target_path`.',
        inputSchema: {
            type: 'object',
            properties: {
                node_path: nodePath,
                target_path: resourcePath,
            },
            required: ['node_path', 'target_path'],
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
