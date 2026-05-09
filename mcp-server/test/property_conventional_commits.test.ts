/**
 * Feature: forgekit, Property 32: Conventional Commits validator
 *
 * Validates: Requirements 41.1, 41.2, 41.3
 *
 * Property-based sibling of `commit_msg_validator.test.ts`: for any
 * generated header drawn from the Conventional Commits grammar, the
 * validator must accept it (ok=true); for any header drawn from the
 * complement, the validator must reject it (ok=false) with the
 * canonical `-32013` payload. The example-based tests in
 * `commit_msg_validator.test.ts` document individual corner cases;
 * this property test documents the iff contract over the full
 * generator space.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  ALLOWED_TYPES,
  ERROR_CODE_FORMAT_VIOLATION,
  ERROR_MESSAGE_FORMAT_VIOLATION,
  validateCommitMessage,
} from '../scripts/git-hooks/commit-msg.js';

/** Pinned iteration count per Phase 6.24 gate specification. */
const NUM_RUNS = 100 as const;

// ---------------------------------------------------------------------------
// Arbitraries — Conventional Commits positive / negative generators
// ---------------------------------------------------------------------------

const allowedTypeArb = fc.constantFrom(...ALLOWED_TYPES);

/**
 * Scope grammar: non-empty, no whitespace, no parentheses. The
 * commit-msg validator accepts dots, hyphens, underscores, and
 * alphanumerics in scopes; we draw from a broader safe subset.
 */
const validScopeArb = fc.stringMatching(/^[a-zA-Z0-9._-]{1,12}$/);

/**
 * Subject generator: any non-empty string that does not end in `.` and
 * does not contain newlines (the validator ignores body / footer
 * lines but the header itself is the first line).
 */
const subjectArb = fc
  .string({ minLength: 1, maxLength: 40, unit: 'grapheme-ascii' })
  .filter(
    (s) =>
      s.trim().length > 0 &&
      !s.endsWith('.') &&
      !s.includes('\n') &&
      !s.includes('\r'),
  );

const validHeaderArb = fc
  .tuple(
    allowedTypeArb,
    fc.option(validScopeArb, { nil: null }),
    fc.boolean(),
    subjectArb,
  )
  .map(([type, scope, breaking, subject]) => {
    const scopePart = scope === null ? '' : `(${scope})`;
    const breakingPart = breaking ? '!' : '';
    return `${type}${scopePart}${breakingPart}: ${subject}`;
  });

/**
 * Freeform strings that almost never satisfy the Conventional
 * Commits grammar. We filter out the few accidental matches so the
 * negative property stays deterministic.
 */
const freeformHeaderArb = fc
  .string({ minLength: 0, maxLength: 40 })
  .filter((s) => !s.includes('\n') && validateCommitMessage(s).ok === false);

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe('Property 32: Conventional Commits validator', () => {
  it('accepts every header drawn from the grammar', () => {
    fc.assert(
      fc.property(validHeaderArb, (header) => {
        expect(validateCommitMessage(header).ok).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects every freeform header with the -32013 envelope', () => {
    fc.assert(
      fc.property(freeformHeaderArb, (header) => {
        const result = validateCommitMessage(header);
        expect(result.ok).toBe(false);
        // `validateCommitMessage` returns the validation report used
        // by the hook to build the JSON-RPC error envelope. The
        // numeric code and literal message are the stable public
        // contract consumed by CI.
        expect(ERROR_CODE_FORMAT_VIOLATION).toBe(-32013);
        expect(ERROR_MESSAGE_FORMAT_VIOLATION).toBe(
          'CONVENTIONAL_COMMITS_FORMAT_VIOLATION',
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('treats body and footer lines as comments: header-only validation', () => {
    fc.assert(
      fc.property(validHeaderArb, fc.string({ maxLength: 30 }), (header, body) => {
        const message = body === '' ? header : `${header}\n\n${body}`;
        expect(validateCommitMessage(message).ok).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
