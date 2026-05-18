/**
 * Schemas for the `project.*` tool family (12 tools in profiles.json).
 *
 * Reference implementations:
 *   - mcp-server/src/tools/project/info.ts
 *   - mcp-server/src/tools/project/list_modules.ts
 *   - mcp-server/src/tools/project/list_workspaces.ts
 *   - mcp-server/src/tools/project/check_imports.ts
 *   - mcp-server/src/tools/project/get_settings.ts
 *   - mcp-server/src/tools/project/update_settings.ts
 *   - mcp-server/src/tools/project/list_addons.ts
 *   - mcp-server/src/tools/project/{add,remove,switch,get_active}.ts
 *   - mcp-server/src/tools/project/reload.ts
 *   - mcp-server/src/tools/project/module_scan.ts
 */

import { defineSchema, type ToolSchema } from '../define_schema.js';
import { absolutePath, dictBag, noParams } from './_common.js';

const moduleEntry = {
    type: 'object' as const,
    properties: {
        id: { type: 'string' },
        version: { type: 'string' },
        license_id: { type: 'string' },
        core_min_version: { type: 'string' },
        source_repo: { type: 'string' },
        enabled: { type: 'boolean' },
    },
    required: ['id', 'version'],
    additionalProperties: true,
};

const workspaceEntry = {
    type: 'object' as const,
    properties: {
        workspace_id: { type: 'string' },
        label: { type: 'string' },
        project_root: { type: 'string' },
        created_at: { type: 'string' },
    },
    required: ['workspace_id', 'project_root'],
    additionalProperties: true,
};

