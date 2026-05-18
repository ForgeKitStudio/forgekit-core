/**
 * Schemas for `stats.*` (1), `effects.*` (7), `magic.*` (8), and
 * `equipment.*` (6) tools.
 *
 * `stats.*` only exposes `stats.get_stat` in the current
 * `profiles.json`; the broader stats surface (set_base, list,
 * add_modifier, ...) lives behind GDScript-side adapters.
 *
 * Reference: design.md sections 5.4.30, 14.3 (Effects/Magic/Equipment).
 */

import { defineSchema, type ToolSchema } from '../define_schema.js';
import { dictBag } from './_common.js';

const ownerStringName = {
    type: 'string',
    minLength: 1,
    description: 'Owner StringName (entity identifier).',
};

const effectFields = {
    type: 'object' as const,
    properties: {
        id: { type: 'string', minLength: 1 },
        display_name: { type: 'string' },
        duration_seconds: { type: 'number', minimum: 0 },
        tick_interval_seconds: { type: 'number', minimum: 0 },
        tick_modifiers: { type: 'array' },
        on_apply_modifiers: { type: 'array' },
        on_tick_resource_deltas: { type: 'array' },
        stacking_policy: {
            type: 'string',
            enum: ['refresh', 'stack', 'replace', 'ignore'],
        },
    },
    required: ['id'],
    additionalProperties: true,
};

const spellFields = {
    type: 'object' as const,
    properties: {
        id: { type: 'string', minLength: 1 },
        school: { type: 'string' },
        mana_cost: { type: 'number', minimum: 0 },
        cooldown_seconds: { type: 'number', minimum: 0 },
        cast_time_seconds: { type: 'number', minimum: 0 },
        delivery: { type: 'string' },
        range_meters: { type: 'number', minimum: 0 },
        damage: { type: 'number' },
        damage_type: { type: 'string' },
        status_effects: { type: 'array' },
        target_filter: { type: 'string' },
    },
    required: ['id'],
    additionalProperties: true,
};

const castResult = {
    type: 'object' as const,
    properties: {
        status: {
            type: 'string',
            enum: [
                'ok',
                'insufficient_mana',
                'on_cooldown',
                'invalid_target',
                'unknown_spell',
            ],
        },
        spell_id: { type: 'string' },
        target: { type: 'string' },
        cooldown_seconds: { type: 'number' },
    },
    required: ['status'],
    additionalProperties: true,
};

const equipResult = {
    type: 'object' as const,
    properties: {
        status: {
            type: 'string',
            enum: ['ok', 'unknown_slot', 'requirements_not_met', 'slot_occupied'],
        },
        slot: { type: 'string' },
        item_id: { type: 'string' },
    },
    required: ['status'],
    additionalProperties: true,
};

