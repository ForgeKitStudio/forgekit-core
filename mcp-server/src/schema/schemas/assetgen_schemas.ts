/**
 * Schemas for `assetgen.*` tools (4 tools).
 *
 * Reference: design.md section 5.4.33.
 */

import { defineSchema, type ToolSchema } from '../define_schema.js';
import { resourcePath } from './_common.js';

export const assetgenSchemas: ReadonlyArray<ToolSchema> = [
    defineSchema('assetgen.sprite_from_svg', () => ({
        description:
            'Rasterizes the SVG `svg_source` at `size` (defaults to native ' +
            'viewBox) and writes the PNG to `target_path`.',
        inputSchema: {
            type: 'object',
            properties: {
                svg_source: { type: 'string', minLength: 1 },
                target_path: resourcePath,
                size: {
                    type: 'array',
                    items: { type: 'integer', minimum: 1 },
                    minItems: 2,
                    maxItems: 2,
                },
            },
            required: ['svg_source', 'target_path'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                saved_path: { type: 'string' },
                width: { type: 'integer', minimum: 1 },
                height: { type: 'integer', minimum: 1 },
            },
            required: ['saved_path', 'width', 'height'],
            additionalProperties: true,
        },
    })),

    defineSchema('assetgen.atlas_pack', () => ({
        description:
            'Packs every PNG in `source_paths` into a single atlas at ' +
            '`target_path`, optionally clamped to `max_size` per side.',
        inputSchema: {
            type: 'object',
            properties: {
                source_paths: {
                    type: 'array',
                    items: resourcePath,
                    minItems: 1,
                },
                target_path: resourcePath,
                max_size: { type: 'integer', minimum: 64 },
            },
            required: ['source_paths', 'target_path'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                saved_path: { type: 'string' },
                regions: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            source: { type: 'string' },
                            x: { type: 'integer', minimum: 0 },
                            y: { type: 'integer', minimum: 0 },
                            w: { type: 'integer', minimum: 1 },
                            h: { type: 'integer', minimum: 1 },
                        },
                        required: ['source', 'x', 'y', 'w', 'h'],
                        additionalProperties: false,
                    },
                },
            },
            required: ['saved_path', 'regions'],
            additionalProperties: true,
        },
    })),

    defineSchema('assetgen.noise_texture', () => ({
        description:
            'Generates a procedural noise texture and writes it to `target_path`.',
        inputSchema: {
            type: 'object',
            properties: {
                target_path: resourcePath,
                width: { type: 'integer', minimum: 1 },
                height: { type: 'integer', minimum: 1 },
                noise_type: {
                    type: 'string',
                    enum: ['perlin', 'simplex', 'cellular', 'value'],
                },
                seed: { type: 'integer' },
            },
            required: ['target_path', 'width', 'height', 'noise_type'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { saved_path: { type: 'string' } },
            required: ['saved_path'],
            additionalProperties: true,
        },
    })),

    defineSchema('assetgen.icon_set', () => ({
        description:
            'Renders the SVG at `source_svg` at every size in `sizes` and ' +
            'writes the PNG icons to `target_dir`.',
        inputSchema: {
            type: 'object',
            properties: {
                source_svg: { type: 'string', minLength: 1 },
                target_dir: resourcePath,
                sizes: {
                    type: 'array',
                    items: { type: 'integer', minimum: 1 },
                    minItems: 1,
                },
            },
            required: ['source_svg', 'target_dir', 'sizes'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { files: { type: 'array', items: { type: 'string' } } },
            required: ['files'],
            additionalProperties: true,
        },
    })),
] as const;
