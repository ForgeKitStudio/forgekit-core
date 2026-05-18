/**
 * Schemas for `crafting.*` (8) and `inventory.*` (7) tools.
 *
 * Reference: design.md sections 5.4.28 and 5.4.29.
 */

import { defineSchema, type ToolSchema } from '../define_schema.js';
import { dictBag } from './_common.js';

const ownerStringName = {
    type: 'string',
    minLength: 1,
    description: 'Owner StringName (entity identifier).',
};

const itemId = {
    type: 'string',
    minLength: 1,
    description: 'Item identifier matching a registered `ItemResource.id`.',
};

const recipeFields = {
    type: 'object' as const,
    properties: {
        id: { type: 'string', minLength: 1 },
        inputs: { type: 'array' },
        outputs: { type: 'array' },
        duration_seconds: { type: 'number', minimum: 0 },
    },
    required: ['id', 'inputs', 'outputs', 'duration_seconds'],
    additionalProperties: true,
};

const craftingResult = {
    type: 'object' as const,
    properties: {
        status: {
            type: 'string',
            enum: ['ok', 'insufficient_inputs', 'unknown_recipe', 'unknown_error'],
        },
        missing_items: { type: 'array' },
        outputs: { type: 'array' },
        error_message: { type: 'string' },
    },
    required: ['status'],
    additionalProperties: true,
};

