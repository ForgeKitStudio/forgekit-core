/**
 * Tests for `scripts/validate-error-codes.ts` — the CI lint that walks
 * `src/**\/*.ts`, finds every `throw new (Cli|Cross)DispatchError(code, ...)`
 * site, and asserts the numeric `code` is registered in
 * `src/dispatcher/error_codes.ts`.
 *
 * Coverage:
 *   - Pure scanner (`scanSourceForDispatchErrors`) parses both inline
 *     numeric literals and identifier references resolved through a
 *     supplied constants map; unknown identifiers surface as findings
 *     with `code === undefined` so the linter flags them.
 *   - `validateDispatchErrorCodes` succeeds when every found code is
 *     registered and surfaces a deterministic violation list when any
 *     code is missing or unresolvable.
 *   - Running the validator against the live `src/` tree passes — the
 *     real codebase is consistent with `error_codes.ts` today.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
    scanSourceForDispatchErrors,
    validateDispatchErrorCodes,
    type DispatchErrorThrowSite,
} from '../../scripts/validate-error-codes.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(HERE, '..', '..', 'src');

describe('scanSourceForDispatchErrors — single-file parsing', () => {
    it('extracts numeric-literal codes from CliDispatchError throw sites', () => {
        const source = [
            "throw new CliDispatchError(-32601, 'Method not found', { method });",
            'throw new CliDispatchError(-32602, "Invalid params");',
        ].join('\n');
        const sites = scanSourceForDispatchErrors(source, 'fake.ts', {});
        expect(sites).toHaveLength(2);
        expect(sites[0].code).toBe(-32601);
        expect(sites[0].kind).toBe('CliDispatchError');
        expect(sites[1].code).toBe(-32602);
    });

    it('resolves identifier-referenced codes via the constants map', () => {
        const source =
            "throw new CrossDispatchError(METHOD_NOT_FOUND, 'Method not found');";
        const sites = scanSourceForDispatchErrors(source, 'fake.ts', {
            METHOD_NOT_FOUND: -32601,
        });
        expect(sites).toHaveLength(1);
        expect(sites[0].code).toBe(-32601);
        expect(sites[0].kind).toBe('CrossDispatchError');
        expect(sites[0].rawCode).toBe('METHOD_NOT_FOUND');
    });

    it('reports unresolved identifiers as undefined-code sites', () => {
        const source =
            "throw new CliDispatchError(MYSTERY_CODE, 'unknown', {});";
        const sites = scanSourceForDispatchErrors(source, 'fake.ts', {});
        expect(sites).toHaveLength(1);
        expect(sites[0].code).toBeUndefined();
        expect(sites[0].rawCode).toBe('MYSTERY_CODE');
    });

    it('ignores throws of other error kinds', () => {
        const source = "throw new Error('boom');";
        const sites = scanSourceForDispatchErrors(source, 'fake.ts', {});
        expect(sites).toEqual([]);
    });
});

describe('validateDispatchErrorCodes — verdicts', () => {
    it('passes when every site uses a registered code', () => {
        const sites: DispatchErrorThrowSite[] = [
            {
                file: 'fake.ts',
                line: 1,
                kind: 'CliDispatchError',
                rawCode: '-32601',
                code: -32601,
            },
            {
                file: 'fake.ts',
                line: 2,
                kind: 'CrossDispatchError',
                rawCode: '-32602',
                code: -32602,
            },
        ];
        const result = validateDispatchErrorCodes(sites);
        expect(result.ok).toBe(true);
        expect(result.violations).toEqual([]);
    });

    it('reports unregistered numeric codes as violations', () => {
        const sites: DispatchErrorThrowSite[] = [
            {
                file: 'fake.ts',
                line: 5,
                kind: 'CliDispatchError',
                rawCode: '-99999',
                code: -99999,
            },
        ];
        const result = validateDispatchErrorCodes(sites);
        expect(result.ok).toBe(false);
        expect(result.violations).toHaveLength(1);
        expect(result.violations[0].reason).toBe('UNREGISTERED_CODE');
        expect(result.violations[0].code).toBe(-99999);
    });

    it('reports unresolvable identifier codes as violations', () => {
        const sites: DispatchErrorThrowSite[] = [
            {
                file: 'fake.ts',
                line: 9,
                kind: 'CliDispatchError',
                rawCode: 'MYSTERY_CODE',
                code: undefined,
            },
        ];
        const result = validateDispatchErrorCodes(sites);
        expect(result.ok).toBe(false);
        expect(result.violations[0].reason).toBe('UNRESOLVED_IDENTIFIER');
    });
});

describe('validate-error-codes — live src/ tree', () => {
    it('every DispatchError throw in src/ uses a registered code', async () => {
        const { scanProject } = await import(
            '../../scripts/validate-error-codes.js'
        );
        const sites = await scanProject(SRC_DIR);
        const result = validateDispatchErrorCodes(sites);
        if (!result.ok) {
            const detail = result.violations
                .map(
                    (v) =>
                        `${v.file}:${v.line} (${v.kind}) raw=${v.rawCode} reason=${v.reason}`,
                )
                .join('\n');
            throw new Error(`Found dispatch error violations:\n${detail}`);
        }
        expect(result.ok).toBe(true);
        expect(sites.length).toBeGreaterThan(0);
    });
});
