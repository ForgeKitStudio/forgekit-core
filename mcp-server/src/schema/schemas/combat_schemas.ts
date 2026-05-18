/**
 * Schemas for `combat.*` tools.
 *
 * `profiles.json` currently exposes a single combat tool
 * (`combat.list_hitboxes`); the rest of the combat surface — create
 * hitbox/hurtbox, apply damage, state-machine helpers — lives in the
 * GDScript subsystem and is reachable through `combat.*` adapters
 * registered with the editor channel JSON-RPC dispatcher. When those
 * adapters are wired into `profiles.json`, additional schemas can be
 * added here without touching the rest of the registry.
 *
 * Reference: design.md section 5.4.27.
 */

import { defineSchema, type ToolSchema } from '../define_schema.js';
import { dimension, nodePath } from './_common.js';

export const combatSchemas: ReadonlyArray<ToolSchema> = [
    defineSchema('combat.list_hitboxes', () => ({
        description:
            'Returns every active `Hitbox2D` and `Hitbox3D` in the live ' +
            'scene tree. Each entry carries `node_path`, `team`, `damage`, ' +
            '`damage_type`, and `dimension` ("2d" | "3d").',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        outputSchema: {
            type: 'object',
            properties: {
                hitboxes: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            node_path: nodePath,
                            team: { type: 'string' },
                            damage: { type: 'number' },
                            damage_type: { type: 'string' },
                            dimension: dimension,
                        },
                        required: ['node_path', 'team', 'damage', 'damage_type', 'dimension'],
                        additionalProperties: true,
                    },
                },
            },
            required: ['hitboxes'],
            additionalProperties: true,
        },
    })),
] as const;
