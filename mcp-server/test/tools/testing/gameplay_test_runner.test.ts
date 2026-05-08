/**
 * Tests for the `Gameplay_Test_Runner` module.
 *
 * Gameplay_Test_Runner is the MCP-server-side component that drives an
 * end-to-end gameplay scenario by spawning Godot headless with the
 * runtime bridge flag (`--mcp-bridge`), pointing it at a test scene via
 * `--scene=<path>`, and serializing the optional ordered `steps[]` list
 * as a single JSON argv element (`--mcp-bridge-steps=<json>`). The
 * spawned process is expected to print a single line of JSON matching
 * the TestReport schema on stdout; if it does not, the runner synthesizes
 * a failed TestReport so the self-healing loop always receives a
 * well-formed result.
 *
 * The `tests.run_gameplay` MCP tool is a thin shim over this runner.
 */

import { describe, expect, it } from 'vitest';

import { ToolInputError } from '../../../src/tools/testing/errors.js';
import { runGameplayScenario } from '../../../src/tools/testing/gameplay_test_runner.js';
import type { SpawnGodot } from '../../../src/tools/testing/spawn_godot.js';
import type { TestReport } from '../../../src/tools/testing/test_report.js';

const sampleReport: TestReport = {
  run_id: 'gp-runner-1',
  timestamp: '2025-01-04T00:00:00Z',
  total: 1,
  passed: 1,
  failed: 0,
  tests: [
    {
      name: 'scenario completes',
      status: 'passed',
      duration_ms: 7,
      assertions: [],
      failure_message: '',
      stack_trace: '',
    },
  ],
  suggested_action: '',
};

interface Call {
  args: readonly string[];
}

