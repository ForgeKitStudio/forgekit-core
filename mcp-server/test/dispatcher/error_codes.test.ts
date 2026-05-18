/**
 * Tests for `src/dispatcher/error_codes.ts` — single source of truth
 * for the JSON-RPC error envelope produced by every `DispatchError`
 * thrown anywhere in the Node-side MCP server.
 *
 * Coverage:
 *   - Every code listed by task 8.12.1 of the action-rpg-starter-kit
 *     spec is registered with a non-empty `name`, `message`, and
 *     `suggestion`.
 *   - `getErrorInfo(code)` round-trips: each registered code produces
 *     the registered name; the produced envelope embeds the
 *     suggestion under `data.suggestion`.
 *   - `normalizeError(code, extraData)` keeps the canonical message
 *     and suggestion while merging caller-supplied `data` fields, and
 *     respects a caller-supplied suggestion override.
 *   - Integration test: simulating each error class produces an
 *     envelope shaped `{code, message, data: {suggestion, ...}}` with
 *     the expected code and a non-empty suggestion.
 *   - Property test: for every registered code, the envelope's
 *     `data.suggestion` is a non-empty string.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
    CANONICAL_ERROR_CODES,
    ERROR_CODE_REGISTRY,
    getErrorInfo,
    isRegisteredErrorCode,
    listRegisteredErrorCodes,
    normalizeError,
} from '../../src/dispatcher/error_codes.js';

/**
 * Codes mandated by task 8.12.1, with the divergences noted in
 * `error_codes.ts`: `-32008` keeps its existing
 * `CORE_VERSION_UNAVAILABLE` meaning, and the new spec codes for
 * `LICENSE_INVALID`, `PROFILE_TOOL_FILTERED`, and `UNKNOWN_PROFILE`
 * are relocated to `-32023..-32025` so the multi-project subsystem
 * keeps `-32015..-32017`.
 */
const SPEC_CODES: ReadonlyArray<{ code: number; name: string }> = [
    { code: -32600, name: 'INVALID_REQUEST' },
    { code: -32601, name: 'METHOD_NOT_FOUND' },
    { code: -32602, name: 'INVALID_PARAMS' },
    { code: -32603, name: 'INTERNAL_ERROR' },
    { code: -32700, name: 'PARSE_ERROR' },
    { code: -32000, name: 'CHANNEL_UNAVAILABLE' },
    { code: -32001, name: 'CHANNEL_TIMEOUT' },
    { code: -32002, name: 'PACKET_TOO_LARGE' },
    { code: -32003, name: 'UNDO_REDO_FAILED' },
    { code: -32004, name: 'TRANSACTION_TIMEOUT' },
    { code: -32005, name: 'PACKET_TOO_LARGE_RUNTIME' },
    { code: -32006, name: 'CORE_VERSION_MISMATCH' },
    { code: -32007, name: 'NESTED_TRANSACTION_NOT_ALLOWED' },
    { code: -32008, name: 'CORE_VERSION_UNAVAILABLE' },
    { code: -32009, name: 'GDSCRIPT_SYNTAX_ERROR' },
    { code: -32010, name: 'CORE_BOUNDARY_VIOLATION' },
    { code: -32011, name: 'MANIFEST_TAG_NOT_FOUND' },
    { code: -32012, name: 'CONTEXT_FILE_STALE' },
    { code: -32013, name: 'CONVENTIONAL_COMMITS_FORMAT_VIOLATION' },
    { code: -32014, name: 'PR_TEMPLATE_INCOMPLETE' },
    { code: -32023, name: 'LICENSE_INVALID' },
    { code: -32024, name: 'PROFILE_TOOL_FILTERED' },
    { code: -32025, name: 'UNKNOWN_PROFILE' },
];