export const statsEffectsMagicSchemas: ReadonlyArray<ToolSchema> = [
    defineSchema('stats.get_stat', () => ({
        description: 'Returns the base + modified value of `stat_name` for `owner`.',
        inputSchema: {
            type: 'object',
            properties: {
                owner: ownerStringName,
                stat_name: { type: 'string', minLength: 1 },
            },
            required: ['owner', 'stat_name'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                base: { type: 'number' },
                modified: { type: 'number' },
            },
            required: ['base', 'modified'],
            additionalProperties: true,
        },
    })),

    defineSchema('effects.apply', () => ({
        description:
            'Applies `effect_id` (or inline `fields`) to `owner`. Returns the ' +
            'instance id used by `effects.remove`.',
        inputSchema: {
            type: 'object',
            properties: {
                owner: ownerStringName,
                effect_id: { type: 'string' },
                fields: dictBag,
            },
            required: ['owner'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                effect_id: { type: 'string' },
                error: { type: 'string' },
            },
            additionalProperties: true,
        },
    })),

    defineSchema('effects.remove', () => ({
        description: 'Removes the active effect identified by `effect_id` from `owner`.',
        inputSchema: {
            type: 'object',
            properties: {
                owner: ownerStringName,
                effect_id: { type: 'string', minLength: 1 },
            },
            required: ['owner', 'effect_id'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { removed: { type: 'boolean' } },
            required: ['removed'],
            additionalProperties: true,
        },
    })),

    defineSchema('effects.list_active', () => ({
        description: 'Returns every active effect on `owner`.',
        inputSchema: {
            type: 'object',
            properties: { owner: ownerStringName },
            required: ['owner'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                effects: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            effect_id: { type: 'string' },
                            id: { type: 'string' },
                            remaining_duration: { type: 'number' },
                            ticks_applied: { type: 'integer', minimum: 0 },
                            next_tick_in_seconds: { type: 'number' },
                        },
                        required: ['effect_id'],
                        additionalProperties: true,
                    },
                },
            },
            required: ['effects'],
            additionalProperties: true,
        },
    })),

    defineSchema('effects.tick_advance', () => ({
        description:
            'Advances every active effect by `delta_seconds`. Returns the ' +
            'count of ticks that fired and the list of expired effect ids.',
        inputSchema: {
            type: 'object',
            properties: { delta_seconds: { type: 'number', minimum: 0 } },
            required: ['delta_seconds'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                ticked: { type: 'integer', minimum: 0 },
                expired: { type: 'array', items: { type: 'string' } },
            },
            required: ['ticked', 'expired'],
            additionalProperties: true,
        },
    })),

    defineSchema('effects.list_resources', () => ({
        description: 'Returns every registered StatusEffectResource.',
        inputSchema: {
            type: 'object',
            properties: { filter: { type: 'string' } },
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { effects: { type: 'array', items: effectFields } },
            required: ['effects'],
            additionalProperties: true,
        },
    })),

    defineSchema('effects.create_resource', () => ({
        description:
            'Creates a new StatusEffectResource at ' +
            '`addons/forgekit_rpg/effects/resources/<id>.tres`.',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', minLength: 1 },
                display_name: { type: 'string' },
                duration_seconds: { type: 'number', minimum: 0 },
                tick_interval_seconds: { type: 'number', minimum: 0 },
                tick_modifiers: { type: 'array' },
                on_apply_modifiers: { type: 'array' },
                on_tick_resource_deltas: { type: 'array' },
                stacking_policy: {
                    type: 'string',
                    enum: ['refresh', 'stack', 'replace', 'ignore'],
                },
            },
            required: ['id'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { saved_path: { type: 'string' } },
            required: ['saved_path'],
            additionalProperties: true,
        },
    })),

    defineSchema('effects.validate_resource', () => ({
        description:
            'Validates a StatusEffectResource (either by `id` or inline ' +
            '`fields`).',
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

    defineSchema('magic.cast', () => ({
        description: 'Asks `caster` to cast `spell_id` against `target`.',
        inputSchema: {
            type: 'object',
            properties: {
                caster: ownerStringName,
                spell_id: { type: 'string', minLength: 1 },
                target: { type: 'string' },
            },
            required: ['caster', 'spell_id'],
            additionalProperties: false,
        },
        outputSchema: castResult,
    })),

    defineSchema('magic.list_spells', () => ({
        description: 'Lists every registered SpellResource.',
        inputSchema: {
            type: 'object',
            properties: { filter: { type: 'string' } },
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { spells: { type: 'array', items: spellFields } },
            required: ['spells'],
            additionalProperties: true,
        },
    })),

    defineSchema('magic.get_spell', () => ({
        description: 'Returns the SpellResource fields for `spell_id`.',
        inputSchema: {
            type: 'object',
            properties: { spell_id: { type: 'string', minLength: 1 } },
            required: ['spell_id'],
            additionalProperties: false,
        },
        outputSchema: spellFields,
    })),

    defineSchema('magic.create_spell', () => ({
        description: 'Creates a new SpellResource on disk under `magic/spells/<id>.tres`.',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', minLength: 1 },
                school: { type: 'string' },
                mana_cost: { type: 'number', minimum: 0 },
                cooldown_seconds: { type: 'number', minimum: 0 },
                cast_time_seconds: { type: 'number', minimum: 0 },
                delivery: { type: 'string' },
                range_meters: { type: 'number', minimum: 0 },
                damage: { type: 'number' },
                damage_type: { type: 'string' },
                status_effects: { type: 'array' },
                target_filter: { type: 'string' },
            },
            required: ['id'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { saved_path: { type: 'string' } },
            required: ['saved_path'],
            additionalProperties: true,
        },
    })),

    defineSchema('magic.update_spell', () => ({
        description: 'Patches the existing SpellResource `spell_id` with `patch`.',
        inputSchema: {
            type: 'object',
            properties: {
                spell_id: { type: 'string', minLength: 1 },
                patch: dictBag,
            },
            required: ['spell_id', 'patch'],
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

    defineSchema('magic.delete_spell', () => ({
        description: 'Deletes the SpellResource `spell_id` from disk.',
        inputSchema: {
            type: 'object',
            properties: { spell_id: { type: 'string', minLength: 1 } },
            required: ['spell_id'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { deleted: { type: 'boolean' } },
            required: ['deleted'],
            additionalProperties: true,
        },
    })),

    defineSchema('magic.get_cooldowns', () => ({
        description:
            'Returns the active cooldowns for `caster` as ' +
            '`{spell_id: seconds_remaining}`.',
        inputSchema: {
            type: 'object',
            properties: { caster: ownerStringName },
            required: ['caster'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                cooldowns: {
                    type: 'object',
                    additionalProperties: { type: 'number', minimum: 0 },
                },
            },
            required: ['cooldowns'],
            additionalProperties: true,
        },
    })),

    defineSchema('magic.reset_cooldowns', () => ({
        description: 'Resets every cooldown for `caster`.',
        inputSchema: {
            type: 'object',
            properties: { caster: ownerStringName },
            required: ['caster'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { reset: { type: 'integer', minimum: 0 } },
            required: ['reset'],
            additionalProperties: true,
        },
    })),

    defineSchema('equipment.equip', () => ({
        description: 'Equips `item_id` on `owner`. Returns an `EquipResult`.',
        inputSchema: {
            type: 'object',
            properties: {
                owner: ownerStringName,
                item_id: { type: 'string', minLength: 1 },
            },
            required: ['owner', 'item_id'],
            additionalProperties: false,
        },
        outputSchema: equipResult,
    })),

    defineSchema('equipment.unequip', () => ({
        description: 'Unequips whatever sits in `slot` for `owner`.',
        inputSchema: {
            type: 'object',
            properties: {
                owner: ownerStringName,
                slot: { type: 'string', minLength: 1 },
            },
            required: ['owner', 'slot'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                item_id: { type: 'string' },
                slot: { type: 'string' },
                error: { type: 'string' },
            },
            additionalProperties: true,
        },
    })),

    defineSchema('equipment.get_slot', () => ({
        description: 'Returns the item currently equipped in `slot` for `owner`.',
        inputSchema: {
            type: 'object',
            properties: {
                owner: ownerStringName,
                slot: { type: 'string', minLength: 1 },
            },
            required: ['owner', 'slot'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                item_id: { type: 'string' },
                slot_empty: { type: 'boolean' },
            },
            additionalProperties: true,
        },
    })),

    defineSchema('equipment.snapshot', () => ({
        description: 'Returns the full equipment loadout as `{slot: item_id}`.',
        inputSchema: {
            type: 'object',
            properties: { owner: ownerStringName },
            required: ['owner'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                slots: {
                    type: 'object',
                    additionalProperties: { type: 'string' },
                },
            },
            required: ['slots'],
            additionalProperties: true,
        },
    })),

    defineSchema('equipment.list_slots', () => ({
        description: 'Returns the configured equipment slot names.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        outputSchema: {
            type: 'object',
            properties: { slots: { type: 'array', items: { type: 'string' } } },
            required: ['slots'],
            additionalProperties: true,
        },
    })),

    defineSchema('equipment.configure_slots', () => ({
        description: 'Replaces the equipment slot list with `slots`.',
        inputSchema: {
            type: 'object',
            properties: {
                slots: {
                    type: 'array',
                    items: { type: 'string', minLength: 1 },
                    minItems: 1,
                },
            },
            required: ['slots'],
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
