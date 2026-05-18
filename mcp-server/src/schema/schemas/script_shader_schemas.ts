/**
 * Schemas for `gdscript.*`, `script.*`, and `shader.*` tools.
 *
 * Coverage:
 *   - 2 GDScript tools (validate, save_with_validation)
 *   - 6 script tools (load, create, attach, detach, list_classes,
 *     get_documentation)
 *   - 6 shader tools (create, validate, save_with_validation,
 *     set_uniform, list_uniforms, convert_visual_to_text)
 *
 * Reference: design.md sections 5.4.4 and 5.4.13.
 */

import { defineSchema, type ToolSchema } from '../define_schema.js';
import {
    nodePath,
    resourcePath,
    scenePath,
    validatorOutput,
} from './_common.js';

export const scriptShaderSchemas: ReadonlyArray<ToolSchema> = [
    defineSchema('gdscript.validate', () => ({
        description:
            'Compiles GDScript `source` and returns whether parsing succeeded ' +
            'plus a list of `{line, col, msg}` diagnostics.',
        inputSchema: {
            type: 'object',
            properties: { source: { type: 'string' } },
            required: ['source'],
            additionalProperties: false,
        },
        outputSchema: validatorOutput,
    })),

    defineSchema('gdscript.save_with_validation', () => ({
        description:
            'Validates `source` and, when valid, writes it to `path`. Reload ' +
            'is requested in the editor on success.',
        inputSchema: {
            type: 'object',
            properties: {
                path: resourcePath,
                source: { type: 'string' },
            },
            required: ['path', 'source'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                saved: { type: 'boolean' },
                reloaded: { type: 'boolean' },
            },
            required: ['saved'],
            additionalProperties: true,
        },
    })),

    defineSchema('script.load', () => ({
        description:
            'Loads the script at `path` and returns its source plus declared ' +
            '`class_name` / `extends`.',
        inputSchema: {
            type: 'object',
            properties: { path: resourcePath },
            required: ['path'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                source: { type: 'string' },
                class_name: { type: 'string' },
                extends: { type: 'string' },
            },
            required: ['source'],
            additionalProperties: true,
        },
    })),

    defineSchema('script.create', () => ({
        description:
            'Creates a new GDScript at `path` with the supplied `base_class` ' +
            'and optional `template` body.',
        inputSchema: {
            type: 'object',
            properties: {
                path: resourcePath,
                base_class: { type: 'string', minLength: 1 },
                template: { type: 'string' },
            },
            required: ['path', 'base_class'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { created: { type: 'boolean' } },
            required: ['created'],
            additionalProperties: true,
        },
    })),

    defineSchema('script.attach', () => ({
        description:
            'Attaches the script at `script_path` to the node at `node_path` ' +
            'inside `scene_path`.',
        inputSchema: {
            type: 'object',
            properties: {
                scene_path: scenePath,
                node_path: nodePath,
                script_path: resourcePath,
            },
            required: ['scene_path', 'node_path', 'script_path'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { attached: { type: 'boolean' } },
            required: ['attached'],
            additionalProperties: true,
        },
    })),

    defineSchema('script.detach', () => ({
        description: 'Removes the script attached to `node_path`.',
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
            properties: { detached: { type: 'boolean' } },
            required: ['detached'],
            additionalProperties: true,
        },
    })),

    defineSchema('script.list_classes', () => ({
        description:
            'Returns every `class_name`-tagged script in the project, ' +
            'optionally filtered by name pattern.',
        inputSchema: {
            type: 'object',
            properties: { filter: { type: 'string' } },
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                classes: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            name: { type: 'string' },
                            path: { type: 'string' },
                            extends: { type: 'string' },
                        },
                        required: ['name', 'path'],
                        additionalProperties: true,
                    },
                },
            },
            required: ['classes'],
            additionalProperties: true,
        },
    })),

    defineSchema('script.get_documentation', () => ({
        description:
            'Returns the docstring and exported member list for `class_name`.',
        inputSchema: {
            type: 'object',
            properties: { class_name: { type: 'string', minLength: 1 } },
            required: ['class_name'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                doc_string: { type: 'string' },
                members: { type: 'array' },
            },
            required: ['doc_string', 'members'],
            additionalProperties: true,
        },
    })),

    defineSchema('shader.create', () => ({
        description:
            'Creates a new `.gdshader` at `path`, optionally seeded from a ' +
            '`template` (e.g. "spatial" or "canvas_item").',
        inputSchema: {
            type: 'object',
            properties: {
                path: resourcePath,
                template: { type: 'string' },
            },
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

    defineSchema('shader.validate', () => ({
        description:
            'Compiles shader `source` and returns whether it parses plus any ' +
            'diagnostics.',
        inputSchema: {
            type: 'object',
            properties: { source: { type: 'string' } },
            required: ['source'],
            additionalProperties: false,
        },
        outputSchema: validatorOutput,
    })),

    defineSchema('shader.save_with_validation', () => ({
        description:
            'Validates shader `source` and, when valid, writes it to `path`.',
        inputSchema: {
            type: 'object',
            properties: {
                path: resourcePath,
                source: { type: 'string' },
            },
            required: ['path', 'source'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { saved: { type: 'boolean' } },
            required: ['saved'],
            additionalProperties: true,
        },
    })),

    defineSchema('shader.set_uniform', () => ({
        description: 'Sets `uniform` on the material at `material_path` to `value`.',
        inputSchema: {
            type: 'object',
            properties: {
                material_path: resourcePath,
                uniform: { type: 'string', minLength: 1 },
                value: {},
            },
            required: ['material_path', 'uniform', 'value'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { applied: { type: 'boolean' } },
            required: ['applied'],
            additionalProperties: true,
        },
    })),

    defineSchema('shader.list_uniforms', () => ({
        description: 'Lists every uniform declared on the material at `material_path`.',
        inputSchema: {
            type: 'object',
            properties: { material_path: resourcePath },
            required: ['material_path'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                uniforms: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            name: { type: 'string' },
                            type: { type: 'string' },
                            default: {},
                        },
                        required: ['name', 'type'],
                        additionalProperties: true,
                    },
                },
            },
            required: ['uniforms'],
            additionalProperties: true,
        },
    })),

    defineSchema('shader.convert_visual_to_text', () => ({
        description:
            'Converts the VisualShader at `visual_shader_path` to a textual ' +
            '.gdshader at `target_path`.',
        inputSchema: {
            type: 'object',
            properties: {
                visual_shader_path: resourcePath,
                target_path: resourcePath,
            },
            required: ['visual_shader_path', 'target_path'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { saved: { type: 'boolean' } },
            required: ['saved'],
            additionalProperties: true,
        },
    })),
] as const;
