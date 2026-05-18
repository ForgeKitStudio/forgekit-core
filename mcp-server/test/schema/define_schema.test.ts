/**
 * Unit tests for `defineSchema` invariant checks.
 */

import { describe, expect, it } from 'vitest';

import { defineSchema } from '../../src/schema/define_schema.js';

describe('defineSchema', () => {
    it('produces a frozen ToolSchema with the supplied fields', () => {
        const schema = defineSchema('demo.tool', () => ({
            description: 'Demo tool',
            inputSchema: {
                type: 'object',
                properties: { x: { type: 'string' } },
                required: ['x'],
                additionalProperties: false,
            },
            outputSchema: {
                type: 'object',
                properties: { ok: { type: 'boolean' } },
                required: ['ok'],
                additionalProperties: false,
            },
        }));
        expect(schema.name).toBe('demo.tool');
        expect(schema.description).toBe('Demo tool');
        expect(schema.inputSchema.type).toBe('object');
        expect(schema.outputSchema.type).toBe('object');
        expect(Object.isFrozen(schema)).toBe(true);
    });

    it('rejects an empty name', () => {
        expect(() =>
            defineSchema('', () => ({
                description: 'desc',
                inputSchema: { type: 'object' },
                outputSchema: { type: 'object' },
            })),
        ).toThrow(/non-empty string/);
    });

    it('rejects an empty description', () => {
        expect(() =>
            defineSchema('demo.tool', () => ({
                description: '',
                inputSchema: { type: 'object' },
                outputSchema: { type: 'object' },
            })),
        ).toThrow(/description must be a non-empty string/);
    });

    it('rejects a non-object inputSchema root', () => {
        expect(() =>
            defineSchema('demo.tool', () => ({
                description: 'desc',
                inputSchema: { type: 'array' as unknown as 'object' },
                outputSchema: { type: 'object' },
            })),
        ).toThrow(/inputSchema.type must be "object"/);
    });

    it('rejects a non-object outputSchema root', () => {
        expect(() =>
            defineSchema('demo.tool', () => ({
                description: 'desc',
                inputSchema: { type: 'object' },
                outputSchema: { type: 'array' as unknown as 'object' },
            })),
        ).toThrow(/outputSchema.type must be "object"/);
    });
});