describe('error_codes — canonical registry', () => {
    it('registers every code mandated by task 8.12.1', () => {
        for (const { code, name } of SPEC_CODES) {
            expect(isRegisteredErrorCode(code)).toBe(true);
            const info = ERROR_CODE_REGISTRY[code];
            expect(info, `code ${code} must be registered`).toBeDefined();
            expect(info!.name).toBe(name);
        }
    });

    it('exposes CANONICAL_ERROR_CODES as a frozen, ordered list', () => {
        expect(Array.isArray(CANONICAL_ERROR_CODES)).toBe(true);
        expect(Object.isFrozen(CANONICAL_ERROR_CODES)).toBe(true);
        for (const { code } of SPEC_CODES) {
            expect(CANONICAL_ERROR_CODES).toContain(code);
        }
    });

    it('every registered entry has non-empty name, message, and suggestion', () => {
        for (const code of listRegisteredErrorCodes()) {
            const info = getErrorInfo(code);
            expect(typeof info.name).toBe('string');
            expect(info.name.length).toBeGreaterThan(0);
            expect(typeof info.message).toBe('string');
            expect(info.message.length).toBeGreaterThan(0);
            expect(typeof info.suggestion).toBe('string');
            expect(info.suggestion.length).toBeGreaterThan(0);
        }
    });

    it('rejects unknown codes from getErrorInfo', () => {
        expect(() => getErrorInfo(-99999)).toThrow(/unknown error code/i);
    });
});

describe('error_codes — normalizeError envelope shape', () => {
    it('produces {code, message, data: {suggestion}} for every registered code', () => {
        for (const code of listRegisteredErrorCodes()) {
            const envelope = normalizeError(code);
            expect(envelope.code).toBe(code);
            const info = getErrorInfo(code);
            expect(envelope.message).toBe(info.message);
            expect(envelope.data).toBeDefined();
            expect(envelope.data.suggestion).toBe(info.suggestion);
            expect(envelope.data.suggestion.length).toBeGreaterThan(0);
        }
    });

    it('merges extra data without overwriting the default suggestion', () => {
        const envelope = normalizeError(-32602, { detail: 'bad', method: 'foo' });
        expect(envelope.code).toBe(-32602);
        expect(envelope.data.suggestion.length).toBeGreaterThan(0);
        expect(envelope.data).toMatchObject({
            detail: 'bad',
            method: 'foo',
            suggestion: getErrorInfo(-32602).suggestion,
        });
    });

    it('respects a caller-supplied suggestion override', () => {
        const envelope = normalizeError(-32601, {
            method: 'unknown.tool',
            suggestion: 'Call tools/list to see registered methods.',
        });
        expect(envelope.data.suggestion).toBe(
            'Call tools/list to see registered methods.',
        );
    });

    it('throws when normalizing an unknown code', () => {
        expect(() => normalizeError(-12345)).toThrow(/unknown error code/i);
    });
});

describe('error_codes — integration: simulate each error class', () => {
    it('every registered code yields a JSON-RPC 2.0 error envelope shape', () => {
        for (const code of listRegisteredErrorCodes()) {
            const envelope = normalizeError(code, { source: 'simulation' });
            expect(envelope).toHaveProperty('code');
            expect(envelope).toHaveProperty('message');
            expect(envelope).toHaveProperty('data');
            expect(typeof envelope.code).toBe('number');
            expect(typeof envelope.message).toBe('string');
            expect(envelope.data).not.toBeNull();
            expect(typeof envelope.data).toBe('object');
            expect(envelope.data.source).toBe('simulation');
            expect(envelope.data.suggestion.length).toBeGreaterThan(0);
        }
    });
});

describe('error_codes — Property: data.suggestion non-empty for any registered code', () => {
    it('Validates: Wymagania 4.5, 5.5, 9.2, 31.5', () => {
        const registered = listRegisteredErrorCodes();
        const codeArb = fc.constantFrom(...registered);
        const extraArb = fc.dictionary(
            fc.string({ minLength: 1, maxLength: 12 }).filter((k) => k !== 'suggestion'),
            fc.oneof(fc.string(), fc.integer(), fc.boolean()),
            { maxKeys: 5 },
        );
        fc.assert(
            fc.property(codeArb, extraArb, (code, extra) => {
                const envelope = normalizeError(code, extra);
                expect(envelope.code).toBe(code);
                expect(typeof envelope.data.suggestion).toBe('string');
                expect(envelope.data.suggestion.length).toBeGreaterThan(0);
            }),
            { numRuns: 100 },
        );
    });
});
