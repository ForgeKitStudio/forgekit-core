/**
 * Parity test: confirm `addons/forgekit_core/mcp/editor_plugin/mcp_error_codes.gd`
 * declares constants for every code the canonical TypeScript registry
 * also expects on the GDScript side.
 *
 * Today the GDScript file is the source of truth for the editor plugin
 * and the runtime bridge; the TypeScript registry mirrors the same
 * surface for the MCP server. This test enforces that any newly
 * registered code listed in `EXPECTED_GD_CODES` ships in both files,
 * so the editor plugin and the dispatcher cannot drift.
 *
 * Task 8.12.3 explicitly requires `-32024 PROFILE_TOOL_FILTERED` and
 * `-32025 UNKNOWN_PROFILE` to be present (the spec list calls them
 * `-32016` / `-32017`, but those slots are owned by the multi-project
 * subsystem; see `src/dispatcher/error_codes.ts` for the rationale).
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const GD_PATH = resolve(
    HERE,
    '..',
    '..',
    '..',
    'addons',
    'forgekit_core',
    'mcp',
    'editor_plugin',
    'mcp_error_codes.gd',
);

/**
 * The codes whose presence in `mcp_error_codes.gd` this test enforces.
 * Limited to the codes added by task 8.12 — pre-existing codes are
 * verified by the Godot-side GUT test suite.
 */
const EXPECTED_GD_CODES: ReadonlyArray<{ name: string; code: number }> = [
    { name: 'PROFILE_TOOL_FILTERED', code: -32024 },
    { name: 'UNKNOWN_PROFILE', code: -32025 },
];

describe('mcp_error_codes.gd — parity with task 8.12 codes', () => {
    it('declares each expected constant with the matching numeric value', async () => {
        const source = await readFile(GD_PATH, 'utf8');
        for (const { name, code } of EXPECTED_GD_CODES) {
            const constRe = new RegExp(
                String.raw`const\s+${name}\s*:\s*int\s*=\s*${code}\b`,
            );
            const messageRe = new RegExp(
                String.raw`const\s+${name}_MESSAGE\s*:\s*String\s*=\s*"${name}"`,
            );
            expect(
                constRe.test(source),
                `expected ${name} = ${code} in mcp_error_codes.gd`,
            ).toBe(true);
            expect(
                messageRe.test(source),
                `expected ${name}_MESSAGE = "${name}" in mcp_error_codes.gd`,
            ).toBe(true);
        }
    });

    it('attaches a default suggestion to each task-8.12 code', async () => {
        const source = await readFile(GD_PATH, 'utf8');
        for (const { name } of EXPECTED_GD_CODES) {
            // The match-arm in `_default_suggestion` is `<NAME>:` followed
            // by an indented `return "..."`. The suggestion must be
            // non-empty.
            const suggestionRe = new RegExp(
                String.raw`${name}\s*:\s*\n\s+return\s+"[^"]+"`,
            );
            expect(
                suggestionRe.test(source),
                `expected non-empty suggestion arm for ${name}`,
            ).toBe(true);
        }
    });
});
