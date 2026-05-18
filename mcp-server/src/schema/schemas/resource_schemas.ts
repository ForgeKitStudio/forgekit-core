/**
 * Schemas for the `resource.*` tool family (6 tools).
 *
 * Reference: design.md section 5.4.15.
 */

import { defineSchema, type ToolSchema } from '../define_schema.js';
import { dictBag, resourcePath } from './_common.js';

export const resourceSchemas: ReadonlyArray<ToolSchema> = [
    defineSchema('resource.load', () => ({
        description:
            'Loads the Resource at `path` and returns its declared `type` ' +
            'plus a flat `fields` mapping.',
        inputSchema: {
            type: 'object',
            properties: { path: resourcePath },
            required: ['path'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                type: { type: 'string' },
                fields: dictBag,
            },
            required: ['type', 'fields'],
            additionalProperties: true,
        },
    })),

    defineSchema('resource.save', () => ({
        description:
            'Saves a Resource to `path` with `fields` as exported properties. ' +
            'Returns the resolved path and the on-disk byte size.',
        inputSchema: {
            type: 'object',
            properties: {
                path: resourcePath,
                fields: dictBag,
            },
            required: ['path', 'fields'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string' },
                size_bytes: { type: 'integer', minimum: 0 },
            },
            required: ['path', 'size_bytes'],
            additionalProperties: true,
        },
    })),

    defineSchema('resource.inspect', () => ({
        description:
            'Inspects the Resource at `path`, returning declared fields plus ' +
            '`issues[]` from the bound `validate()` method and a suggested fix.',
        inputSchema: {
            type: 'object',
            properties: { path: resourcePath },
            required: ['path'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                type: { type: 'string' },
                fields: dictBag,
                issues: { type: 'array', items: { type: 'string' } },
                suggested_fix: dictBag,
            },
            required: ['type', 'fields'],
            additionalProperties: true,
        },
    })),

    defineSchema('resource.apply_fix', () => ({
        description:
            'Applies the supplied `fix` patch to the Resource at `path`. ' +
            'Returns whether the fix was applied and the canonical path.',
        inputSchema: {
            type: 'object',
            properties: {
                path: resourcePath,
                fix: dictBag,
            },
            required: ['path', 'fix'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                applied: { type: 'boolean' },
                path: { type: 'string' },
            },
            required: ['applied', 'path'],
            additionalProperties: true,
        },
    })),

    defineSchema('resource.duplicate', () => ({
        description:
            'Duplicates the Resource at `from` to `to`. Optional `transform` ' +
            'lets the caller patch fields during the copy.',
        inputSchema: {
            type: 'object',
            properties: {
                from: resourcePath,
                to: resourcePath,
                transform: dictBag,
            },
            required: ['from', 'to'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
            additionalProperties: true,
        },
    })),

    defineSchema('resource.list_by_type', () => ({
        description:
            'Returns every Resource whose `class_name` matches the requested ' +
            'class, optionally constrained to `root` and below.',
        inputSchema: {
            type: 'object',
            properties: {
                class_name: { type: 'string', minLength: 1 },
                root: resourcePath,
            },
            required: ['class_name'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                paths: { type: 'array', items: { type: 'string' } },
            },
            required: ['paths'],
            additionalProperties: true,
        },
    })),
] as const;
