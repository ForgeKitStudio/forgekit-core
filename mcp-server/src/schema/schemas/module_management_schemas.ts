/**
 * Schemas for `modules.*` tools (7 tools).
 *
 * Reference: design.md section 5.4.31.
 */

import { defineSchema, type ToolSchema } from '../define_schema.js';
import { dictBag } from './_common.js';

const moduleEntry = {
    type: 'object' as const,
    properties: {
        id: { type: 'string' },
        version: { type: 'string' },
        license_id: { type: 'string' },
        core_min_version: { type: 'string' },
        source_repo: { type: 'string' },
        enabled: { type: 'boolean' },
    },
    required: ['id', 'version'],
    additionalProperties: true,
};

export const moduleManagementSchemas: ReadonlyArray<ToolSchema> = [
    defineSchema('modules.list', () => ({
        description: 'Lists every installed module along with manifest metadata.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        outputSchema: {
            type: 'object',
            properties: {
                modules: { type: 'array', items: moduleEntry },
            },
            required: ['modules'],
            additionalProperties: true,
        },
    })),

    defineSchema('modules.inspect_manifest', () => ({
        description:
            'Returns the parsed manifest fields for `module_id`, plus any ' +
            'detected issues.',
        inputSchema: {
            type: 'object',
            properties: { module_id: { type: 'string', minLength: 1 } },
            required: ['module_id'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                manifest_fields: dictBag,
                issues: { type: 'array', items: { type: 'string' } },
            },
            required: ['manifest_fields'],
            additionalProperties: true,
        },
    })),

    defineSchema('modules.enable', () => ({
        description: 'Enables `module_id` (registers autoloads, plugin.cfg, addons).',
        inputSchema: {
            type: 'object',
            properties: { module_id: { type: 'string', minLength: 1 } },
            required: ['module_id'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { enabled: { type: 'boolean' } },
            required: ['enabled'],
            additionalProperties: true,
        },
    })),

    defineSchema('modules.disable', () => ({
        description: 'Disables `module_id` (deregisters autoloads, plugin.cfg).',
        inputSchema: {
            type: 'object',
            properties: { module_id: { type: 'string', minLength: 1 } },
            required: ['module_id'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { enabled: { type: 'boolean' } },
            required: ['enabled'],
            additionalProperties: true,
        },
    })),

    defineSchema('modules.check_compatibility', () => ({
        description:
            'Compares `module_id`\'s `core_min_version` to the installed ' +
            'forgekit-core version (or the override `core_version`).',
        inputSchema: {
            type: 'object',
            properties: {
                module_id: { type: 'string', minLength: 1 },
                core_version: { type: 'string' },
            },
            required: ['module_id'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                compatible: { type: 'boolean' },
                required: { type: 'string' },
                installed: { type: 'string' },
            },
            required: ['compatible', 'required', 'installed'],
            additionalProperties: true,
        },
    })),

    defineSchema('modules.activate_license', () => ({
        description:
            'Activates the license `license_key` for `module_id`. Successful ' +
            'activation unlocks every subsystem the license owns.',
        inputSchema: {
            type: 'object',
            properties: {
                module_id: { type: 'string', minLength: 1 },
                license_key: { type: 'string', minLength: 1 },
            },
            required: ['module_id', 'license_key'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                activated: { type: 'boolean' },
                license_id: { type: 'string' },
            },
            required: ['activated'],
            additionalProperties: true,
        },
    })),

    defineSchema('modules.core_version', () => ({
        description:
            'Returns the installed `forgekit-core` version (SemVer) and the ' +
            'matching git tag, when available.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        outputSchema: {
            type: 'object',
            properties: {
                version: { type: 'string' },
                tag: { type: 'string' },
            },
            required: ['version'],
            additionalProperties: true,
        },
    })),
] as const;
