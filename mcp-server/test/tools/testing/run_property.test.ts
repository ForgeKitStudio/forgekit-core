/**
 * Tests for the `tests.run_property` MCP tool.
 *
 * Property runs reuse the GUT command-line driver but differ from unit
 * runs in two places:
 *   1. Iteration count and seed are passed as environment variables
 *      (`FORGEKIT_PBT_ITERATIONS`, `FORGEKIT_PBT_SEED`) rather than CLI
 *      flags, so the GDScript generators can read them without parsing.
 *   2. A failing run exposes a `counterexample` on the returned report.
 */

import { describe, expect, it } from 'vitest';

import { ToolInputError } from '../../../src/tools/testing/errors.js';
import { runProperty } from '../../../src/tools/testing/run_property.js';
import type { SpawnGodot } from '../../../src/tools/testing/spawn_godot.js';
import type { TestReport } from '../../../src/tools/testing/test_report.js';

const passingReport: TestReport = {
  run_id: 'prop-1',
  timestamp: '2025-01-03T00:00:00Z',
  total: 1,
  passed: 1,
  failed: 0,
  tests: [
    {
      name: 'property holds',
      status: 'passed',
      duration_ms: 5,
      assertions: [],
      failure_message: '',
      stack_trace: '',
    },
  ],
  suggested_action: '',
};

const failingReport: TestReport = {
  run_id: 'prop-2',
  timestamp: '2025-01-03T00:00:00Z',
  total: 1,
  passed: 0,
  failed: 1,
  tests: [
    {
      name: 'property breaks',
      status: 'failed',
      duration_ms: 7,
      assertions: [],
      failure_message: 'counterexample found',
      stack_trace: '',
    },
  ],
  suggested_action: 'rerun_test',
};

interface Call {
  args: readonly string[];
  env: Record<string, string>;
}

function fakeSpawn(
  stdout: string,
  opts: { stderr?: string; exitCode?: number; calls?: Call[] } = {},
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

describe('runProperty — happy path', () => {
  it('defaults iterations to 100 and propagates it via FORGEKIT_PBT_ITERATIONS', async () => {
    const calls: Call[] = [];
    const spawn = fakeSpawn(JSON.stringify(passingReport), { calls });
    await runProperty({ path: 'tests/property' }, { spawn });
    expect(calls).toHaveLength(1);
    expect(calls[0].env.FORGEKIT_PBT_ITERATIONS).toBe('100');
    // seed is optional — omit when not provided.
    expect(calls[0].env).not.toHaveProperty('FORGEKIT_PBT_SEED');
  });

  it('passes the explicit iterations and seed through to env', async () => {
    const calls: Call[] = [];
    const spawn = fakeSpawn(JSON.stringify(passingReport), { calls });
    await runProperty(
      { path: 'tests/property', iterations: 250, seed: 42 },
      { spawn },
    );
    expect(calls[0].env.FORGEKIT_PBT_ITERATIONS).toBe('250');
    expect(calls[0].env.FORGEKIT_PBT_SEED).toBe('42');
  });

  it('forwards the GUT argv (-gdir, -gexit)', async () => {
    const calls: Call[] = [];
    const spawn = fakeSpawn(JSON.stringify(passingReport), { calls });
    await runProperty({ path: 'tests/property' }, { spawn });
    expect(calls[0].args).toEqual([
      '--headless',
      '--script',
      'addons/gut/gut_cmdln.gd',
      '-gdir=tests/property',
      '-gexit',
    ]);
  });
});

describe('runProperty — counterexample on failure', () => {
  it('includes counterexample from the report body when the run fails', async () => {
    const reportWithCx = {
      ...failingReport,
      counterexample: { seed: 7, value: { x: -1 } },
    };
    const spawn = fakeSpawn(JSON.stringify(reportWithCx), { exitCode: 1 });
    const result = await runProperty(
      { path: 'tests/property' },
      { spawn },
    );
    expect(result.failed).toBe(1);
    expect(result.counterexample).toEqual({ seed: 7, value: { x: -1 } });
  });

  it('omits counterexample on a passing run', async () => {
    const spawn = fakeSpawn(JSON.stringify(passingReport));
    const result = await runProperty(
      { path: 'tests/property' },
      { spawn },
    );
    expect(result.counterexample).toBeUndefined();
  });
});

describe('runProperty — input validation', () => {
  it('rejects an empty path', async () => {
    const spawn = fakeSpawn('');
    await expect(runProperty({ path: '' }, { spawn })).rejects.toThrow(
      ToolInputError,
    );
  });

  it('rejects a negative iterations', async () => {
    const spawn = fakeSpawn('');
    await expect(
      runProperty({ path: 'p', iterations: -1 }, { spawn }),
    ).rejects.toThrow(ToolInputError);
  });

  it('rejects a zero iterations', async () => {
    const spawn = fakeSpawn('');
    await expect(
      runProperty({ path: 'p', iterations: 0 }, { spawn }),
    ).rejects.toThrow(ToolInputError);
  });

  it('rejects a non-integer iterations', async () => {
    const spawn = fakeSpawn('');
    await expect(
      runProperty({ path: 'p', iterations: 1.5 }, { spawn }),
    ).rejects.toThrow(ToolInputError);
  });

  it('rejects a non-integer seed', async () => {
    const spawn = fakeSpawn('');
    await expect(
      runProperty({ path: 'p', seed: 0.5 }, { spawn }),
    ).rejects.toThrow(ToolInputError);
  });
});

describe('runProperty — spawn failure and malformed output', () => {
  it('returns a synthetic failed report when stdout has no JSON line', async () => {
    const spawn = fakeSpawn('nothing', { stderr: 'bad', exitCode: 1 });
    const result = await runProperty(
      { path: 'tests/property' },
      { spawn },
    );
    expect(result.failed).toBe(1);
    expect(result.tests[0].failure_message).toContain('bad');
    expect(result.counterexample).toBeUndefined();
  });
});
