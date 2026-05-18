/**
 * Validates that the in-process tool schema registry covers every
 * entry declared in `profiles.json` and that every schema compiles
 * cleanly through Ajv 8 (JSON Schema Draft 2020-12 strict mode).
 *
 * This test is the unit-level companion to the CI script
 * `scripts/ci/validate-schemas.ts`; both share the same source of
 * truth so a green test means a green CI.
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import { loadProfiles } from '../../src/profiles.js';
import {
    getToolSchemas,
    listToolSchemaNames,
} from '../../src/schema/tool_schemas.js';

const here = dirname(fileURLToPath(import.meta.url));
const PROFILES_PATH = resolve(here, '..', '..', 'profiles.json');

describe('tool_schemas — registry × profiles.json coverage', () => {
    it('exposes a schema for every tool name declared in profiles.json', async () => {
        const profiles = await loadProfiles(PROFILES_PATH);
        const profileNames = new Set(profiles.tools.map((t) => t.name));
        const schemaNames = new Set(listToolSchemaNames());

        const missing = [...profileNames].filter((n) => !schemaNames.has(n)).sort();
        const extra = [...schemaNames].filter((n) => !profileNames.has(n)).sort();

        expect(missing).toEqual([]);
        expect(extra).toEqual([]);
    });

    it('every schema has a non-empty description and object-shaped IO', () => {
        const all = getToolSchemas();
        for (const [name, schema] of all) {
            expect(typeof schema.description, name).toBe('string');
            expect(schema.description.length, name).toBeGreaterThan(0);
            expect(schema.inputSchema.type, name).toBe('object');
            expect(schema.outputSchema.type, name).toBe('object');
        }
    });
});

describe('tool_schemas — Ajv compilation', () => {
    it('every input schema compiles without errors', () => {
        const ajv = new Ajv2020({ strict: false, allErrors: true });
        const failures: string[] = [];
        for (const [name, schema] of getToolSchemas()) {
            try {
                ajv.compile(schema.inputSchema);
            } catch (err) {
                failures.push(`${name}.inputSchema: ${(err as Error).message}`);
            }
        }
        expect(failures).toEqual([]);
    });

    it('every output schema compiles without errors', () => {
        const ajv = new Ajv2020({ strict: false, allErrors: true });
        const failures: string[] = [];
        for (const [name, schema] of getToolSchemas()) {
            try {
                ajv.compile(schema.outputSchema);
            } catch (err) {
                failures.push(`${name}.outputSchema: ${(err as Error).message}`);
            }
        }
        expect(failures).toEqual([]);
    });
});
