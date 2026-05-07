/**
 * Feature: forgekit, Property 32: Conventional Commits validator accepts iff format matches
 *
 * Property-based test exercising the invariant
 *
 *     validateCommitMessage(m).ok === oracleAccepts(m)
 *
 * for a broad mixture of well-formed Conventional Commit headers, near-miss
 * mutations (missing colon, space inside scope, trailing period, etc.) and
 * purely random strings. The oracle is an intentionally-separate regex-based
 * specification of the contract described in the requirements document so
 * that drift between the implementation and the spec manifests as a failing
 * property rather than silently.
 *
 * Rejections are also inspected to confirm the JSON-RPC error payload shape
 * (code -32013, `data.expected_format`) that the `commit-msg` hook emits on
 * stderr.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  ALLOWED_TYPES,
  EXPECTED_FORMAT,
  ERROR_CODE_FORMAT_VIOLATION,
  ERROR_MESSAGE_FORMAT_VIOLATION,
  runHook,
  validateCommitMessage,
} from '../commit-msg.js';

/**
 * Pinned iteration count for every property. Matches the spec requirement
 * that each property runs at least 100 iterations in CI.
 */
const NUM_RUNS = 100 as const;

const ALLOWED_TYPE_SET: ReadonlySet<string> = new Set(ALLOWED_TYPES);
const BYPASS_PREFIXES: readonly string[] = ['Merge ', 'fixup! ', 'squash! '] as const;

/**
 * Independent oracle. Mirrors the contract described in the requirements
 * document without sharing code with {@link validateCommitMessage}, so the
 * property test genuinely checks biconditional agreement rather than
 * tautologically re-running the implementation.
 *
 * Rules (oracle form):
 *   1. Bypass headers (`Merge `, `fixup! `, `squash! `) are always accepted.
 *   2. Otherwise the header must match
 *      `<type>(<scope>)?!?:\s<subject>`, where
 *        - `type` is exactly one of ALLOWED_TYPES,
 *        - `scope` is non-empty and contains no whitespace or parentheses,
 *        - `subject` is non-empty, contains at least one non-whitespace
 *          character, and does not end with a period.
 */
function oracleAccepts(header: string): boolean {
  for (const prefix of BYPASS_PREFIXES) {
    if (header.startsWith(prefix)) {
      return true;
    }
  }

  // Using character classes that are deliberately different from the
  // implementation's single compound regex: we alternate between a
  // type-first split and per-field predicates so the two implementations
  // can drift independently.
  const colonSpaceIndex = findHeaderColon(header);
  if (colonSpaceIndex === -1) {
    return false;
  }

  const prefix = header.slice(0, colonSpaceIndex);
  const subject = header.slice(colonSpaceIndex + 2); // skip ":" + whitespace

  const { type, scope, breaking, ok: prefixOk } = splitPrefix(prefix);
  if (!prefixOk) {
    return false;
  }
  if (!ALLOWED_TYPE_SET.has(type)) {
    return false;
  }
  if (scope !== null && (scope.length === 0 || /[\s()]/u.test(scope))) {
    return false;
  }
  if (breaking !== null && breaking !== '!') {
    return false;
  }

  if (subject.length === 0) {
    return false;
  }
  if (subject.endsWith('.')) {
    return false;
  }
  if (subject.trim().length === 0) {
    return false;
  }

  return true;
}

/**
 * Locate the `:<whitespace>` separator between the header prefix and the
 * subject. Returns the index of the colon, or -1 if not found.
 */
function findHeaderColon(header: string): number {
  for (let i = 0; i < header.length - 1; i++) {
    if (header[i] === ':' && /\s/u.test(header[i + 1])) {
      return i;
    }
  }
  return -1;
}

/**
 * Split a header prefix `type(scope)?!?` into its components. Returns
 * `ok: false` if the prefix does not decompose cleanly.
 */
function splitPrefix(prefix: string): {
  type: string;
  scope: string | null;
  breaking: string | null;
  ok: boolean;
} {
  let breaking: string | null = null;
  let rest = prefix;
  if (rest.endsWith('!')) {
    breaking = '!';
    rest = rest.slice(0, -1);
  }

  const openParen = rest.indexOf('(');
  if (openParen === -1) {
    return { type: rest, scope: null, breaking, ok: true };
  }

  if (!rest.endsWith(')')) {
    return { type: '', scope: null, breaking, ok: false };
  }

  const type = rest.slice(0, openParen);
  const scope = rest.slice(openParen + 1, -1);
  return { type, scope, breaking, ok: true };
}

// --------------------------------------------------------------------------
// Arbitraries
// --------------------------------------------------------------------------

/** A single character acceptable inside a Conventional Commits scope. */
const scopeCharArb = fc
  .char()
  .filter((c) => !/[\s()]/u.test(c));

const scopeArb = fc.stringOf(scopeCharArb, { minLength: 1, maxLength: 20 });

/**
 * Subject arbitrary that avoids newlines (the header is always a single
 * line), avoids a trailing period so valid-header construction yields a
 * genuinely valid header, and never starts with whitespace. The latter
 * constraint prevents the `missing-space` mutation below from accidentally
 * reintroducing a valid `: <subject>` shape when the first subject
 * character happens to be whitespace.
 */
const subjectArb = fc
  .string({ minLength: 1, maxLength: 60 })
  .filter((s) => !/[\r\n]/u.test(s))
  .filter((s) => s.trim().length > 0)
  .filter((s) => !s.endsWith('.'))
  .filter((s) => !/^\s/u.test(s));

