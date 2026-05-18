/**
 * Schemas for `progression.*` (8), `enemies.*` (7), `loot.*` (4),
 * and `spawner.*` (5) tools.
 *
 * Reference: design.md sections 5.4.35 (progression) and 16.6.1–16.6.3.
 */

import { defineSchema, type ToolSchema } from '../define_schema.js';
import { dictBag, vector3 } from './_common.js';

const ownerStringName = {
    type: 'string',
    minLength: 1,
    description: 'Owner StringName (entity identifier).',
};

const enemyResource = {
    type: 'object' as const,
    properties: {
        id: { type: 'string', minLength: 1 },
        display_name: { type: 'string' },
        max_hp: { type: 'number', minimum: 0 },
        damage: { type: 'number' },
        attack_speed: { type: 'number' },
        move_speed: { type: 'number' },
        detection_range: { type: 'number', minimum: 0 },
        ai_profile: { type: 'string' },
        aggro_range: { type: 'number', minimum: 0 },
        leash_distance: { type: 'number', minimum: 0 },
        flee_threshold_hp: { type: 'number', minimum: 0 },
        faction: { type: 'string' },
        resistances: dictBag,
        death_animation_path: { type: 'string' },
        sfx: dictBag,
        loot_table_id: { type: 'string' },
        xp_reward: { type: 'number', minimum: 0 },
        spawn_cost: { type: 'integer', minimum: 0 },
    },
    required: ['id'],
    additionalProperties: true,
};

const lootTableEntry = {
    type: 'object' as const,
    properties: {
        id: { type: 'string', minLength: 1 },
        mode: { type: 'string' },
        entry_count: { type: 'integer', minimum: 0 },
    },
    required: ['id'],
    additionalProperties: true,
};

const lootRollOutput = {
    type: 'object' as const,
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
};

