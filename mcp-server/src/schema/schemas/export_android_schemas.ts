/**
 * Schemas for `export.*` and `android.*` tools (6 tools).
 *
 * Reference: design.md sections 5.4.14 and 5.4.26.
 */

import { defineSchema, type ToolSchema } from '../define_schema.js';

export const exportAndroidSchemas: ReadonlyArray<ToolSchema> = [
    defineSchema('export.list_presets', () => ({
        description: 'Lists every export preset configured in `export_presets.cfg`.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        outputSchema: {
            type: 'object',
            properties: {
                presets: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            name: { type: 'string' },
                            platform: { type: 'string' },
                        },
                        required: ['name', 'platform'],
                        additionalProperties: true,
                    },
                },
            },
            required: ['presets'],
            additionalProperties: true,
        },
    })),

    defineSchema('export.run_preset', () => ({
        description:
            'Runs the export preset `preset_name`, writing the artifact to ' +
            '`output_path`. When `debug` is true, exports a debug build.',
        inputSchema: {
            type: 'object',
            properties: {
                preset_name: { type: 'string', minLength: 1 },
                output_path: { type: 'string', minLength: 1 },
                debug: { type: 'boolean' },
            },
            required: ['preset_name', 'output_path'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                success: { type: 'boolean' },
                log_path: { type: 'string' },
                artifact_path: { type: 'string' },
            },
            required: ['success', 'log_path', 'artifact_path'],
            additionalProperties: true,
        },
    })),

    defineSchema('export.validate_preset', () => ({
        description:
            'Validates the export preset `preset_name` and returns warnings ' +
            'plus any blocking errors.',
        inputSchema: {
            type: 'object',
            properties: { preset_name: { type: 'string', minLength: 1 } },
            required: ['preset_name'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                ok: { type: 'boolean' },
                warnings: { type: 'array', items: { type: 'string' } },
                errors: { type: 'array', items: { type: 'string' } },
            },
            required: ['ok'],
            additionalProperties: true,
        },
    })),

    defineSchema('android.list_devices', () => ({
        description: 'Returns every Android device currently visible to `adb`.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        outputSchema: {
            type: 'object',
            properties: {
                devices: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            serial: { type: 'string' },
                            model: { type: 'string' },
                        },
                        required: ['serial'],
                        additionalProperties: true,
                    },
                },
            },
            required: ['devices'],
            additionalProperties: true,
        },
    })),

    defineSchema('android.install_apk', () => ({
        description:
            'Installs the APK at `apk_path` to the device matching ' +
            '`device_serial`. Defaults to the only attached device.',
        inputSchema: {
            type: 'object',
            properties: {
                apk_path: { type: 'string', minLength: 1 },
                device_serial: { type: 'string' },
            },
            required: ['apk_path'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                installed: { type: 'boolean' },
                package: { type: 'string' },
            },
            required: ['installed'],
            additionalProperties: true,
        },
    })),

    defineSchema('android.run_logcat', () => ({
        description:
            'Captures `adb logcat` lines, optionally filtered by `filter` and ' +
            'limited to `duration_ms` of capture time.',
        inputSchema: {
            type: 'object',
            properties: {
                filter: { type: 'string' },
                duration_ms: { type: 'integer', minimum: 1 },
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
