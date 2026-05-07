/**
 * Implementation of the `tests.run_gameplay` MCP tool.
 *
 * Spawns Godot with the runtime bridge (`--mcp-bridge`) targeting a scene
 * that drives a gameplay test. Optional `steps` are serialized as a single
 * JSON argv element (`--mcp-bridge-steps=<json>`), so the scene script can
 * read them via `OS.get_cmdline_args()` without further parsing. No shell
 * is ever involved, so scene paths and step names can contain any
 * character that is legal in a Godot resource path.
 */

import { ToolInputError } from './errors.js';
import {
  extractReportFromStdout,
  syntheticFailureReport,
} from './report_extractor.js';
import { defaultSpawnGodot, type SpawnGodot } from './spawn_godot.js';
import type { TestReport } from './test_report.js';

export interface RunGameplayParams {
  scene_path: string;
  steps?: readonly string[];
}

export interface RunGameplayDeps {
  spawn?: SpawnGodot;
}

function requireNonBlank(value: string | undefined, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ToolInputError(
      `"${field}" must be a non-empty string (got ${JSON.stringify(value)}).`,
    );
  }
  return value;
}

export async function runGameplay(
  params: RunGameplayParams,
  deps: RunGameplayDeps = {},
): Promise<TestReport> {
  const scenePath = requireNonBlank(params.scene_path, 'scene_path');

  const args: string[] = ['--headless', '--mcp-bridge', scenePath];

  if (params.steps !== undefined && params.steps.length > 0) {
    params.steps.forEach((step, i) => {
      if (typeof step !== 'string' || step.trim() === '') {
        throw new ToolInputError(
          `"steps[${i}]" must be a non-empty string (got ${JSON.stringify(step)}).`,
        );
      }
    });
    args.push(`--mcp-bridge-steps=${JSON.stringify(params.steps)}`);
  }

  const spawn = deps.spawn ?? defaultSpawnGodot;
  const { stdout, stderr, exitCode } = await spawn(args);

  const report = extractReportFromStdout(stdout);
  if (report !== null) {
    return report;
  }
  return syntheticFailureReport({ stderr, exitCode });
}