export const craftingInventorySchemas: ReadonlyArray<ToolSchema> = [
    defineSchema('crafting.execute', () => ({
        description:
            'Executes the recipe `recipe_id` for the active crafter. Returns ' +
            'a `CraftingResult` discriminated by `status`.',
        inputSchema: {
            type: 'object',
            properties: { recipe_id: { type: 'string', minLength: 1 } },
            required: ['recipe_id'],
            additionalProperties: false,
        },
        outputSchema: craftingResult,
    })),

    defineSchema('crafting.list_recipes', () => ({
        description:
            'Returns every registered recipe. Optional `filter` matches by id ' +
            'prefix or output item.',
        inputSchema: {
            type: 'object',
            properties: { filter: { type: 'string' } },
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { recipes: { type: 'array', items: recipeFields } },
            required: ['recipes'],
            additionalProperties: true,
        },
    })),

    defineSchema('crafting.get_recipe', () => ({
        description: 'Returns the recipe `recipe_id` as parsed `.tres` fields.',
        inputSchema: {
            type: 'object',
            properties: { recipe_id: { type: 'string', minLength: 1 } },
            required: ['recipe_id'],
            additionalProperties: false,
        },
        outputSchema: recipeFields,
    })),

    defineSchema('crafting.create_recipe', () => ({
        description:
            'Creates a new RecipeResource at ' +
            '`addons/forgekit_rpg/crafting/recipes/<id>.tres`.',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', minLength: 1 },
                inputs: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            item_id: itemId,
                            amount: { type: 'integer', minimum: 1 },
                        },
                        required: ['item_id', 'amount'],
                        additionalProperties: false,
                    },
                },
                outputs: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            item_id: itemId,
                            amount: { type: 'integer', minimum: 1 },
                        },
                        required: ['item_id', 'amount'],
                        additionalProperties: false,
                    },
                },
                duration_seconds: { type: 'number', minimum: 0 },
            },
            required: ['id', 'inputs', 'outputs', 'duration_seconds'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { saved_path: { type: 'string' } },
            required: ['saved_path'],
            additionalProperties: true,
        },
    })),

    defineSchema('crafting.update_recipe', () => ({
        description:
            'Patches the existing recipe `id` with the supplied `patch`. ' +
            'Returns applied/previous diffs for undo bookkeeping.',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', minLength: 1 },
                patch: dictBag,
            },
            required: ['id', 'patch'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                applied: dictBag,
                previous: dictBag,
            },
            required: ['applied', 'previous'],
            additionalProperties: true,
        },
    })),

    defineSchema('crafting.delete_recipe', () => ({
        description: 'Deletes the recipe `id` from disk.',
        inputSchema: {
            type: 'object',
            properties: { id: { type: 'string', minLength: 1 } },
            required: ['id'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { deleted: { type: 'boolean' } },
            required: ['deleted'],
            additionalProperties: true,
        },
    })),

    defineSchema('crafting.validate_recipe', () => ({
        description:
            'Validates a recipe (either by stored `id` or inline `fields`) ' +
            'and returns `{ok, errors}`.',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string' },
                fields: dictBag,
            },
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                ok: { type: 'boolean' },
                errors: { type: 'array', items: { type: 'string' } },
            },
            required: ['ok'],
            additionalProperties: true,
        },
    })),

    defineSchema('crafting.simulate_cost', () => ({
        description:
            'Runs `iterations` simulated executions of `recipe_id` and ' +
            'returns the average input/output counts.',
        inputSchema: {
            type: 'object',
            properties: {
                recipe_id: { type: 'string', minLength: 1 },
                iterations: { type: 'integer', minimum: 1 },
            },
            required: ['recipe_id'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                avg_inputs: dictBag,
                avg_outputs: dictBag,
            },
            required: ['avg_inputs', 'avg_outputs'],
            additionalProperties: true,
        },
    })),

    defineSchema('inventory.add_item', () => ({
        description: 'Adds `amount` of `item_id` to the active inventory.',
        inputSchema: {
            type: 'object',
            properties: {
                item_id: itemId,
                amount: { type: 'integer', minimum: 1 },
                owner: ownerStringName,
            },
            required: ['item_id', 'amount'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { new_count: { type: 'integer', minimum: 0 } },
            required: ['new_count'],
            additionalProperties: true,
        },
    })),

    defineSchema('inventory.remove_item', () => ({
        description:
            'Removes up to `amount` of `item_id`. Returns the actually ' +
            'removed amount and the resulting count.',
        inputSchema: {
            type: 'object',
            properties: {
                item_id: itemId,
                amount: { type: 'integer', minimum: 1 },
                owner: ownerStringName,
            },
            required: ['item_id', 'amount'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                new_count: { type: 'integer', minimum: 0 },
                removed: { type: 'integer', minimum: 0 },
            },
            required: ['new_count', 'removed'],
            additionalProperties: true,
        },
    })),

    defineSchema('inventory.get_count', () => ({
        description: 'Returns the current count of `item_id`.',
        inputSchema: {
            type: 'object',
            properties: {
                item_id: itemId,
                owner: ownerStringName,
            },
            required: ['item_id'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { count: { type: 'integer', minimum: 0 } },
            required: ['count'],
            additionalProperties: true,
        },
    })),

    defineSchema('inventory.snapshot', () => ({
        description: 'Returns the full inventory as an ordered list of `{id, count}`.',
        inputSchema: {
            type: 'object',
            properties: { owner: ownerStringName },
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                items: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            id: itemId,
                            count: { type: 'integer', minimum: 0 },
                        },
                        required: ['id', 'count'],
                        additionalProperties: true,
                    },
                },
            },
            required: ['items'],
            additionalProperties: true,
        },
    })),

    defineSchema('inventory.clear', () => ({
        description: 'Clears every item from the active inventory.',
        inputSchema: {
            type: 'object',
            properties: { owner: ownerStringName },
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { cleared: { type: 'boolean' } },
            required: ['cleared'],
            additionalProperties: true,
        },
    })),

    defineSchema('inventory.transfer', () => ({
        description: 'Transfers `amount` of `item_id` from `from_owner` to `to_owner`.',
        inputSchema: {
            type: 'object',
            properties: {
                from_owner: ownerStringName,
                to_owner: ownerStringName,
                item_id: itemId,
                amount: { type: 'integer', minimum: 1 },
            },
            required: ['from_owner', 'to_owner', 'item_id', 'amount'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { transferred: { type: 'integer', minimum: 0 } },
            required: ['transferred'],
            additionalProperties: true,
        },
    })),

    defineSchema('inventory.set_capacity', () => ({
        description: 'Sets the max capacity (item count) for `owner`.',
        inputSchema: {
            type: 'object',
            properties: {
                owner: ownerStringName,
                capacity: { type: 'integer', minimum: 1 },
            },
            required: ['owner', 'capacity'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { applied: { type: 'boolean' } },
            required: ['applied'],
            additionalProperties: true,
        },
    })),
] as const;
