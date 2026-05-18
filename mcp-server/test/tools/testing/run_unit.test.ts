/**
 * Tests for the `tests.run_unit` MCP tool.
 *
 * The tool spawns Godot headless with GUT's command-line driver. A fake
 * spawn is injected so the tests never touch the filesystem or invoke
 * Godot. GUT's authoritative flag names (`-gdir`, `-gunit_test_name`,
 * `-gexit`) are asserted explicitly because the tool builds an argv array
 * without any shell, and a mistake here would silently change behavior.
 */

import { describe, expect, it } from 'vitest';

import { ToolInputError } from '../../../src/tools/testing/errors.js';
import { runUnit } from '../../../src/tools/testing/run_unit.js';
import type { SpawnGodot } from '../../../src/tools/testing/spawn_godot.js';
import type { TestReport } from '../../../src/tools/testing/test_report.js';

// ---------------------------------------------------------------------------
// Fake spawn factories
// ---------------------------------------------------------------------------

function captureArgs() {
  const calls: { args: readonly string[]; env: Record<string, string> }[] = [];
  return { calls };
}

function fakeSpawnReturning(
  stdout: string,
  opts: {
    stderr?: string;
    exitCode?: number;
    calls?: {
      args: readonly string[];
      env: Record<string, string>;
    }[];
  } = {},
): SpawnGodot {
  return async (args, options) => {
    opts.calls?.push({ args: [...args], env: { ...(options?.env ?? {}) } });
    return {
      stdout,
      stderr: opts.stderr ?? '',
      exitCode: opts.exitCode ?? 0,
    };
  };
}

const sampleReport: TestReport = {
  run_id: 'r1',
  timestamp: '2025-01-01T00:00:00Z',
  total: 1,
  passed: 1,
  failed: 0,
  tests: [
    {
      name: 'it works',
      status: 'passed',
      duration_ms: 2,
      assertions: [],
      failure_message: '',
      stack_trace: '',
    },
  ],
  suggested_action: '',
};

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('runUnit — happy path', () => {
  it('returns the TestReport printed on the last JSON line of stdout', async () => {
    const stdout = `[gut] booting...\n${JSON.stringify(sampleReport)}\n`;
    const spawn = fakeSpawnReturning(stdout);
    const report = await runUnit({ path: 'tests/unit' }, { spawn });
    expect(report).toEqual(sampleReport);
  });

  it('passes -gdir, -gpost_run_script, and -gexit with the authoritative flag names', async () => {
    const { calls } = captureArgs();
    const spawn = fakeSpawnReturning(JSON.stringify(sampleReport), { calls });
    await runUnit({ path: 'tests/unit' }, { spawn });
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual([
      '--headless',
      '--script',
      'addons/gut/gut_cmdln.gd',
      '-gdir=tests/unit',
      '-gpost_run_script=res://addons/forgekit_core/testing/gut_to_test_report_hook.gd',
      '-gexit',
    ]);
  });

  it('appends -gunit_test_name=<pattern> only when a pattern is provided', async () => {
    const { calls } = captureArgs();
    const spawn = fakeSpawnReturning(JSON.stringify(sampleReport), { calls });
    await runUnit(
      { path: 'tests/unit', pattern: 'test_it_passes' },
      { spawn },
    );
    expect(calls[0].args).toContain('-gunit_test_name=test_it_passes');
  });
});

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

describe('runUnit — input validation', () => {
  it('rejects an empty path with ToolInputError', async () => {
    const spawn = fakeSpawnReturning('');
    await expect(runUnit({ path: '' }, { spawn })).rejects.toThrow(
      ToolInputError,
    );
  });

  it('rejects a whitespace-only path', async () => {
    const spawn = fakeSpawnReturning('');
    await expect(runUnit({ path: '   ' }, { spawn })).rejects.toThrow(
      ToolInputError,
    );
  });

  it('rejects a whitespace-only pattern when pattern is provided', async () => {
    const spawn = fakeSpawnReturning('');
    await expect(
      runUnit({ path: 'tests/unit', pattern: ' ' }, { spawn }),
    ).rejects.toThrow(ToolInputError);
  });
});

// ---------------------------------------------------------------------------
// Spawn failure / malformed output
// ---------------------------------------------------------------------------

describe('runUnit — spawn failure and malformed output', () => {
  it('returns a synthetic failed TestReport when stdout has no JSON and exit is non-zero', async () => {
    const spawn = fakeSpawnReturning('no report here', {
      stderr: 'boom',
      exitCode: 1,
    });
    const report = await runUnit({ path: 'tests/unit' }, { spawn });
    expect(report.failed).toBe(1);
    expect(report.passed).toBe(0);
    expect(report.total).toBe(0);
    expect(report.tests).toHaveLength(1);
    expect(report.tests[0].status).toBe('failed');
    expect(report.tests[0].failure_message).toContain('boom');
    expect(report.suggested_action).toBe('rerun_test');
  });

  it('truncates very long stderr to keep the synthetic report compact', async () => {
    const longStderr = 'x'.repeat(10_000);
    const spawn = fakeSpawnReturning('', {
      stderr: longStderr,
      exitCode: 2,
    });
    const report = await runUnit({ path: 'tests/unit' }, { spawn });
    expect(report.tests[0].failure_message.length).toBeLessThanOrEqual(4096);
  });

  it('ignores a stdout line that is valid JSON but not a TestReport shape', async () => {
    const spawn = fakeSpawnReturning('{"not":"a report"}', { exitCode: 1 });
    const report = await runUnit({ path: 'tests/unit' }, { spawn });
    expect(report.failed).toBe(1);
    expect(report.tests[0].status).toBe('failed');
  });
});
