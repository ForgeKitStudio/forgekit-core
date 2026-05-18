/**
 * Tests for the `validate-schemas` CI helper.
 *
 * Confirms that the in-repo `profiles.json` validates clean and that
 * the validator detects manufactured drift (a missing tool in a
 * synthetic profiles file).
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { validateSchemas } from '../../scripts/ci/validate-schemas.js';

const here = dirname(fileURLToPath(import.meta.url));
const PROFILES_PATH = resolve(here, '..', '..', 'profiles.json');

describe('validateSchemas', () => {
    it('returns ok=true for the in-repo profiles.json', async () => {
        const result = await validateSchemas(PROFILES_PATH);
        expect(result.compileErrors).toEqual([]);
        expect(result.missing).toEqual([]);
        expect(result.extra).toEqual([]);
        expect(result.ok).toBe(true);
    });

    it('reports missing schemas when profiles.json drifts', async () => {
        // Build a synthetic profiles.json with one extra tool that
        // does not exist in the schema registry.
        const tmpDir = mkdtempSync(join(tmpdir(), 'fk-schema-validation-'));
        const ghostPath = join(tmpDir, 'profiles.json');
        const synthetic = {
            version: '0.0.0-test',
            tools: [
                {
                    name: 'ghost.tool',
                    scope: 'core',
                    channel: 'editor',
                    module: 'core',
                },
            ],
        };
        writeFileSync(ghostPath, JSON.stringify(synthetic), 'utf8');

        const result = await validateSchemas(ghostPath);
        expect(result.ok).toBe(false);
        expect(result.missing).toContain('ghost.tool');
    });
});