function fakeSpawn(
  stdout: string,
  opts: { stderr?: string; exitCode?: number; calls?: Call[] } = {},
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

describe('runGameplayScenario — argv shape', () => {
  it('spawns godot with --headless, --mcp-bridge and --scene=<path>', async () => {
    const calls: Call[] = [];
    const spawn = fakeSpawn(JSON.stringify(sampleReport), { calls });
    await runGameplayScenario(
      { scene_path: 'res://tests/integration/scenes/crafting_test_scene.tscn' },
      { spawn },
    );
    expect(calls[0].args).toEqual([
      '--headless',
      '--mcp-bridge',
      '--scene=res://tests/integration/scenes/crafting_test_scene.tscn',
    ]);
  });

  it('appends --mcp-bridge-steps=<json> when steps is non-empty', async () => {
    const calls: Call[] = [];
    const spawn = fakeSpawn(JSON.stringify(sampleReport), { calls });
    await runGameplayScenario(
      {
        scene_path: 'res://scene.tscn',
        steps: ['add_item', 'execute_recipe', 'assert_count'],
      },
      { spawn },
    );
    const stepsArg = calls[0].args.find((a) =>
      a.startsWith('--mcp-bridge-steps='),
    );
    expect(stepsArg).toBeDefined();
    const json = stepsArg!.slice('--mcp-bridge-steps='.length);
    expect(JSON.parse(json)).toEqual([
      'add_item',
      'execute_recipe',
      'assert_count',
    ]);
  });

  it('omits the steps argv when steps is empty or missing', async () => {
    const callsWithout: Call[] = [];
    const callsEmpty: Call[] = [];
    const spawn1 = fakeSpawn(JSON.stringify(sampleReport), {
      calls: callsWithout,
    });
    const spawn2 = fakeSpawn(JSON.stringify(sampleReport), {
      calls: callsEmpty,
    });
    await runGameplayScenario(
      { scene_path: 'res://a.tscn' },
      { spawn: spawn1 },
    );
    await runGameplayScenario(
      { scene_path: 'res://a.tscn', steps: [] },
      { spawn: spawn2 },
    );
    expect(
      callsWithout[0].args.some((a) => a.startsWith('--mcp-bridge-steps=')),
    ).toBe(false);
    expect(
      callsEmpty[0].args.some((a) => a.startsWith('--mcp-bridge-steps=')),
    ).toBe(false);
  });
});

describe('runGameplayScenario — input validation', () => {
  it('rejects an empty scene_path with ToolInputError', async () => {
    const spawn = fakeSpawn('');
    await expect(
      runGameplayScenario({ scene_path: '' }, { spawn }),
    ).rejects.toThrow(ToolInputError);
  });

  it('rejects a step that is not a non-empty string', async () => {
    const spawn = fakeSpawn('');
    await expect(
      runGameplayScenario(
        // Intentionally wrong value to simulate a bad JSON-RPC payload.
        {
          scene_path: 'res://x.tscn',
          steps: ['ok', '' as string],
        },
        { spawn },
      ),
    ).rejects.toThrow(ToolInputError);
  });
});

describe('runGameplayScenario — report extraction', () => {
  it('returns the TestReport parsed from stdout on the happy path', async () => {
    const spawn = fakeSpawn(JSON.stringify(sampleReport));
    const report = await runGameplayScenario(
      { scene_path: 'res://ok.tscn' },
      { spawn },
    );
    expect(report).toEqual(sampleReport);
  });

  it('returns a synthetic failed report when stdout has no JSON and exit is non-zero', async () => {
    const spawn = fakeSpawn('rubbish', {
      stderr: 'scene crash',
      exitCode: 9,
    });
    const report = await runGameplayScenario(
      { scene_path: 'res://x.tscn' },
      { spawn },
    );
    expect(report.failed).toBe(1);
    expect(report.tests).toHaveLength(1);
    expect(report.tests[0].failure_message).toContain('scene crash');
    expect(report.suggested_action).toBe('rerun_test');
  });

  it('always produces a TestReport-shaped envelope (run_id, timestamp, tests[], failure_message) even on failure', async () => {
    const spawn = fakeSpawn('', { stderr: '', exitCode: 1 });
    const report = await runGameplayScenario(
      { scene_path: 'res://x.tscn' },
      { spawn },
    );
    expect(typeof report.run_id).toBe('string');
    expect(typeof report.timestamp).toBe('string');
    expect(Array.isArray(report.tests)).toBe(true);
    expect(report.tests.length).toBeGreaterThanOrEqual(1);
    expect(typeof report.tests[0].failure_message).toBe('string');
  });
});

describe('runGameplayScenario — TestReport envelope enrichment', () => {
  it('assigns a non-empty run_id on the happy path (preserving one from stdout)', async () => {
    const spawn = fakeSpawn(JSON.stringify(sampleReport));
    const report = await runGameplayScenario(
      { scene_path: 'res://ok.tscn' },
      { spawn },
    );
    expect(report.run_id).toBe('gp-runner-1');
    expect(report.run_id.length).toBeGreaterThan(0);
  });

  it('assigns a non-empty run_id on the failure path', async () => {
    const spawn = fakeSpawn('', { stderr: 'boom', exitCode: 3 });
    const report = await runGameplayScenario(
      { scene_path: 'res://x.tscn' },
      { spawn },
    );
    expect(typeof report.run_id).toBe('string');
    expect(report.run_id.length).toBeGreaterThan(0);
  });

  it('produces distinct run_ids across two independent failure runs', async () => {
    const spawn1 = fakeSpawn('', { stderr: 'err1', exitCode: 1 });
    const spawn2 = fakeSpawn('', { stderr: 'err2', exitCode: 1 });
    const r1 = await runGameplayScenario(
      { scene_path: 'res://x.tscn' },
      { spawn: spawn1 },
    );
    const r2 = await runGameplayScenario(
      { scene_path: 'res://x.tscn' },
      { spawn: spawn2 },
    );
    expect(r1.run_id).not.toBe(r2.run_id);
  });

  it('stamps a parseable ISO 8601 timestamp on the synthetic failure report', async () => {
    const spawn = fakeSpawn('', { stderr: 'boom', exitCode: 2 });
    const report = await runGameplayScenario(
      { scene_path: 'res://x.tscn' },
      { spawn },
    );
    expect(Number.isNaN(Date.parse(report.timestamp))).toBe(false);
  });

  it('includes both stderr text and the exit code in failure_message on failure', async () => {
    const spawn = fakeSpawn('', {
      stderr: 'scene blew up in frame 42',
      exitCode: 137,
    });
    const report = await runGameplayScenario(
      { scene_path: 'res://crash.tscn' },
      { spawn },
    );
    expect(report.tests[0].failure_message).toContain(
      'scene blew up in frame 42',
    );
    expect(report.tests[0].failure_message).toContain('137');
  });

  it('names the synthetic failure test after the scene path', async () => {
    const spawn = fakeSpawn('', { stderr: '', exitCode: 1 });
    const report = await runGameplayScenario(
      { scene_path: 'res://named.tscn' },
      { spawn },
    );
    expect(report.tests[0].name).toContain('res://named.tscn');
  });
});
