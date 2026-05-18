/**
 * Schemas for `physics.*`, `particle.*`, `navigation.*`, and `audio.*`
 * tools (24 total — 6 + 5 + 6 + 6, plus `physics.set_gravity` which
 * lives under physics-runtime in profiles.json instead of
 * physics-editor).
 *
 * Reference: design.md sections 5.4.16–5.4.20.
 */

import { defineSchema, type ToolSchema } from '../define_schema.js';
import {
    appliedOutput,
    appliedPreviousOutput,
    dictBag,
    nodePath,
    resourcePath,
    vector3,
} from './_common.js';

export const physicsParticleNavigationAudioSchemas: ReadonlyArray<ToolSchema> = [
    defineSchema('physics.raycast', () => ({
        description:
            'Casts a ray from `from` to `to` and returns the first hit, if any.',
        inputSchema: {
            type: 'object',
            properties: {
                from: vector3,
                to: vector3,
                collision_mask: { type: 'integer' },
                exclude: { type: 'array', items: nodePath },
            },
            required: ['from', 'to'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                hit: { type: 'boolean' },
                position: vector3,
                normal: vector3,
                collider_path: { type: ['string', 'null'] },
            },
            required: ['hit'],
            additionalProperties: true,
        },
    })),

    defineSchema('physics.shape_cast', () => ({
        description:
            'Sweeps `shape` along `motion` starting at `from` and returns ' +
            'every hit along the way.',
        inputSchema: {
            type: 'object',
            properties: {
                shape: dictBag,
                from: vector3,
                motion: vector3,
                collision_mask: { type: 'integer' },
            },
            required: ['shape', 'from', 'motion'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { hits: { type: 'array' } },
            required: ['hits'],
            additionalProperties: true,
        },
    })),

    defineSchema('physics.query_point', () => ({
        description: 'Returns every body overlapping the world point `position`.',
        inputSchema: {
            type: 'object',
            properties: {
                position: vector3,
                collision_mask: { type: 'integer' },
            },
            required: ['position'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { overlapping: { type: 'array', items: nodePath } },
            required: ['overlapping'],
            additionalProperties: true,
        },
    })),

    defineSchema('physics.set_gravity', () => ({
        description:
            'Sets the global gravity vector. Returns the new value and the ' +
            'previous one for undo.',
        inputSchema: {
            type: 'object',
            properties: { vector: vector3 },
            required: ['vector'],
            additionalProperties: false,
        },
        outputSchema: appliedPreviousOutput,
    })),

    defineSchema('physics.get_collision_layer_names', () => ({
        description: 'Returns the user-friendly names for collision layers 1-32.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        outputSchema: {
            type: 'object',
            properties: {
                layers: {
                    type: 'object',
                    additionalProperties: { type: 'string' },
                },
            },
            required: ['layers'],
            additionalProperties: true,
        },
    })),

    defineSchema('physics.configure_layer', () => ({
        description:
            'Sets the name and optional collision mask for layer `index` ' +
            '(1-32). Atomic write to `project.godot`.',
        inputSchema: {
            type: 'object',
            properties: {
                index: { type: 'integer', minimum: 1, maximum: 32 },
                name: { type: 'string', minLength: 1 },
                mask: { type: 'integer' },
            },
            required: ['index', 'name'],
            additionalProperties: false,
        },
        outputSchema: appliedOutput,
    })),

    defineSchema('particle.create_gpu', () => ({
        description:
            'Adds a `GPUParticles3D` (or `GPUParticles2D` when the parent is ' +
            '2D) named `name` under `parent_path`.',
        inputSchema: {
            type: 'object',
            properties: {
                scene_path: { type: 'string', minLength: 1 },
                parent_path: nodePath,
                name: { type: 'string', minLength: 1 },
                material_path: resourcePath,
            },
            required: ['scene_path', 'parent_path', 'name'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { node_path: nodePath },
            required: ['node_path'],
            additionalProperties: true,
        },
    })),

    defineSchema('particle.create_cpu', () => ({
        description:
            'Adds a `CPUParticles3D` (or 2D) named `name` under `parent_path`.',
        inputSchema: {
            type: 'object',
            properties: {
                scene_path: { type: 'string', minLength: 1 },
                parent_path: nodePath,
                name: { type: 'string', minLength: 1 },
            },
            required: ['scene_path', 'parent_path', 'name'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { node_path: nodePath },
            required: ['node_path'],
            additionalProperties: true,
        },
    })),

    defineSchema('particle.set_emission_shape', () => ({
        description:
            'Configures the emission shape on the ParticleProcessMaterial at ' +
            '`material_path`. `shape` is a Godot enum string (e.g. "sphere").',
        inputSchema: {
            type: 'object',
            properties: {
                material_path: resourcePath,
                shape: { type: 'string', minLength: 1 },
                params: dictBag,
            },
            required: ['material_path', 'shape', 'params'],
            additionalProperties: false,
        },
        outputSchema: appliedOutput,
    })),

    defineSchema('particle.preview_in_editor', () => ({
        description:
            'Plays the particle node at `node_path` in the editor for ' +
            '`duration` seconds.',
        inputSchema: {
            type: 'object',
            properties: {
                node_path: nodePath,
                duration: { type: 'number', minimum: 0 },
            },
            required: ['node_path'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { previewed: { type: 'boolean' } },
            required: ['previewed'],
            additionalProperties: true,
        },
    })),

    defineSchema('particle.convert_cpu_to_gpu', () => ({
        description:
            'Converts the CPUParticles node at `node_path` into the ' +
            'equivalent GPUParticles node, returning the new node path.',
        inputSchema: {
            type: 'object',
            properties: { node_path: nodePath },
            required: ['node_path'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { new_path: nodePath },
            required: ['new_path'],
            additionalProperties: true,
        },
    })),

    defineSchema('navigation.bake_mesh', () => ({
        description:
            'Bakes the navigation mesh under the NavigationRegion at ' +
            '`nav_region_path`.',
        inputSchema: {
            type: 'object',
            properties: {
                nav_region_path: nodePath,
                quality: { type: 'string', enum: ['draft', 'low', 'medium', 'high'] },
            },
            required: ['nav_region_path'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                baked: { type: 'boolean' },
                triangles: { type: 'integer', minimum: 0 },
            },
            required: ['baked', 'triangles'],
            additionalProperties: true,
        },
    })),

    defineSchema('navigation.find_path', () => ({
        description:
            'Returns a navigation path from `from` to `to`. When `optimize` is ' +
            'true, the path is post-processed for shortcuts.',
        inputSchema: {
            type: 'object',
            properties: {
                from: vector3,
                to: vector3,
                optimize: { type: 'boolean' },
            },
            required: ['from', 'to'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: {
                path: { type: 'array', items: vector3 },
                cost: { type: 'number', minimum: 0 },
            },
            required: ['path', 'cost'],
            additionalProperties: true,
        },
    })),

    defineSchema('navigation.add_agent', () => ({
        description:
            'Adds a NavigationAgent under `parent_path` configured by `params`.',
        inputSchema: {
            type: 'object',
            properties: {
                scene_path: { type: 'string', minLength: 1 },
                parent_path: nodePath,
                params: dictBag,
            },
            required: ['scene_path', 'parent_path'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { node_path: nodePath },
            required: ['node_path'],
            additionalProperties: true,
        },
    })),

    defineSchema('navigation.set_avoidance', () => ({
        description: 'Toggles avoidance on the agent at `node_path`.',
        inputSchema: {
            type: 'object',
            properties: {
                node_path: nodePath,
                enabled: { type: 'boolean' },
                radius: { type: 'number', minimum: 0 },
            },
            required: ['node_path', 'enabled'],
            additionalProperties: false,
        },
        outputSchema: appliedOutput,
    })),

    defineSchema('navigation.configure_layers', () => ({
        description:
            'Atomically applies the navigation layer name map declared in ' +
            '`layers` (`{layer_index: name}`).',
        inputSchema: {
            type: 'object',
            properties: { layers: dictBag },
            required: ['layers'],
            additionalProperties: false,
        },
        outputSchema: appliedOutput,
    })),

    defineSchema('navigation.debug_draw', () => ({
        description: 'Enables or disables navigation debug drawing.',
        inputSchema: {
            type: 'object',
            properties: { enabled: { type: 'boolean' } },
            required: ['enabled'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { enabled: { type: 'boolean' } },
            required: ['enabled'],
            additionalProperties: true,
        },
    })),

    defineSchema('audio.list_buses', () => ({
        description: 'Returns every audio bus and its current volume.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        outputSchema: {
            type: 'object',
            properties: {
                buses: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            name: { type: 'string' },
                            volume_db: { type: 'number' },
                        },
                        required: ['name'],
                        additionalProperties: true,
                    },
                },
            },
            required: ['buses'],
            additionalProperties: true,
        },
    })),

    defineSchema('audio.set_bus_volume_db', () => ({
        description: 'Sets the audio bus `bus_name` volume to `db`.',
        inputSchema: {
            type: 'object',
            properties: {
                bus_name: { type: 'string', minLength: 1 },
                db: { type: 'number' },
            },
            required: ['bus_name', 'db'],
            additionalProperties: false,
        },
        outputSchema: appliedPreviousOutput,
    })),

    defineSchema('audio.add_bus_effect', () => ({
        description:
            'Adds an effect of type `effect_type` (e.g. "Reverb", "Delay") to ' +
            'the bus `bus_name` and returns the new effect index.',
        inputSchema: {
            type: 'object',
            properties: {
                bus_name: { type: 'string', minLength: 1 },
                effect_type: { type: 'string', minLength: 1 },
                params: dictBag,
            },
            required: ['bus_name', 'effect_type'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { effect_index: { type: 'integer', minimum: 0 } },
            required: ['effect_index'],
            additionalProperties: true,
        },
    })),

    defineSchema('audio.import_sound', () => ({
        description:
            'Imports the audio file at `source_path` to `target_path` with ' +
            'the supplied `import_flags`.',
        inputSchema: {
            type: 'object',
            properties: {
                source_path: { type: 'string', minLength: 1 },
                target_path: resourcePath,
                import_flags: dictBag,
            },
            required: ['source_path', 'target_path'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { saved: { type: 'boolean' } },
            required: ['saved'],
            additionalProperties: true,
        },
    })),

    defineSchema('audio.play_stream', () => ({
        description:
            'Plays the audio stream at `stream_path`. Returns a unique ' +
            '`player_id` for later control.',
        inputSchema: {
            type: 'object',
            properties: {
                stream_path: resourcePath,
                bus: { type: 'string' },
                volume_db: { type: 'number' },
            },
            required: ['stream_path'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { player_id: { type: 'string' } },
            required: ['player_id'],
            additionalProperties: true,
        },
    })),

    defineSchema('audio.stop_stream', () => ({
        description:
            'Stops the audio player previously started by `audio.play_stream`.',
        inputSchema: {
            type: 'object',
            properties: { player_id: { type: 'string', minLength: 1 } },
            required: ['player_id'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { stopped: { type: 'boolean' } },
            required: ['stopped'],
            additionalProperties: true,
        },
    })),
] as const;
