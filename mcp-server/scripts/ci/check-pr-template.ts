/**
 * CI validator for the pull-request template.
 *
 * Confirms that every PR body contains the four required sections ("Test
 * Report", "Gameplay Scenarios", "Affected MCP Tools", "Breaking Changes"),
 * that each section has non-empty content, and that the JSON-bearing
 * sections embed a fenced ```json block that parses. On failure the CLI
 * emits a JSON-RPC 2.0 error payload (code -32014,
 * `PR_TEMPLATE_INCOMPLETE`) on stderr and exits non-zero so the
 * `check-pr-template` GitHub Actions job fails the PR.
 *
 * Designed to be consumed in two shapes:
 *   - as a library (`validatePrTemplate`) from property tests / unit tests
 *   - as a CLI (`runCli`) wired to `process.argv` + stdin by the default
 *     entrypoint at the bottom of this module
 */

import { readFile as fsReadFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const REQUIRED_SECTIONS = [
  'Test Report',
  'Gameplay Scenarios',
  'Affected MCP Tools',
  'Breaking Changes',
] as const;

export const JSON_SECTIONS = ['Test Report', 'Gameplay Scenarios'] as const;

export const ERROR_CODE_PR_TEMPLATE_INCOMPLETE = -32014 as const;
export const ERROR_MESSAGE_PR_TEMPLATE_INCOMPLETE = 'PR_TEMPLATE_INCOMPLETE' as const;

export type RequiredSection = (typeof REQUIRED_SECTIONS)[number];

export interface ValidationResult {
  readonly ok: boolean;
  readonly missingSections: readonly RequiredSection[];
}

export interface CliIo {
  readInput: () => Promise<string>;
  readFile?: (path: string) => Promise<string>;
  writeStdout: (chunk: string) => void;
  writeStderr: (chunk: string) => void;
  exit: (code: number) => void;
}

/**
 * Extract the body of a level-2 heading (`## <title>`) from a markdown
 * document. Returns `null` when the heading is absent. Leading and
 * trailing whitespace inside the title is tolerated so human authors can
 * type `##   Breaking Changes  ` and still pass validation.
 */
function extractSectionBody(markdown: string, title: string): string | null {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headingPattern = new RegExp(
    String.raw`(^|\n)##\s+${escaped}\s*(\n|$)`,
    'i',
  );
  const match = headingPattern.exec(markdown);
  if (match === null) {
    return null;
  }
  const start = match.index + match[0].length;
  const afterwards = markdown.slice(start);
  const nextHeading = /\n##\s+\S/.exec(afterwards);
  return nextHeading === null
    ? afterwards
    : afterwards.slice(0, nextHeading.index);
}

/**
 * Remove HTML comments (`<!-- ... -->`) and collapse whitespace so we can
 * tell whether a section is "really" populated. A section that contains
 * only the placeholder instructions emitted by the template itself counts
 * as empty for the purposes of this validator.
 */
function isMeaningfullyEmpty(sectionBody: string): boolean {
  const withoutComments = sectionBody.replace(/<!--[\s\S]*?-->/g, '');
  return withoutComments.trim().length === 0;
}

/**
 * Pull the first fenced ```json block out of a section body. Returns the
 * raw JSON text (without fences) or `null` if no such block exists.
 */
function extractFencedJson(sectionBody: string): string | null {
  const match = /```json\s*\n([\s\S]*?)\n```/i.exec(sectionBody);
  return match === null ? null : match[1];
}

/**
 * Pure validator. Operates on the full markdown body of the PR and
 * returns the list of sections that fail the contract, preserving the
 * canonical order from {@link REQUIRED_SECTIONS} so CI output is
 * deterministic.
 */
export function validatePrTemplate(body: string): ValidationResult {
  const missing: RequiredSection[] = [];
  const jsonSectionSet: ReadonlySet<string> = new Set(JSON_SECTIONS);

  for (const section of REQUIRED_SECTIONS) {
    const sectionBody = extractSectionBody(body, section);
    if (sectionBody === null || isMeaningfullyEmpty(sectionBody)) {
      missing.push(section);
      continue;
    }

    if (jsonSectionSet.has(section)) {
      const json = extractFencedJson(sectionBody);
      if (json === null) {
        missing.push(section);
        continue;
      }
      try {
        JSON.parse(json);
      } catch {
        missing.push(section);
      }
    }
  }

  return { ok: missing.length === 0, missingSections: missing };
}

/**
 * Format the JSON-RPC 2.0 error envelope emitted on stderr when the
 * template is incomplete. Mirrors the shape used by the commit-msg hook
 * so downstream tooling can parse both payloads uniformly.
 */
function formatError(missing: readonly RequiredSection[]): string {
  const payload = {
    jsonrpc: '2.0' as const,
    error: {
      code: ERROR_CODE_PR_TEMPLATE_INCOMPLETE,
      message: ERROR_MESSAGE_PR_TEMPLATE_INCOMPLETE,
      data: { missing_sections: missing },
    },
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

/**
 * CLI entrypoint. Reads the PR body from `--file <path>` when supplied,
 * otherwise from stdin, and invokes {@link validatePrTemplate}.
 */
export async function runCli(argv: readonly string[], io: CliIo): Promise<void> {
  const fileFlagIndex = argv.indexOf('--file');
  let body: string;
  if (fileFlagIndex >= 0) {
    const filePath = argv[fileFlagIndex + 1];
    if (filePath === undefined) {
      io.writeStderr('check-pr-template: --file requires a path argument\n');
      io.exit(2);
      return;
    }
    const reader = io.readFile ?? ((p: string) => fsReadFile(p, 'utf-8'));
    body = await reader(filePath);
  } else {
    body = await io.readInput();
  }

  const result = validatePrTemplate(body);
  if (result.ok) {
    io.exit(0);
    return;
  }

  io.writeStderr(formatError(result.missingSections));
  io.exit(1);
}

/**
 * Read the full contents of the process stdin stream as a UTF-8 string.
 * Kept outside {@link runCli} so tests can inject a deterministic body
 * without touching the real stdin.
 */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
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
  runCli(process.argv, {
    readInput: readStdin,
    writeStdout: (chunk) => process.stdout.write(chunk),
    writeStderr: (chunk) => process.stderr.write(chunk),
    exit: (code) => process.exit(code),
  }).catch((err: unknown) => {
    process.stderr.write(`check-pr-template: ${String(err)}\n`);
    process.exit(1);
  });
}
