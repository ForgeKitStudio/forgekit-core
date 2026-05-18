/**
 * Schemas for `chests.*` (4), `npc.*` (2), `dialog.*` (4), and
 * `vendor.*` (5) tools.
 *
 * Reference: design.md sections 16.6.4–16.6.6.
 */

import { defineSchema, type ToolSchema } from '../define_schema.js';
import { dictBag } from './_common.js';

const ownerStringName = {
    type: 'string',
    minLength: 1,
    description: 'Owner StringName (entity identifier).',
};

export const worldNpcDialogVendorSchemas: ReadonlyArray<ToolSchema> = [
    defineSchema('chests.open', () => ({
        description:
            'Opens the chest `chest_id`. When `seed` is supplied, the loot ' +
            'roll is fully deterministic.',
        inputSchema: {
            type: 'object',
            properties: {
                chest_id: { type: 'string', minLength: 1 },
                seed: { type: 'integer' },
            },
            required: ['chest_id'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                drops: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            item_id: { type: 'string' },
                            amount: { type: 'integer', minimum: 1 },
                        },
                        required: ['item_id', 'amount'],
                        additionalProperties: true,
                    },
                },
            },
            required: ['drops'],
            additionalProperties: true,
        },
    })),

    defineSchema('chests.close', () => ({
        description: 'Closes the chest `chest_id`.',
        inputSchema: {
            type: 'object',
            properties: { chest_id: { type: 'string', minLength: 1 } },
            required: ['chest_id'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { ok: { type: 'boolean' } },
            required: ['ok'],
            additionalProperties: true,
        },
    })),

    defineSchema('chests.is_opened', () => ({
        description: 'Returns whether the chest `chest_id` is currently open.',
        inputSchema: {
            type: 'object',
            properties: { chest_id: { type: 'string', minLength: 1 } },
            required: ['chest_id'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { opened: { type: 'boolean' } },
            required: ['opened'],
            additionalProperties: true,
        },
    })),

    defineSchema('chests.list_active', () => ({
        description: 'Returns every chest currently active in the scene.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        outputSchema: {
            type: 'object',
            properties: {
                chests: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            chest_id: { type: 'string' },
                            opened: { type: 'boolean' },
                        },
                        required: ['chest_id'],
                        additionalProperties: true,
                    },
                },
            },
            required: ['chests'],
            additionalProperties: true,
        },
    })),

    defineSchema('npc.list_npcs', () => ({
        description: 'Returns every registered NPC.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        outputSchema: {
            type: 'object',
            properties: {
                npcs: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            display_name: { type: 'string' },
                            dialog_id: { type: 'string' },
                        },
                        required: ['id'],
                        additionalProperties: true,
                    },
                },
            },
            required: ['npcs'],
            additionalProperties: true,
        },
    })),

    defineSchema('npc.get_npc', () => ({
        description: 'Returns the NPC fields for `npc_id`.',
        inputSchema: {
            type: 'object',
            properties: { npc_id: { type: 'string', minLength: 1 } },
            required: ['npc_id'],
            additionalProperties: false,
        },
        outputSchema: dictBag,
    })),

    defineSchema('dialog.start', () => ({
        description:
            'Starts the dialog identified by `dialog_id` and returns the ' +
            'first node plus the available choices.',
        inputSchema: {
            type: 'object',
            properties: {
                dialog_id: { type: 'string', minLength: 1 },
            },
            required: ['dialog_id'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                runner_id: { type: 'string' },
                current_node: { type: 'string' },
                choices: { type: 'array' },
            },
            required: ['current_node'],
            additionalProperties: true,
        },
    })),

    defineSchema('dialog.select', () => ({
        description:
            'Advances the dialog runner `runner_id` by selecting ' +
            '`choice_index`.',
        inputSchema: {
            type: 'object',
            properties: {
                runner_id: { type: 'string', minLength: 1 },
                choice_index: { type: 'integer', minimum: 0 },
            },
            required: ['runner_id', 'choice_index'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                next_node: { type: 'string' },
                end: { type: 'boolean' },
                effects: { type: 'array' },
            },
            additionalProperties: true,
        },
    })),

    defineSchema('dialog.list_dialogs', () => ({
        description: 'Lists every registered DialogResource.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        outputSchema: {
            type: 'object',
            properties: {
                dialogs: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            start_node: { type: 'string' },
                        },
                        required: ['id'],
                        additionalProperties: true,
                    },
                },
            },
            required: ['dialogs'],
            additionalProperties: true,
        },
    })),

    defineSchema('dialog.get_dialog', () => ({
        description: 'Returns the DialogResource fields for `dialog_id`.',
        inputSchema: {
            type: 'object',
            properties: { dialog_id: { type: 'string', minLength: 1 } },
            required: ['dialog_id'],
            additionalProperties: false,
        },
        outputSchema: dictBag,
    })),

    defineSchema('vendor.buy', () => ({
        description:
            'Buyer `buyer` purchases `amount` of `item_id` from `vendor_id`. ' +
            'Returns `{ok, status, cost}` with status in {"ok", "insufficient_gold", "out_of_stock", "item_not_accepted"}.',
        inputSchema: {
            type: 'object',
            properties: {
                vendor_id: { type: 'string', minLength: 1 },
                buyer: ownerStringName,
                item_id: { type: 'string', minLength: 1 },
                amount: { type: 'integer', minimum: 1 },
            },
            required: ['vendor_id', 'buyer', 'item_id', 'amount'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                ok: { type: 'boolean' },
                status: {
                    type: 'string',
                    enum: ['ok', 'insufficient_gold', 'out_of_stock', 'item_not_accepted'],
                },
                cost: { type: 'integer', minimum: 0 },
            },
            required: ['ok', 'status'],
            additionalProperties: true,
        },
    })),

    defineSchema('vendor.sell', () => ({
        description:
            'Seller `seller` sells `amount` of `item_id` to `vendor_id`.',
        inputSchema: {
            type: 'object',
            properties: {
                vendor_id: { type: 'string', minLength: 1 },
                seller: ownerStringName,
                item_id: { type: 'string', minLength: 1 },
                amount: { type: 'integer', minimum: 1 },
            },
            required: ['vendor_id', 'seller', 'item_id', 'amount'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                ok: { type: 'boolean' },
                status: {
                    type: 'string',
                    enum: ['ok', 'insufficient_gold', 'out_of_stock', 'item_not_accepted'],
                },
                payout: { type: 'integer', minimum: 0 },
            },
            required: ['ok', 'status'],
            additionalProperties: true,
        },
    })),

    defineSchema('vendor.list_vendors', () => ({
        description: 'Returns every registered Vendor.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        outputSchema: {
            type: 'object',
            properties: {
                vendors: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            display_name: { type: 'string' },
                            currency: { type: 'string' },
                        },
                        required: ['id'],
                        additionalProperties: true,
                    },
                },
            },
            required: ['vendors'],
            additionalProperties: true,
        },
    })),

    defineSchema('vendor.get_vendor', () => ({
        description: 'Returns the VendorResource fields for `vendor_id`.',
        inputSchema: {
            type: 'object',
            properties: { vendor_id: { type: 'string', minLength: 1 } },
            required: ['vendor_id'],
            additionalProperties: false,
        },
        outputSchema: dictBag,
    })),

    defineSchema('vendor.refresh_stock', () => ({
        description:
            'Re-rolls the stock for `vendor_id`. When `seed` is supplied, the ' +
            'restock is deterministic.',
        inputSchema: {
            type: 'object',
            properties: {
                vendor_id: { type: 'string', minLength: 1 },
                seed: { type: 'integer' },
            },
            required: ['vendor_id'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                refreshed: { type: 'boolean' },
                stock: { type: 'array' },
            },
            required: ['refreshed'],
            additionalProperties: true,
        },
    })),
] as const;