/** Arbitrary producing a well-formed Conventional Commits header. */
const validHeaderArb = fc
  .tuple(
    fc.constantFrom(...ALLOWED_TYPES),
    fc.option(scopeArb, { nil: null }),
    fc.boolean(), // breaking-change marker
    subjectArb,
  )
  .map(([type, scope, breaking, subject]) => {
    const scopePart = scope === null ? '' : `(${scope})`;
    const breakingPart = breaking ? '!' : '';
    return `${type}${scopePart}${breakingPart}: ${subject}`;
  });

/**
 * Arbitrary producing mutated near-valid headers. Each mutation targets a
 * specific rejection reason so the property covers the full failure surface.
 */
const mutatedHeaderArb = fc
  .tuple(
    fc.constantFrom(...ALLOWED_TYPES),
    scopeArb,
    subjectArb,
    fc.constantFrom(
      'space-in-scope',
      'parens-in-scope',
      'trailing-period',
      'missing-colon',
      'missing-space',
      'unknown-type',
      'empty-subject',
      'whitespace-subject',
      'uppercase-type',
    ),
  )
  .map(([type, scope, subject, mutation]) => {
    switch (mutation) {
      case 'space-in-scope':
        return `${type}(${scope} bad): ${subject}`;
      case 'parens-in-scope':
        return `${type}(${scope}(nested)): ${subject}`;
      case 'trailing-period':
        return `${type}(${scope}): ${subject}.`;
      case 'missing-colon':
        return `${type}(${scope}) ${subject}`;
      case 'missing-space':
        return `${type}(${scope}):${subject}`;
      case 'unknown-type':
        return `${type}ish(${scope}): ${subject}`;
      case 'empty-subject':
        return `${type}(${scope}): `;
      case 'whitespace-subject':
        return `${type}(${scope}):    `;
      case 'uppercase-type':
        return `${type.toUpperCase()}(${scope}): ${subject}`;
    }
  });

/**
 * Single-line arbitrary string. Newlines are excluded so that every
 * generated value is a header rather than a multi-line message.
 */
const arbitraryHeaderArb = fc
  .string({ maxLength: 80 })
  .filter((s) => !/[\r\n]/u.test(s));

/** Mixed arbitrary covering the three generator families. */
const headerArb = fc.oneof(
  { weight: 3, arbitrary: validHeaderArb },
  { weight: 3, arbitrary: mutatedHeaderArb },
  { weight: 1, arbitrary: arbitraryHeaderArb },
);

// --------------------------------------------------------------------------
// Properties
// --------------------------------------------------------------------------

describe('Property 32: Conventional Commits validator accepts iff format matches', () => {
  it('agrees with the independent oracle on every generated header', () => {
    fc.assert(
      fc.property(headerArb, (header) => {
        const fromImpl = validateCommitMessage(header).ok;
        const fromOracle = oracleAccepts(header);
        return fromImpl === fromOracle;
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('accepts every well-formed header produced by the valid-header arbitrary', () => {
    fc.assert(
      fc.property(validHeaderArb, (header) => {
        return validateCommitMessage(header).ok === true;
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects every mutated header produced by the mutation arbitrary', () => {
    fc.assert(
      fc.property(mutatedHeaderArb, (header) => {
        return validateCommitMessage(header).ok === false;
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('surfaces expected_format and the received header on every rejection', () => {
    fc.assert(
      fc.property(headerArb, (header) => {
        const result = validateCommitMessage(header);
        if (result.ok) {
          return true; // irrelevant for this property
        }
        return (
          result.expectedFormat === EXPECTED_FORMAT &&
          result.received === extractFirstNonEmptyLine(header) &&
          result.allowedTypes.length === ALLOWED_TYPES.length
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('emits a JSON-RPC error with code -32013 and expected_format on every rejection via runHook', async () => {
    await fc.assert(
      fc.asyncProperty(mutatedHeaderArb, async (header) => {
        const stderrChunks: string[] = [];
        let exitCode: number | null = null;
        const io = {
          readFile: async (path: string): Promise<string> => {
            if (path !== '.git/COMMIT_EDITMSG') {
              throw new Error(`unexpected path: ${path}`);
            }
            return header;
          },
          writeStderr: (chunk: string): void => {
            stderrChunks.push(chunk);
          },
          exit: (code: number): void => {
            exitCode = code;
          },
        };

        await runHook(['node', 'commit-msg.js', '.git/COMMIT_EDITMSG'], io);

        if (exitCode === 0) {
          // mutated arbitrary must always produce rejections
          return false;
        }
        const body = stderrChunks.join('');
        const jsonStart = body.indexOf('{');
        if (jsonStart < 0) {
          return false;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(body.slice(jsonStart));
        } catch {
          return false;
        }
        const payload = parsed as {
          jsonrpc?: string;
          error?: {
            code?: number;
            message?: string;
            data?: { expected_format?: string };
          };
        };
        return (
          payload.jsonrpc === '2.0' &&
          payload.error?.code === ERROR_CODE_FORMAT_VIOLATION &&
          payload.error?.message === ERROR_MESSAGE_FORMAT_VIOLATION &&
          payload.error?.data?.expected_format === EXPECTED_FORMAT
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

/**
 * Test-side helper mirroring the validator's internal header extraction so
 * the `received` expectation matches what the implementation reports.
 */
function extractFirstNonEmptyLine(message: string): string {
  for (const line of message.split(/\r?\n/)) {
    if (line.trim().length > 0) {
      return line;
    }
  }
  return '';
}
