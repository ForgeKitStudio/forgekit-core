#!/usr/bin/env node
/**
 * Conventional Commits validator used as a Git `commit-msg` hook.
 *
 * Contract with Git:
 *   Git invokes this script with a single positional argument — the path to a
 *   temporary file containing the commit message (`.git/COMMIT_EDITMSG`). A
 *   non-zero exit status aborts the commit. Output on stderr is shown to the
 *   user.
 *
 * Validation rules:
 *   - Header format: `<type>(<scope>)?!?: <subject>`
 *   - `type` ∈ ALLOWED_TYPES
 *   - Optional parenthesised `scope` that must not contain spaces or
 *     parentheses.
 *   - Optional `!` (breaking-change marker) immediately before the colon.
 *   - `subject` must be non-empty and must not end with a period.
 *   - Only the first non-empty line (the header) is validated. Body and
 *     footer lines are ignored.
 *
 * Bypasses (mirroring common Git practice):
 *   - Merge commits whose header starts with `Merge `.
 *   - `fixup! ` / `squash! ` auto-commits produced by `git commit --fixup` /
 *     `git commit --squash`.
 *
 * On rejection the script writes a single JSON-RPC error object (code
 * `-32013`, message `CONVENTIONAL_COMMITS_FORMAT_VIOLATION`) to stderr and
 * exits with status 1.
 */

import { readFile as nodeReadFile } from 'node:fs/promises';

/** Allowed Conventional Commit types. */
export const ALLOWED_TYPES = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
] as const;

/** Human-readable description of the expected header shape. */
export const EXPECTED_FORMAT = '<type>(<scope>)?: <subject>' as const;

/** JSON-RPC error code used when the header fails validation. */
export const ERROR_CODE_FORMAT_VIOLATION = -32013 as const;

/** JSON-RPC error message used when the header fails validation. */
export const ERROR_MESSAGE_FORMAT_VIOLATION =
  'CONVENTIONAL_COMMITS_FORMAT_VIOLATION' as const;

/**
 * Regex matching a valid Conventional Commits header:
 *   - Group 1 captures the type.
 *   - Group 2 captures the optional scope without its parentheses.
 *   - Group 3 captures the optional breaking-change `!` marker.
 *   - Group 4 captures the subject.
 *
 * The scope rule forbids whitespace and nested parentheses.
 */
const HEADER_REGEX =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(?:\(([^\s()]+)\))?(!)?:\s(.+)$/u;

/** Output of {@link validateCommitMessage}. */
export type ValidationResult =
  | { ok: true }
  | {
      ok: false;
      reason: string;
      expectedFormat: typeof EXPECTED_FORMAT;
      allowedTypes: readonly string[];
      received: string;
    };

/**
 * Extract the header (first non-empty line) of a commit message.
 */
function extractHeader(message: string): string {
  for (const line of message.split(/\r?\n/)) {
    if (line.trim().length > 0) {
      return line;
    }
  }
  return '';
}

/**
 * Decide whether a header belongs to an auto-generated commit class that
 * bypasses Conventional Commits validation.
 */
function isBypassHeader(header: string): boolean {
  return (
    header.startsWith('Merge ') ||
    header.startsWith('fixup! ') ||
    header.startsWith('squash! ')
  );
}

/**
 * Validate a commit message header against the Conventional Commits rules
 * documented in the file header.
 *
 * @param header - The first non-empty line of a commit message, or the full
 *                 message (the function re-extracts the header internally to
 *                 be resilient to callers that pass the raw file contents).
 */
export function validateCommitMessage(header: string): ValidationResult {
  const effective = extractHeader(header);

  if (isBypassHeader(effective)) {
    return { ok: true };
  }

  const match = effective.match(HEADER_REGEX);
  if (match === null) {
    return {
      ok: false,
      reason:
        'Header does not match the Conventional Commits format. ' +
        `Expected: ${EXPECTED_FORMAT}.`,
      expectedFormat: EXPECTED_FORMAT,
      allowedTypes: ALLOWED_TYPES,
      received: effective,
    };
  }

  const subject = match[4];
  if (subject.endsWith('.')) {
    return {
      ok: false,
      reason: 'Subject must not end with a period.',
      expectedFormat: EXPECTED_FORMAT,
      allowedTypes: ALLOWED_TYPES,
      received: effective,
    };
  }

  if (subject.trim().length === 0) {
    return {
      ok: false,
      reason: 'Subject must not be empty.',
      expectedFormat: EXPECTED_FORMAT,
      allowedTypes: ALLOWED_TYPES,
      received: effective,
    };
  }

  return { ok: true };
}

/** Minimal I/O surface that `runHook` needs. Injected in tests. */
export interface HookIo {
  readFile: (path: string) => Promise<string>;
  writeStderr: (chunk: string) => void;
  exit: (code: number) => void;
}

/**
 * Drive the `commit-msg` hook end-to-end:
 *   1. Read the commit message from `argv[2]`.
 *   2. Validate the header.
 *   3. On success, exit 0 silently.
 *   4. On failure, emit a JSON-RPC error object on stderr and exit 1.
 */
export async function runHook(
  argv: readonly string[],
  io: HookIo,
): Promise<void> {
  const messagePath = argv[2];
  if (messagePath === undefined) {
    io.writeStderr(
      '[@forgekitstudio/core-mcp] commit-msg hook: missing commit message file path argument.\n',
    );
    io.exit(1);
    return;
  }

  let raw: string;
  try {
    raw = await io.readFile(messagePath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    io.writeStderr(
      `[@forgekitstudio/core-mcp] commit-msg hook: failed to read "${messagePath}": ${message}\n`,
    );
    io.exit(1);
    return;
  }

  const result = validateCommitMessage(raw);
  if (result.ok) {
    io.exit(0);
    return;
  }

  const payload = {
    jsonrpc: '2.0',
    error: {
      code: ERROR_CODE_FORMAT_VIOLATION,
      message: ERROR_MESSAGE_FORMAT_VIOLATION,
      data: {
        expected_format: result.expectedFormat,
        allowed_types: result.allowedTypes,
        received: result.received,
        reason: result.reason,
      },
    },
  };

  io.writeStderr(
    '[@forgekitstudio/core-mcp] commit-msg rejected the commit. Details:\n',
  );
  io.writeStderr(`${JSON.stringify(payload)}\n`);
  io.exit(1);
}

/**
 * Decide whether this module is being executed directly by Node (as opposed
 * to being imported by a test). Mirrors the pattern in `src/index.ts`.
 */
function isInvokedDirectly(): boolean {
  return (
    typeof process !== 'undefined' &&
    Array.isArray(process.argv) &&
    process.argv[1] !== undefined &&
    import.meta.url === `file://${process.argv[1]}`
  );
}

if (isInvokedDirectly()) {
  const io: HookIo = {
    readFile: async (path: string) => nodeReadFile(path, 'utf8'),
    writeStderr: (chunk: string) => process.stderr.write(chunk),
    exit: (code: number) => process.exit(code),
  };
  runHook(process.argv, io).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[@forgekitstudio/core-mcp] commit-msg hook crashed: ${message}\n`,
    );
    process.exit(1);
  });
}