export const projectSchemas: ReadonlyArray<ToolSchema> = [
    defineSchema('project.info', () => ({
        description:
            'Returns a stable summary of a Godot project: name, godot_version, ' +
            'api_version, modules_count, root_path.',
        inputSchema: {
            type: 'object',
            properties: {
                projectRoot: absolutePath,
                apiVersion: { type: 'string', minLength: 1 },
            },
            required: ['projectRoot', 'apiVersion'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                godot_version: { type: 'string' },
                api_version: { type: 'string' },
                modules_count: { type: 'integer', minimum: 0 },
                root_path: { type: 'string' },
            },
            required: ['name', 'godot_version', 'api_version', 'modules_count', 'root_path'],
            additionalProperties: false,
        },
    })),

    defineSchema('project.list_modules', () => ({
        description:
            'Returns every `forgekit_*` module under the project with manifest ' +
            'fields (id, version, license_id, core_min_version, source_repo, enabled).',
        inputSchema: {
            type: 'object',
            properties: { projectRoot: absolutePath },
            required: ['projectRoot'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                modules: {
                    type: 'array',
                    items: moduleEntry,
                },
            },
            required: ['modules'],
            additionalProperties: false,
        },
    })),

    defineSchema('project.check_imports', () => ({
        description:
            'Validates that ForgeKit_Core does not import from non-core modules ' +
            'and that `forgekit_rpg/<subsystem>/` reaches other subsystems only ' +
            'via `public_api.gd`. Returns one entry per offending file.',
        inputSchema: {
            type: 'object',
            properties: { projectRoot: absolutePath },
            required: ['projectRoot'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                violations: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            file: { type: 'string' },
                            imports: { type: 'array', items: { type: 'string' } },
                            reason: { type: 'string' },
                        },
                        required: ['file', 'imports', 'reason'],
                        additionalProperties: false,
                    },
                },
            },
            required: ['violations'],
            additionalProperties: false,
        },
    })),

    defineSchema('project.get_settings', () => ({
        description:
            'Reads `project.godot` from disk and returns settings, optionally ' +
            'narrowed by `section` (e.g. "application").',
        inputSchema: {
            type: 'object',
            properties: {
                projectRoot: absolutePath,
                section: { type: 'string' },
            },
            required: ['projectRoot'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { settings: dictBag },
            required: ['settings'],
            additionalProperties: false,
        },
    })),

    defineSchema('project.update_settings', () => ({
        description:
            'Atomically merges `patch` into `project.godot`. The dispatcher uses ' +
            'a tempfile + rename so concurrent writes never see a half-written ' +
            'config. Returns the applied keys plus their previous values.',
        inputSchema: {
            type: 'object',
            properties: {
                projectRoot: absolutePath,
                patch: dictBag,
            },
            required: ['projectRoot', 'patch'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                applied: dictBag,
                previous: dictBag,
            },
            required: ['applied', 'previous'],
            additionalProperties: false,
        },
    })),

    defineSchema('project.reload', () => ({
        description:
            'Asks the editor to reload the active project, picking up disk ' +
            'changes. Returns the wall-clock duration of the reload.',
        inputSchema: {
            type: 'object',
            properties: { projectRoot: absolutePath },
            required: ['projectRoot'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                reloaded: { type: 'boolean' },
                duration_ms: { type: 'integer', minimum: 0 },
            },
            required: ['reloaded', 'duration_ms'],
            additionalProperties: false,
        },
    })),

    defineSchema('project.list_addons', () => ({
        description:
            'Returns every addon under `addons/` along with its enabled state ' +
            'and resolved path.',
        inputSchema: {
            type: 'object',
            properties: { projectRoot: absolutePath },
            required: ['projectRoot'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                addons: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            enabled: { type: 'boolean' },
                            path: { type: 'string' },
                        },
                        required: ['id', 'enabled', 'path'],
                        additionalProperties: true,
                    },
                },
            },
            required: ['addons'],
            additionalProperties: false,
        },
    })),

    defineSchema('project.list_workspaces', () => ({
        description:
            'Lists every registered workspace, the active workspace id (if ' +
            'any), and the hard MAX_WORKSPACES limit.',
        inputSchema: noParams,
        outputSchema: {
            type: 'object',
            properties: {
                workspaces: { type: 'array', items: workspaceEntry },
                active_workspace_id: { type: ['string', 'null'] },
                limit: { type: 'integer', minimum: 1 },
            },
            required: ['workspaces', 'active_workspace_id', 'limit'],
            additionalProperties: false,
        },
    })),

    defineSchema('project.add', () => ({
        description:
            'Registers a new workspace pointing at `project_root` with optional ' +
            '`label`. Auto-activates the workspace when no other is active.',
        inputSchema: {
            type: 'object',
            properties: {
                project_root: absolutePath,
                label: { type: 'string' },
            },
            required: ['project_root'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                workspace_id: { type: 'string' },
                active: { type: 'boolean' },
            },
            required: ['workspace_id'],
            additionalProperties: true,
        },
    })),

    defineSchema('project.remove', () => ({
        description:
            'Removes the workspace identified by `workspace_id`. Returns ' +
            '`{removed: true}` on success.',
        inputSchema: {
            type: 'object',
            properties: { workspace_id: { type: 'string', minLength: 1 } },
            required: ['workspace_id'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                removed: { type: 'boolean' },
                workspace_id: { type: 'string' },
            },
            required: ['removed'],
            additionalProperties: true,
        },
    })),

    defineSchema('project.switch', () => ({
        description:
            'Activates the workspace identified by `workspace_id`. Returns the ' +
            'newly active workspace.',
        inputSchema: {
            type: 'object',
            properties: { workspace_id: { type: 'string', minLength: 1 } },
            required: ['workspace_id'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                active_workspace_id: { type: 'string' },
                previous_workspace_id: { type: ['string', 'null'] },
            },
            required: ['active_workspace_id'],
            additionalProperties: true,
        },
    })),

    defineSchema('project.get_active', () => ({
        description:
            'Returns the currently active workspace, or `{workspace: null}` if ' +
            'none is active.',
        inputSchema: noParams,
        outputSchema: {
            type: 'object',
            properties: {
                workspace: {
                    oneOf: [workspaceEntry, { type: 'null' }],
                },
            },
            required: ['workspace'],
            additionalProperties: false,
        },
    })),
] as const;
