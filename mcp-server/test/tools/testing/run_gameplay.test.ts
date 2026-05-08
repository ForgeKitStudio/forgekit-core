/**
 * Tests for the `tests.run_gameplay` MCP tool.
 *
 * Gameplay runs spawn Godot with the runtime bridge flag (`--mcp-bridge`)
 * and target a specific scene file. An optional ordered list of step
 * identifiers is serialized as a single JSON argv element
 * (`--mcp-bridge-steps=<json>`); shell interpolation is never involved
 * because every parameter is a distinct argv element.
 */

import { describe, expect, it } from 'vitest';

import { ToolInputError } from '../../../src/tools/testing/errors.js';
import { runGameplay } from '../../../src/tools/testing/run_gameplay.js';
import type { SpawnGodot } from '../../../src/tools/testing/spawn_godot.js';
import type { TestReport } from '../../../src/tools/testing/test_report.js';

const sampleReport: TestReport = {
  run_id: 'gp-1',
  timestamp: '2025-01-04T00:00:00Z',
  total: 1,
  passed: 1,
  failed: 0,
  tests: [
    {
      name: 'scene completes',
      status: 'passed',
      duration_ms: 12,
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

describe('runGameplay — happy path', () => {
  it('spawns godot with --headless, --mcp-bridge and --scene=<path>', async () => {
    const calls: Call[] = [];
    const spawn = fakeSpawn(JSON.stringify(sampleReport), { calls });
    await runGameplay(
      { scene_path: 'res://tests/scenes/crafting.tscn' },
      { spawn },
    );
    expect(calls[0].args).toEqual([
      '--headless',
      '--mcp-bridge',
      '--scene=res://tests/scenes/crafting.tscn',
    ]);
  });

  it('appends --mcp-bridge-steps=<json> when steps is non-empty', async () => {
    const calls: Call[] = [];
    const spawn = fakeSpawn(JSON.stringify(sampleReport), { calls });
    await runGameplay(
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
    await runGameplay({ scene_path: 'res://a.tscn' }, { spawn: spawn1 });
    await runGameplay(
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

describe('runGameplay — input validation', () => {
  it('rejects an empty scene_path with ToolInputError', async () => {
    const spawn = fakeSpawn('');
    await expect(
      runGameplay({ scene_path: '' }, { spawn }),
    ).rejects.toThrow(ToolInputError);
  });

  it('rejects a step that is not a non-empty string', async () => {
    const spawn = fakeSpawn('');
    await expect(
      runGameplay(
        // Intentionally wrong type to simulate a bad JSON-RPC payload.
        {
          scene_path: 'res://x.tscn',
          steps: ['ok', '' as string],
        },
        { spawn },
      ),
    ).rejects.toThrow(ToolInputError);
  });
});

describe('runGameplay — spawn failure and malformed output', () => {
  it('returns a synthetic failed report when stdout has no JSON and exit is non-zero', async () => {
    const spawn = fakeSpawn('rubbish', { stderr: 'scene crash', exitCode: 9 });
    const report = await runGameplay(
      { scene_path: 'res://x.tscn' },
      { spawn },
    );
    expect(report.failed).toBe(1);
    expect(report.tests[0].failure_message).toContain('scene crash');
    expect(report.suggested_action).toBe('rerun_test');
  });
});
