/**
 * Schemas for `profiling.*` tools (2 tools).
 *
 * Reference: design.md section 5.4.11.
 */

import { defineSchema, type ToolSchema } from '../define_schema.js';

export const profilingSchemas: ReadonlyArray<ToolSchema> = [
    defineSchema('profiling.get_performance_monitors', () => ({
        description:
            'Returns the requested Godot `Performance.MONITOR_*` values. ' +
            'When `monitors` is omitted, returns every standard monitor.',
        inputSchema: {
            type: 'object',
            properties: {
                monitors: { type: 'array', items: { type: 'string' } },
            },
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                monitors: {
                    type: 'object',
                    additionalProperties: { type: 'number' },
                },
            },
            required: ['monitors'],
            additionalProperties: true,
        },
    })),

    defineSchema('profiling.get_frame_stats', () => ({
        description:
            'Returns aggregate frame statistics over the last ' +
            '`window_frames` rendered frames (default 60).',
        inputSchema: {
            type: 'object',
            properties: { window_frames: { type: 'integer', minimum: 1 } },
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                avg_fps: { type: 'number', minimum: 0 },
                p95_frame_ms: { type: 'number', minimum: 0 },
                draw_calls: { type: 'integer', minimum: 0 },
            },
            required: ['avg_fps', 'p95_frame_ms', 'draw_calls'],
            additionalProperties: true,
        },
    })),
] as const;