export const progressionEnemiesLootSpawnerSchemas: ReadonlyArray<ToolSchema> = [
    defineSchema('progression.grant_xp', () => ({
        description:
            'Grants `amount` XP to `owner`. Returns the new state plus the ' +
            'list of level-ups triggered (each with `reward_applied`).',
        inputSchema: {
            type: 'object',
            properties: {
                owner: ownerStringName,
                amount: { type: 'number', minimum: 0 },
                source: { type: 'string' },
            },
            required: ['owner', 'amount'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                total_xp: { type: 'number', minimum: 0 },
                level: { type: 'integer', minimum: 1 },
                level_ups: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            level: { type: 'integer', minimum: 1 },
                            reward_applied: { type: 'string' },
                        },
                        required: ['level'],
                        additionalProperties: true,
                    },
                },
            },
            required: ['total_xp', 'level'],
            additionalProperties: true,
        },
    })),

    defineSchema('progression.get_state', () => ({
        description:
            'Returns the current progression state of `owner` (level, total ' +
            'xp, pending stat points).',
        inputSchema: {
            type: 'object',
            properties: { owner: ownerStringName },
            required: ['owner'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                level: { type: 'integer', minimum: 1 },
                total_xp: { type: 'number', minimum: 0 },
                pending_stat_points: { type: 'integer', minimum: 0 },
            },
            required: ['level', 'total_xp', 'pending_stat_points'],
            additionalProperties: true,
        },
    })),

    defineSchema('progression.allocate_stat_point', () => ({
        description:
            'Spends `amount` of `owner`\'s pending stat points on `stat_name`.',
        inputSchema: {
            type: 'object',
            properties: {
                owner: ownerStringName,
                stat_name: { type: 'string', minLength: 1 },
                amount: { type: 'integer', minimum: 1 },
            },
            required: ['owner', 'stat_name', 'amount'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                allocated: { type: 'integer', minimum: 0 },
                remaining: { type: 'integer', minimum: 0 },
            },
            required: ['allocated', 'remaining'],
            additionalProperties: true,
        },
    })),

    defineSchema('progression.reset', () => ({
        description: 'Resets `owner`\'s progression state to level 1, XP 0.',
        inputSchema: {
            type: 'object',
            properties: { owner: ownerStringName },
            required: ['owner'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { reset: { type: 'boolean' } },
            required: ['reset'],
            additionalProperties: true,
        },
    })),

    defineSchema('progression.list_curves', () => ({
        description: 'Returns every registered XpCurveResource.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        outputSchema: {
            type: 'object',
            properties: {
                curves: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            mode: { type: 'string', enum: ['formula', 'table'] },
                        },
                        required: ['id'],
                        additionalProperties: true,
                    },
                },
            },
            required: ['curves'],
            additionalProperties: true,
        },
    })),

    defineSchema('progression.get_curve', () => ({
        description: 'Returns the XpCurveResource fields for `curve_id`.',
        inputSchema: {
            type: 'object',
            properties: { curve_id: { type: 'string', minLength: 1 } },
            required: ['curve_id'],
            additionalProperties: false,
        },
        outputSchema: dictBag,
    })),

    defineSchema('progression.list_rewards', () => ({
        description: 'Returns every registered LevelUpRewardResource.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        outputSchema: {
            type: 'object',
            properties: {
                rewards: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            unlock_tier: { type: 'string' },
                        },
                        required: ['id'],
                        additionalProperties: true,
                    },
                },
            },
            required: ['rewards'],
            additionalProperties: true,
        },
    })),

    defineSchema('progression.get_reward', () => ({
        description: 'Returns the LevelUpRewardResource fields for `reward_id`.',
        inputSchema: {
            type: 'object',
            properties: { reward_id: { type: 'string', minLength: 1 } },
            required: ['reward_id'],
            additionalProperties: false,
        },
        outputSchema: dictBag,
    })),

    defineSchema('enemies.spawn', () => ({
        description:
            'Spawns an enemy of type `enemy_id` at `position`. Returns the ' +
            'spawned instance id and the runtime node path.',
        inputSchema: {
            type: 'object',
            properties: {
                enemy_id: { type: 'string', minLength: 1 },
                position: vector3,
                spawner_id: { type: 'string' },
            },
            required: ['enemy_id', 'position'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                instance_id: { type: 'string' },
                runtime_node: { type: 'string' },
            },
            required: ['instance_id'],
            additionalProperties: true,
        },
    })),

    defineSchema('enemies.list_active', () => ({
        description: 'Returns every currently active enemy instance.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        outputSchema: {
            type: 'object',
            properties: {
                enemies: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            instance_id: { type: 'string' },
                            enemy_id: { type: 'string' },
                            hp: { type: 'number' },
                            position: vector3,
                        },
                        required: ['instance_id', 'enemy_id'],
                        additionalProperties: true,
                    },
                },
            },
            required: ['enemies'],
            additionalProperties: true,
        },
    })),

    defineSchema('enemies.get_state', () => ({
        description: 'Returns the runtime state of the enemy instance `instance_id`.',
        inputSchema: {
            type: 'object',
            properties: { instance_id: { type: 'string', minLength: 1 } },
            required: ['instance_id'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                hp: { type: 'number' },
                state: { type: 'string' },
                position: vector3,
            },
            required: ['hp'],
            additionalProperties: true,
        },
    })),

    defineSchema('enemies.kill', () => ({
        description:
            'Despawns the enemy instance `instance_id`, optionally crediting ' +
            'a killer (XP grant subscribers will see the death event).',
        inputSchema: {
            type: 'object',
            properties: {
                instance_id: { type: 'string', minLength: 1 },
                killer: { type: 'string' },
            },
            required: ['instance_id'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { killed: { type: 'boolean' } },
            required: ['killed'],
            additionalProperties: true,
        },
    })),

    defineSchema('enemies.list_resources', () => ({
        description: 'Returns every registered EnemyResource.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        outputSchema: {
            type: 'object',
            properties: { enemies: { type: 'array', items: enemyResource } },
            required: ['enemies'],
            additionalProperties: true,
        },
    })),

    defineSchema('enemies.get_resource', () => ({
        description: 'Returns the EnemyResource fields for `enemy_id`.',
        inputSchema: {
            type: 'object',
            properties: { enemy_id: { type: 'string', minLength: 1 } },
            required: ['enemy_id'],
            additionalProperties: false,
        },
        outputSchema: enemyResource,
    })),

    defineSchema('enemies.create_resource', () => ({
        description:
            'Creates a new EnemyResource at ' +
            '`addons/forgekit_rpg/enemies/resources/<id>.tres`.',
        inputSchema: {
            type: 'object',
            properties: enemyResource.properties,
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

    defineSchema('loot.list_tables', () => ({
        description: 'Returns every registered LootTableResource.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        outputSchema: {
            type: 'object',
            properties: { tables: { type: 'array', items: lootTableEntry } },
            required: ['tables'],
            additionalProperties: true,
        },
    })),

    defineSchema('loot.get_table', () => ({
        description: 'Returns the LootTableResource fields for `table_id`.',
        inputSchema: {
            type: 'object',
            properties: { table_id: { type: 'string', minLength: 1 } },
            required: ['table_id'],
            additionalProperties: false,
        },
        outputSchema: dictBag,
    })),

    defineSchema('loot.roll', () => ({
        description:
            'Rolls the loot table `table_id` with `seed`. The same ' +
            '`(table_id, seed)` always produces an identical roll.',
        inputSchema: {
            type: 'object',
            properties: {
                table_id: { type: 'string', minLength: 1 },
                seed: { type: 'integer' },
            },
            required: ['table_id', 'seed'],
            additionalProperties: false,
        },
        outputSchema: lootRollOutput,
    })),

    defineSchema('loot.simulate', () => ({
        description:
            'Runs `iterations` loot rolls without committing drops. Returns ' +
            'aggregate drop counts per item id.',
        inputSchema: {
            type: 'object',
            properties: {
                table_id: { type: 'string', minLength: 1 },
                iterations: { type: 'integer', minimum: 1 },
                seed: { type: 'integer' },
            },
            required: ['table_id', 'iterations'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                counts: {
                    type: 'object',
                    additionalProperties: { type: 'integer', minimum: 0 },
                },
            },
            required: ['counts'],
            additionalProperties: true,
        },
    })),

    defineSchema('spawner.start_wave', () => ({
        description: 'Starts wave `wave_id` on the spawner `spawner_id`.',
        inputSchema: {
            type: 'object',
            properties: {
                spawner_id: { type: 'string', minLength: 1 },
                wave_id: { type: 'string', minLength: 1 },
            },
            required: ['spawner_id', 'wave_id'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                ok: { type: 'boolean' },
                spawned_count: { type: 'integer', minimum: 0 },
            },
            required: ['ok'],
            additionalProperties: true,
        },
    })),

    defineSchema('spawner.stop', () => ({
        description: 'Stops the spawner `spawner_id` and removes pending spawns.',
        inputSchema: {
            type: 'object',
            properties: { spawner_id: { type: 'string', minLength: 1 } },
            required: ['spawner_id'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { ok: { type: 'boolean' } },
            required: ['ok'],
            additionalProperties: true,
        },
    })),

    defineSchema('spawner.get_state', () => ({
        description:
            'Returns the live state of `spawner_id`: active flag, current ' +
            'wave id, remaining spawn budget.',
        inputSchema: {
            type: 'object',
            properties: { spawner_id: { type: 'string', minLength: 1 } },
            required: ['spawner_id'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                active: { type: 'boolean' },
                current_wave: { type: 'string' },
                remaining_budget: { type: 'integer', minimum: 0 },
            },
            required: ['active'],
            additionalProperties: true,
        },
    })),

    defineSchema('spawner.list_waves', () => ({
        description: 'Returns every wave configured on `spawner_id`.',
        inputSchema: {
            type: 'object',
            properties: { spawner_id: { type: 'string', minLength: 1 } },
            required: ['spawner_id'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                waves: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            budget: { type: 'integer', minimum: 0 },
                        },
                        required: ['id'],
                        additionalProperties: true,
                    },
                },
            },
            required: ['waves'],
            additionalProperties: true,
        },
    })),

    defineSchema('spawner.get_wave', () => ({
        description: 'Returns the configuration for `wave_id` on `spawner_id`.',
        inputSchema: {
            type: 'object',
            properties: {
                spawner_id: { type: 'string', minLength: 1 },
                wave_id: { type: 'string', minLength: 1 },
            },
            required: ['spawner_id', 'wave_id'],
            additionalProperties: false,
        },
        outputSchema: dictBag,
    })),
] as const;
