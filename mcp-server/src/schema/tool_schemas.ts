/**
 * Tool schema registry — JSON Schema for every tool exposed by the
 * MCP server.
 *
 * The registry is the single source of truth wired into:
 *
 *   - `tools/list` MCP handler (description + inputSchema per entry).
 *   - `tools/call` MCP handler (Ajv-validated params before dispatch).
 *   - `validate-schemas.ts` CI script (cross-checks every entry in
 *     `profiles.json` against this map).
 *
 * Schemas use JSON Schema Draft 2020-12 (matching the MCP TypeScript
 * SDK's `ToolSchema`). Every input/output schema has `type: "object"`
 * at the root and only uses keywords supported by Ajv 8.
 */

import { defineSchema, type JsonSchema, type ToolSchema } from './define_schema.js';
import { projectSchemas } from './schemas/project_schemas.js';
import { sceneSchemas } from './schemas/scene_schemas.js';
import { nodeSchemas } from './schemas/node_schemas.js';
import { resourceSchemas } from './schemas/resource_schemas.js';
import { editorSchemas } from './schemas/editor_schemas.js';
import { searchAnalysisSchemas } from './schemas/search_analysis_schemas.js';
import { refactorBatchSchemas } from './schemas/refactor_batch_schemas.js';
import { scriptShaderSchemas } from './schemas/script_shader_schemas.js';
import { animationSchemas } from './schemas/animation_schemas.js';
import { themeUiTilemapSchemas } from './schemas/theme_ui_tilemap_schemas.js';
import { physicsParticleNavigationAudioSchemas } from './schemas/physics_particle_navigation_audio_schemas.js';
import { scene3dSchemas } from './schemas/scene3d_schemas.js';
import { assetgenSchemas } from './schemas/assetgen_schemas.js';
import { visualizerHealingSchemas } from './schemas/visualizer_healing_schemas.js';
import { testingSchemas } from './schemas/testing_schemas.js';
import { runtimeSchemas } from './schemas/runtime_schemas.js';
import { inputSchemas } from './schemas/input_schemas.js';
import { profilingSchemas } from './schemas/profiling_schemas.js';
import { exportAndroidSchemas } from './schemas/export_android_schemas.js';
import { moduleManagementSchemas } from './schemas/module_management_schemas.js';
import { combatSchemas } from './schemas/combat_schemas.js';
import { craftingInventorySchemas } from './schemas/crafting_inventory_schemas.js';
import { statsEffectsMagicSchemas } from './schemas/stats_effects_magic_schemas.js';
import { progressionEnemiesLootSpawnerSchemas } from './schemas/progression_enemies_loot_spawner_schemas.js';
import { worldNpcDialogVendorSchemas } from './schemas/world_npc_dialog_vendor_schemas.js';

export { defineSchema };
export type { JsonSchema, ToolSchema };

/**
 * Build the tool schema map from every category fragment. Detects
 * duplicate entries and throws so the registry stays single-source.
 */
function buildToolSchemas(): Map<string, ToolSchema> {
    const fragments: ReadonlyArray<ReadonlyArray<ToolSchema>> = [
        projectSchemas,
        sceneSchemas,
        nodeSchemas,
        resourceSchemas,
        editorSchemas,
        searchAnalysisSchemas,
        refactorBatchSchemas,
        scriptShaderSchemas,
        animationSchemas,
        themeUiTilemapSchemas,
        physicsParticleNavigationAudioSchemas,
        scene3dSchemas,
        assetgenSchemas,
        visualizerHealingSchemas,
        testingSchemas,
        runtimeSchemas,
        inputSchemas,
        profilingSchemas,
        exportAndroidSchemas,
        moduleManagementSchemas,
        combatSchemas,
        craftingInventorySchemas,
        statsEffectsMagicSchemas,
        progressionEnemiesLootSpawnerSchemas,
        worldNpcDialogVendorSchemas,
    ];

    const result = new Map<string, ToolSchema>();
    for (const fragment of fragments) {
        for (const schema of fragment) {
            if (result.has(schema.name)) {
                throw new Error(
                    `tool_schemas: duplicate schema for "${schema.name}"`,
                );
            }
            result.set(schema.name, schema);
        }
    }
    return result;
}

/** Frozen registry; lazily initialized on first access. */
let cachedToolSchemas: Map<string, ToolSchema> | null = null;

/**
 * Returns the global tool schema map. The first call validates every
 * fragment; subsequent calls reuse the cached map.
 */
export function getToolSchemas(): Map<string, ToolSchema> {
    if (cachedToolSchemas === null) {
        cachedToolSchemas = buildToolSchemas();
    }
    return cachedToolSchemas;
}

/** Convenience accessor — throws when the tool is missing. */
export function getToolSchema(name: string): ToolSchema {
    const schema = getToolSchemas().get(name);
    if (schema === undefined) {
        throw new Error(`tool_schemas: no schema registered for "${name}"`);
    }
    return schema;
}

/**
 * The full list of tool names that have a schema. Used by the
 * MCP `tools/list` handler and the validation script.
 */
export function listToolSchemaNames(): string[] {
    return Array.from(getToolSchemas().keys()).sort();
}
