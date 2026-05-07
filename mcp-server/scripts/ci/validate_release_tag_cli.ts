/**
 * Thin CLI wrapper around {@link validateReleaseTag}. Invoked from both
 * `release.yml` and `npm-publish.yml` as the `validate-tag` job:
 *
 *     node mcp-server/dist/scripts/ci/validate_release_tag_cli.js "${GITHUB_REF_NAME}"
 *
 * Behaviour:
 *   - Reads the tag from the first positional argument; when absent falls
 *     back to `process.env.GITHUB_REF_NAME`.
 *   - Reads the package.json at `--package-json <path>` (default
 *     `mcp-server/package.json` resolved against the current working
 *     directory).
 *   - Prints a human-readable summary on stdout, plus a JSON-RPC-style
 *     error envelope on stderr when validation fails.
 *   - When `GITHUB_OUTPUT` is set (standard in GitHub Actions), appends
 *     `tag_version=X.Y.Z` so downstream jobs can consume the value via
 *     `needs.validate-tag.outputs.tag_version`.
 *   - Exits 0 on success, non-zero on any failure.
 */

import { readFile as fsReadFile } from 'node:fs/promises';
import { appendFile as fsAppendFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  validateReleaseTag,
  type ValidateReleaseTagFailure,
} from './validate_release_tag.js';

export interface CliIo {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: () => string;
  readonly readFile: (path: string) => Promise<string>;
  readonly appendFile: (path: string, data: string) => Promise<void>;
  readonly writeStdout: (chunk: string) => void;
  readonly writeStderr: (chunk: string) => void;
  readonly exit: (code: number) => void;
}

interface ParsedArgs {
  readonly tag: string | undefined;
  readonly packageJsonPath: string;
}

function parseArgs(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  cwd: string,
): ParsedArgs {
  let tag: string | undefined;
  let packageJsonPath = resolvePath(cwd, 'mcp-server/package.json');

  // argv[0] is the node binary, argv[1] is the script path.
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--package-json') {
      const next = rest[i + 1];
      if (next === undefined) {
        throw new Error('--package-json requires a path argument');
      }
      packageJsonPath = resolvePath(cwd, next);
      i += 1;
      continue;
    }
    if (arg.startsWith('--package-json=')) {
      packageJsonPath = resolvePath(cwd, arg.slice('--package-json='.length));
      continue;
    }
    if (tag === undefined && !arg.startsWith('-')) {
      tag = arg;
      continue;
    }
  }

  if (tag === undefined) {
    tag = env.GITHUB_REF_NAME;
  }

  return { tag, packageJsonPath };
}

function formatFailure(failure: ValidateReleaseTagFailure): string {
  const payload = {
    jsonrpc: '2.0' as const,
    error: {
      code: failure.code,
      message: failure.message,
      data: {
        expected: failure.expected,
        actual: failure.actual,
      },
    },
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export async function runCli(io: CliIo): Promise<void> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(io.argv, io.env, io.cwd());
  } catch (err) {
    io.writeStderr(`validate_release_tag: ${(err as Error).message}\n`);
    io.exit(2);
    return;
  }

  const { tag, packageJsonPath } = parsed;
  if (tag === undefined || tag.length === 0) {
    io.writeStderr(
      'validate_release_tag: missing tag — pass it as a positional argument or set GITHUB_REF_NAME\n',
    );
    io.exit(2);
    return;
  }

  let packageJsonVersion: string;
  try {
    const raw = await io.readFile(packageJsonPath);
    const parsedJson = JSON.parse(raw) as { version?: unknown };
    if (typeof parsedJson.version !== 'string') {
      throw new Error(`"version" field is missing or not a string in ${packageJsonPath}`);
    }
    packageJsonVersion = parsedJson.version;
  } catch (err) {
    io.writeStderr(`validate_release_tag: ${(err as Error).message}\n`);
    io.exit(2);
    return;
  }

  const result = validateReleaseTag({ tag, packageJsonVersion });
  if (!result.ok) {
    io.writeStderr(formatFailure(result));
    io.exit(1);
    return;
  }

  io.writeStdout(
    `validate_release_tag: tag ${tag} matches package.json version ${result.version}\n`,
  );

  const githubOutput = io.env.GITHUB_OUTPUT;
  if (githubOutput !== undefined && githubOutput.length > 0) {
    try {
      await io.appendFile(githubOutput, `tag_version=${result.version}\n`);
    } catch (err) {
      io.writeStderr(
        `validate_release_tag: failed to append GITHUB_OUTPUT — ${(err as Error).message}\n`,
      );
      io.exit(2);
      return;
    }
  }

  io.exit(0);
}

const isDirectExecution = (() => {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return fileURLToPath(import.meta.url) === entry;
  } catch {
    return false;
  }
})();

if (isDirectExecution) {
  runCli({
    argv: process.argv,
    env: process.env,
    cwd: () => process.cwd(),
    readFile: (path) => fsReadFile(path, 'utf-8'),
    appendFile: (path, data) => fsAppendFile(path, data, 'utf-8'),
    writeStdout: (chunk) => process.stdout.write(chunk),
    writeStderr: (chunk) => process.stderr.write(chunk),
    exit: (code) => process.exit(code),
  }).catch((err: unknown) => {
    process.stderr.write(`validate_release_tag: ${String(err)}\n`);
    process.exit(1);
  });
}
