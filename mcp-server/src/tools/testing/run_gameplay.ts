/**
 * Implementation of the `tests.run_gameplay` MCP tool.
 *
 * Thin shim over `Gameplay_Test_Runner` (see `gameplay_test_runner.ts`).
 * The MCP tool contract keeps the historical `scene_path` + optional
 * `steps` parameter shape; the runner owns the argv construction, spawn
 * invocation and TestReport extraction.
 */

import {
  runGameplayScenario,
  type RunGameplayScenarioDeps,
} from './gameplay_test_runner.js';
import type { TestReport } from './test_report.js';

export interface RunGameplayParams {
  scene_path: string;
  steps?: readonly string[];
}

export type RunGameplayDeps = RunGameplayScenarioDeps;

export async function runGameplay(
  params: RunGameplayParams,
  deps: RunGameplayDeps = {},
): Promise<TestReport> {
  return runGameplayScenario(
    { scene_path: params.scene_path, steps: params.steps },
    deps,
  );
}
