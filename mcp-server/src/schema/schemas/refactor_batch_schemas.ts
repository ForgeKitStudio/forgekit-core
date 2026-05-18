/**
 * Schemas for `refactor.*`, `batch.*`, and `transaction.*` tools.
 *
 * Coverage:
 *   - 5 refactor tools (rename_class, rename_method, move_file,
 *     find_unused_assets, organize_imports)
 *   - 2 batch tools (execute, dry_run)
 *   - 3 transaction tools (begin, commit, rollback)
 *
 * Reference: design.md section 5.4.12.
 */

import { defineSchema, type ToolSchema } from '../define_schema.js';
import { dictBag, noParams, resourcePath } from './_common.js';

const txIdInput = {
    type: 'object' as const,
    properties: {
        transaction_id: { type: 'string', minLength: 1 },
    },
    required: ['transaction_id'],
    additionalProperties: false,
};

export const refactorBatchSchemas: ReadonlyArray<ToolSchema> = [
    defineSchema('refactor.rename_class', () => ({
        description: 'Renames `old_name` class to `new_name` everywhere.',
        inputSchema: {
            type: 'object',
            properties: {
                old_name: { type: 'string', minLength: 1 },
                new_name: { type: 'string', minLength: 1 },
            },
            required: ['old_name', 'new_name'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                files_changed: { type: 'array', items: { type: 'string' } },
            },
            required: ['files_changed'],
            additionalProperties: true,
        },
    })),

    defineSchema('refactor.rename_method', () => ({
        description: 'Renames `old` method on `class_name` to `new`.',
        inputSchema: {
            type: 'object',
            properties: {
                class_name: { type: 'string', minLength: 1 },
                old: { type: 'string', minLength: 1 },
                new: { type: 'string', minLength: 1 },
            },
            required: ['class_name', 'old', 'new'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                files_changed: { type: 'array', items: { type: 'string' } },
            },
            required: ['files_changed'],
            additionalProperties: true,
        },
    })),

    defineSchema('refactor.move_file', () => ({
        description:
            'Moves a file from `from` to `to`. When `update_refs` is true, ' +
            'every reference is rewritten as well.',
        inputSchema: {
            type: 'object',
            properties: {
                from: resourcePath,
                to: resourcePath,
                update_refs: { type: 'boolean' },
            },
            required: ['from', 'to'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                moved: { type: 'boolean' },
                refs_updated: { type: 'integer', minimum: 0 },
            },
            required: ['moved'],
            additionalProperties: true,
        },
    })),

    defineSchema('refactor.find_unused_assets', () => ({
        description:
            'Returns every asset under `root` (default: project root) that no ' +
            'scene or script references.',
        inputSchema: {
            type: 'object',
            properties: { root: resourcePath },
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                unused: { type: 'array', items: { type: 'string' } },
            },
            required: ['unused'],
            additionalProperties: true,
        },
    })),

    defineSchema('refactor.organize_imports', () => ({
        description:
            'Reorders `preload`/`load`/`extends` imports in the file at `path`.',
        inputSchema: {
            type: 'object',
            properties: { path: resourcePath },
            required: ['path'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { modified: { type: 'boolean' } },
            required: ['modified'],
            additionalProperties: true,
        },
    })),

    defineSchema('batch.execute', () => ({
        description:
            'Executes the supplied list of `{tool, params}` operations. When ' +
            '`transactional` is true, all ops succeed atomically or roll back.',
        inputSchema: {
            type: 'object',
            properties: {
                ops: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            tool: { type: 'string', minLength: 1 },
                            params: dictBag,
                        },
                        required: ['tool', 'params'],
                        additionalProperties: false,
                    },
                },
                transactional: { type: 'boolean' },
            },
            required: ['ops'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                results: { type: 'array' },
                committed: { type: 'boolean' },
            },
            required: ['results', 'committed'],
            additionalProperties: true,
        },
    })),

    defineSchema('batch.dry_run', () => ({
        description:
            'Runs the same dispatcher pipeline as `batch.execute` without ' +
            'applying changes. Returns the would-be results.',
        inputSchema: {
            type: 'object',
            properties: {
                ops: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            tool: { type: 'string', minLength: 1 },
                            params: dictBag,
                        },
                        required: ['tool', 'params'],
                        additionalProperties: false,
                    },
                },
            },
            required: ['ops'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { would_apply: { type: 'array' } },
            required: ['would_apply'],
            additionalProperties: true,
        },
    })),

    defineSchema('transaction.begin', () => ({
        description:
            'Opens a new transaction. Subsequent dispatcher calls running on ' +
            'the same channel use the returned `transaction_id` to commit ' +
            'atomically.',
        inputSchema: {
            type: 'object',
            properties: {
                timeout_ms: { type: 'integer', minimum: 1 },
                label: { type: 'string' },
            },
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                transaction_id: { type: 'string' },
                timeout_ms: { type: 'integer', minimum: 1 },
            },
            required: ['transaction_id'],
            additionalProperties: true,
        },
    })),

    defineSchema('transaction.commit', () => ({
        description:
            'Commits the open transaction identified by `transaction_id`. All ' +
            'queued operations are applied atomically.',
        inputSchema: txIdInput,
        outputSchema: {
            type: 'object',
            properties: {
                committed: { type: 'boolean' },
                ops_applied: { type: 'integer', minimum: 0 },
            },
            required: ['committed'],
            additionalProperties: true,
        },
    })),

    defineSchema('transaction.rollback', () => ({
        description:
            'Rolls back the transaction identified by `transaction_id`, ' +
            'discarding every queued operation.',
        inputSchema: txIdInput,
        outputSchema: {
            type: 'object',
            properties: {
                rolled_back: { type: 'boolean' },
            },
            required: ['rolled_back'],
            additionalProperties: true,
        },
    })),
] as const;
