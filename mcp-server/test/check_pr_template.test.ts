/**
 * Unit tests for the pull-request template validator used by the CI job
 * `check-pr-template`. The validator reads the PR body (markdown) and
 * asserts that the four required sections are present, non-empty, and —
 * for "Test Report" and "Gameplay Scenarios" — contain a fenced JSON
 * block that parses as valid JSON.
 *
 * Tests exercise both the pure `validatePrTemplate` function and the
 * `runCli` driver through a dependency-injected I/O harness so no
 * subprocesses are spawned and the real filesystem is never touched.
 */

import { describe, expect, it } from 'vitest';

import {
  ERROR_CODE_PR_TEMPLATE_INCOMPLETE,
  ERROR_MESSAGE_PR_TEMPLATE_INCOMPLETE,
  JSON_SECTIONS,
  REQUIRED_SECTIONS,
  runCli,
  validatePrTemplate,
} from '../scripts/ci/check-pr-template.js';

const VALID_BODY = `## Summary

Describe the change.

## Test Report

\`\`\`json
{"run_id":"r1","total":1,"passed":1,"failed":0,"tests":[]}
\`\`\`

## Gameplay Scenarios

\`\`\`json
{"run_id":"r2","scenarios":[]}
\`\`\`

## Affected MCP Tools

- \`scene.open\`

## Breaking Changes

- none
`;

describe('constants', () => {
  it('exposes the four required sections in canonical order', () => {
    expect(REQUIRED_SECTIONS).toEqual([
      'Test Report',
      'Gameplay Scenarios',
      'Affected MCP Tools',
      'Breaking Changes',
    ]);
  });

  it('marks Test Report and Gameplay Scenarios as JSON-bearing', () => {
    expect(JSON_SECTIONS).toEqual(['Test Report', 'Gameplay Scenarios']);
  });
});

describe('validatePrTemplate — accepted bodies', () => {
  it('accepts a body with every section populated', () => {
    const result = validatePrTemplate(VALID_BODY);
    expect(result.ok).toBe(true);
    expect(result.missingSections).toEqual([]);
  });

  it('ignores surrounding prose and extra sections', () => {
    const body = `# Title\n\nIntro paragraph.\n\n${VALID_BODY}\n\n## Extra Section\n\nfree text`;
    expect(validatePrTemplate(body).ok).toBe(true);
  });

  it('accepts leading and trailing whitespace around headings', () => {
    const body = VALID_BODY.replace('## Breaking Changes', '##   Breaking Changes   ');
    expect(validatePrTemplate(body).ok).toBe(true);
  });
});

describe('validatePrTemplate — rejected bodies', () => {
  it('flags every section as missing when the body is empty', () => {
    const result = validatePrTemplate('');
    expect(result.ok).toBe(false);
    expect(result.missingSections).toEqual([
      'Test Report',
      'Gameplay Scenarios',
      'Affected MCP Tools',
      'Breaking Changes',
    ]);
  });

  it('flags a missing heading', () => {
    const body = VALID_BODY.replace(/## Breaking Changes[\s\S]*/, '');
    const result = validatePrTemplate(body);
    expect(result.ok).toBe(false);
    expect(result.missingSections).toEqual(['Breaking Changes']);
  });

  it('flags a section whose body contains only HTML comments and whitespace', () => {
    const body = VALID_BODY.replace(
      '- `scene.open`',
      '<!-- list affected tools here -->',
    );
    const result = validatePrTemplate(body);
    expect(result.ok).toBe(false);
    expect(result.missingSections).toEqual(['Affected MCP Tools']);
  });

  it('flags a JSON section whose fenced block does not parse', () => {
    const body = VALID_BODY.replace(
      '{"run_id":"r1","total":1,"passed":1,"failed":0,"tests":[]}',
      '{ this is not json',
    );
    const result = validatePrTemplate(body);
    expect(result.ok).toBe(false);
    expect(result.missingSections).toEqual(['Test Report']);
  });

  it('flags a JSON section that contains prose only (no fenced json block)', () => {
    const body = VALID_BODY.replace(
      /## Gameplay Scenarios\n\n```json\n[\s\S]*?\n```/,
      '## Gameplay Scenarios\n\nwe forgot to paste the report',
    );
    const result = validatePrTemplate(body);
    expect(result.ok).toBe(false);
    expect(result.missingSections).toEqual(['Gameplay Scenarios']);
  });

  it('reports every offending section in one pass', () => {
    const body = `## Test Report\n\n<!-- empty -->\n\n## Gameplay Scenarios\n\n\`\`\`json\n{ broken\n\`\`\`\n\n## Affected MCP Tools\n\n- \`scene.open\`\n\n## Breaking Changes\n\n`;
    const result = validatePrTemplate(body);
    expect(result.ok).toBe(false);
    expect(result.missingSections).toEqual([
      'Test Report',
      'Gameplay Scenarios',
      'Breaking Changes',
    ]);
  });
});

describe('runCli — CLI driver', () => {
  it('exits 0 and writes nothing to stderr on a valid body', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    let exitCode: number | null = null;

    await runCli(['node', 'check-pr-template.js'], {
      readInput: async () => VALID_BODY,
      writeStdout: (c) => stdout.push(c),
      writeStderr: (c) => stderr.push(c),
      exit: (c) => {
        exitCode = c;
      },
    });

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
  });

  it('emits a JSON-RPC error payload with code -32014 and missing_sections on failure', async () => {
    const stderr: string[] = [];
    let exitCode: number | null = null;

    await runCli(['node', 'check-pr-template.js'], {
      readInput: async () => '',
      writeStdout: () => {},
      writeStderr: (c) => stderr.push(c),
      exit: (c) => {
        exitCode = c;
      },
    });

    expect(exitCode).not.toBe(0);

    const body = stderr.join('');
    const jsonStart = body.indexOf('{');
    expect(jsonStart).toBeGreaterThanOrEqual(0);

    const parsed = JSON.parse(body.slice(jsonStart));
    expect(parsed).toMatchObject({
      jsonrpc: '2.0',
      error: {
        code: ERROR_CODE_PR_TEMPLATE_INCOMPLETE,
        message: ERROR_MESSAGE_PR_TEMPLATE_INCOMPLETE,
        data: { missing_sections: REQUIRED_SECTIONS },
      },
    });
  });

  it('accepts --file <path> and reads the body from disk', async () => {
    const stderr: string[] = [];
    let exitCode: number | null = null;
    const files = new Map<string, string>([['/tmp/pr.md', VALID_BODY]]);

    await runCli(['node', 'check-pr-template.js', '--file', '/tmp/pr.md'], {
      readInput: async () => {
        throw new Error('stdin must not be consulted when --file is passed');
      },
      readFile: async (p: string) => {
        const content = files.get(p);
        if (content === undefined) throw new Error(`missing: ${p}`);
        return content;
      },
      writeStdout: () => {},
      writeStderr: (c) => stderr.push(c),
      exit: (c) => {
        exitCode = c;
      },
    });

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
  });
});
