/**
 * Tests for the `tests.run_suite` MCP tool.
 *
 * The tool selects a specific GUT test script (by its basename) via the
 * `-gtest=<suite_name>` flag. The suite name is passed verbatim as an
 * argv element — no shell interpolation — so a name containing spaces or
 * special characters is safe.
 */

import { describe, expect, it } from 'vitest';

import { ToolInputError } from '../../../src/tools/testing/errors.js';
import { runSuite } from '../../../src/tools/testing/run_suite.js';
import type { SpawnGodot } from '../../../src/tools/testing/spawn_godot.js';
import type { TestReport } from '../../../src/tools/testing/test_report.js';

const sampleReport: TestReport = {
  run_id: 'suite-1',
  timestamp: '2025-01-02T00:00:00Z',
  total: 1,
  passed: 1,
  failed: 0,
  tests: [
    {
      name: 'suite ok',
      status: 'passed',
      duration_ms: 1,
      assertions: [],
      failure_message: '',
      stack_trace: '',
    },
  ],
  suggested_action: '',
};

function fakeSpawn(
  stdout: string,
  opts: {
    stderr?: string;
    exitCode?: number;
    calls?: { args: readonly string[] }[];
  } = {},
): SpawnGodot {
  return async (args) => {
    opts.calls?.push({ args: [...args] });
    return {
      stdout,
      stderr: opts.stderr ?? '',
      exitCode: opts.exitCode ?? 0,
    };
  };
}

describe('runSuite — happy path', () => {
  it('passes -gtest=<suite_name> and -gexit verbatim', async () => {
    const calls: { args: readonly string[] }[] = [];
    const spawn = fakeSpawn(JSON.stringify(sampleReport), { calls });
    const report = await runSuite(
      { suite_name: 'test_inventory' },
      { spawn },
    );
    expect(report).toEqual(sampleReport);
    expect(calls[0].args).toEqual([
      '--headless',
      '--script',
      'addons/gut/gut_cmdln.gd',
      '-gtest=test_inventory',
      '-gexit',
    ]);
  });

  it('does not quote or alter suite_name', async () => {
    const calls: { args: readonly string[] }[] = [];
    const spawn = fakeSpawn(JSON.stringify(sampleReport), { calls });
    await runSuite(
      { suite_name: 'test with spaces' },
      { spawn },
    );
    expect(calls[0].args).toContain('-gtest=test with spaces');
  });
});

describe('runSuite — input validation', () => {
  it('rejects an empty suite_name with ToolInputError', async () => {
    const spawn = fakeSpawn('');
    await expect(runSuite({ suite_name: '' }, { spawn })).rejects.toThrow(
      ToolInputError,
    );
  });

  it('rejects a whitespace-only suite_name', async () => {
    const spawn = fakeSpawn('');
    await expect(
      runSuite({ suite_name: '   ' }, { spawn }),
    ).rejects.toThrow(ToolInputError);
  });
});

describe('runSuite — spawn failure and malformed output', () => {
  it('returns a synthetic failed report on non-zero exit with no JSON', async () => {
    const spawn = fakeSpawn('garbage output', {
      stderr: 'kaboom',
      exitCode: 3,
    });
    const report = await runSuite(
      { suite_name: 'test_anything' },
      { spawn },
    );
    expect(report.failed).toBe(1);
    expect(report.tests[0].failure_message).toContain('kaboom');
    expect(report.suggested_action).toBe('rerun_test');
  });
});
