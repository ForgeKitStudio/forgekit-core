/**
/**
 * Unit tests for the Conventional Commits validator used by the commit-msg
 * Git hook. Exercises the pure validator plus the `runHook` driver through a
 * dependency-injected I/O harness so we never spawn subprocesses or touch the
 * real filesystem.
 */

import { describe, expect, it } from 'vitest';

import {
  ALLOWED_TYPES,
  EXPECTED_FORMAT,
  runHook,
  validateCommitMessage,
} from '../scripts/git-hooks/commit-msg.js';

describe('validateCommitMessage — accepted headers', () => {
  it('accepts every allowed type without a scope', () => {
    for (const type of ALLOWED_TYPES) {
      const result = validateCommitMessage(`${type}: add thing`);
      expect(result.ok, `type=${type} should be accepted`).toBe(true);
    }
  });

  it('accepts a scoped header', () => {
    expect(validateCommitMessage('feat(core): add event bus introspection').ok).toBe(true);
  });

  it('accepts a breaking-change marker "!" before the colon', () => {
    expect(validateCommitMessage('feat(api)!: change signature').ok).toBe(true);
    expect(validateCommitMessage('refactor!: drop legacy path').ok).toBe(true);
  });

  it('accepts subjects that contain punctuation without a trailing period', () => {
    expect(validateCommitMessage('fix(core): handle empty list, zero input').ok).toBe(true);
    expect(validateCommitMessage('docs: explain "quoted" behaviour').ok).toBe(true);
  });

  it('ignores body and footer lines, validating only the header', () => {
    const message = 'feat(core): add event bus introspection\n\nBody paragraph.\nAnother line.';
    expect(validateCommitMessage(message).ok).toBe(true);
  });

  it('bypasses merge commits', () => {
    expect(validateCommitMessage('Merge branch main into feature/x').ok).toBe(true);
  });

  it('bypasses fixup! and squash! commits', () => {
    expect(validateCommitMessage('fixup! feat(core): add event bus').ok).toBe(true);
    expect(validateCommitMessage('squash! feat(core): add event bus').ok).toBe(true);
  });
});

describe('validateCommitMessage — rejected headers', () => {
  it('rejects an empty header', () => {
    const result = validateCommitMessage('');
    expect(result.ok).toBe(false);
  });

  it('rejects an unknown type', () => {
    const result = validateCommitMessage('chore-ish: something');
    expect(result.ok).toBe(false);
  });

  it('rejects a scope containing whitespace', () => {
    const result = validateCommitMessage('feat(my scope): something');
    expect(result.ok).toBe(false);
  });

  it('rejects a scope containing parentheses', () => {
    const result = validateCommitMessage('feat(outer(inner)): something');
    expect(result.ok).toBe(false);
  });

  it('rejects a subject that ends with a period', () => {
    const result = validateCommitMessage('feat(core): add thing.');
    expect(result.ok).toBe(false);
  });

  it('rejects a missing colon', () => {
    const result = validateCommitMessage('feat add thing');
    expect(result.ok).toBe(false);
  });

  it('rejects a missing subject', () => {
    const result = validateCommitMessage('feat(core): ');
    expect(result.ok).toBe(false);
  });

  it('rejects a type that contains a space', () => {
    const result = validateCommitMessage('fe at: add thing');
    expect(result.ok).toBe(false);
  });

  it('reports the allowed types, expected format, and received header on rejection', () => {
    const result = validateCommitMessage('garbage');
    if (result.ok) {
      throw new Error('Expected rejection');
    }
    expect(result.allowedTypes).toEqual(ALLOWED_TYPES);
    expect(result.expectedFormat).toBe(EXPECTED_FORMAT);
    expect(result.received).toBe('garbage');
  });
});

describe('runHook — integration through injected I/O', () => {
  function makeIo(fileContent: string) {
    const stderrChunks: string[] = [];
    let exitCode: number | null = null;
    return {
      stderrChunks,
      getExit: () => exitCode,
      io: {
        readFile: async (path: string): Promise<string> => {
          if (path !== '.git/COMMIT_EDITMSG') {
            throw new Error(`unexpected path: ${path}`);
          }
          return fileContent;
        },
        writeStderr: (chunk: string): void => {
          stderrChunks.push(chunk);
        },
        exit: (code: number): void => {
          exitCode = code;
        },
      },
    };
  }

  it('exits zero and writes nothing to stderr for a valid header', async () => {
    const { io, stderrChunks, getExit } = makeIo('feat(core): add event bus');
    await runHook(['node', 'commit-msg.js', '.git/COMMIT_EDITMSG'], io);
    expect(getExit()).toBe(0);
    expect(stderrChunks.join('')).toBe('');
  });

  it('writes a JSON-RPC error with code -32013 and exits non-zero for an invalid header', async () => {
    const { io, stderrChunks, getExit } = makeIo('garbage header');
    await runHook(['node', 'commit-msg.js', '.git/COMMIT_EDITMSG'], io);

    expect(getExit()).not.toBe(0);

    const body = stderrChunks.join('');
    const jsonStart = body.indexOf('{');
    expect(jsonStart, 'stderr must contain a JSON object').toBeGreaterThanOrEqual(0);
    const parsed = JSON.parse(body.slice(jsonStart));

    expect(parsed.jsonrpc).toBe('2.0');
    expect(parsed.error.code).toBe(-32013);
    expect(parsed.error.message).toBe('CONVENTIONAL_COMMITS_FORMAT_VIOLATION');
    expect(parsed.error.data.expected_format).toBe(EXPECTED_FORMAT);
    expect(parsed.error.data.allowed_types).toEqual(ALLOWED_TYPES);
    expect(parsed.error.data.received).toBe('garbage header');
  });

  it('exits non-zero when the commit-msg file path argument is missing', async () => {
    const { io, stderrChunks, getExit } = makeIo('feat(core): ok');
    await runHook(['node', 'commit-msg.js'], io);
    expect(getExit()).not.toBe(0);
    expect(stderrChunks.join('')).toContain('commit-msg');
  });
});
