/**
 * Feature: forgekit, Property 31: Atomicity of project.godot writes — existing keys preserved
 *
 * Property-based test for {@link updateSettings}.
 *
 * This property guards the bug fix vs tomyud1/godot-mcp, which overwrote
 * sibling `input/<action>/events` entries whenever a single action was
 * edited. The atomic writer under test must:
 *
 *   P1 — write every key named in `patch` with the exact string supplied.
 *   P2 — preserve every pre-existing key that is not named in `patch`,
 *        byte-exact, including sibling `input/<action_b>/events` when
 *        the patch only targets `input/<action_a>/events`.
 *   P3 — never leave a temp file behind on success; `project.godot` is
 *        replaced by a single rename so the directory listing contains
 *        exactly one entry afterwards.
 *
 * The generator emits a random `[input]` population of `<action>/events`
 * keys (varied count, varied arbitrary values) plus a random subset
 * selected as the patch. We regenerate values for patched keys so the
 * overwrite vs preserve contract is exercised on both sides.
 */

import fc from 'fast-check';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { updateSettings } from '../src/tools/project/update_settings.js';
import {
  flattenSettings,
  parseGodotIni,
} from '../src/tools/project/godot_ini.js';

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

const NUM_RUNS = 100 as const;

/**
 * Header written verbatim before the generated `[input]` section. Kept
 * small on purpose: the property only cares about the `[input]` keys.
 */
const PREAMBLE = `; Engine configuration file.

config_version=5

[application]

config/name="PropTest"

`;

// --------------------------------------------------------------------------
// Arbitraries
// --------------------------------------------------------------------------

/**
 * Action identifier. Restricted to `[a-z_][a-z0-9_]{0,15}` so the
 * generated key always matches the Godot INI key grammar
 * (`[A-Za-z_][\w/.-]*`) without needing escaping.
 */
const actionNameArb = fc
  .stringMatching(/^[a-z_][a-z0-9_]{0,15}$/)
  .filter((s) => s.length > 0);

/**
 * Raw value for a `<action>/events` key. The atomic writer treats values
 * as opaque strings (the caller is responsible for producing valid Godot
 * literals), so we fuzz with arbitrary single-line strings and assert
 * round-trip equality on the raw bytes. We forbid newlines and `=`
 * collisions with the INI grammar by construction.
 */
const rawValueArb = fc
  .string({ minLength: 1, maxLength: 32 })
  .map((s) => s.replace(/[\r\n]/g, ''))
  .filter((s) => s.length > 0)
  .map((s) => `[${s}]`);

/**
 * Before state: a non-empty map of distinct action names to raw values.
 * `fc.uniqueArray` keeps the action names distinct so we can safely
 * stuff them into the same `[input]` section without duplicates.
 */
const beforeArb = fc
  .uniqueArray(fc.tuple(actionNameArb, rawValueArb), {
    minLength: 1,
    maxLength: 8,
    selector: ([name]) => name,
  })
  .map((pairs) => {
    const out: Record<string, string> = {};
    for (const [name, value] of pairs) {
      out[`input/${name}/events`] = value;
    }
    return out;
  });

/**
 * Given a before map, draw:
 *   • `patchOfExisting`: the subset of existing keys to overwrite
 *     (with freshly generated values), and
 *   • `patchOfNew`: a set of brand-new action keys (not in `before`) to
 *     append.
 *
 * Both subsets are always allowed to be empty — fast-check then retries
 * a different split. We keep at least one key in play across the two
 * pools to make the property meaningful (otherwise the tool would
 * reject the empty patch).
 */
function patchArbFor(
  before: Record<string, string>,
): fc.Arbitrary<{
  patch: Record<string, string>;
  beforeKeys: readonly string[];
  patchKeys: readonly string[];
}> {
  const beforeKeys = Object.keys(before);
  const existingNames = beforeKeys.map((k) => k.split('/')[1]);

  const overwriteSubsetArb = fc.subarray(beforeKeys, {
    minLength: 0,
    maxLength: beforeKeys.length,
  });

  const newActionArb = actionNameArb.filter(
    (n) => !existingNames.includes(n),
  );
  const newPairArb = fc.tuple(newActionArb, rawValueArb);
  const newSetArb = fc.uniqueArray(newPairArb, {
    minLength: 0,
    maxLength: 4,
    selector: ([name]) => name,
  });

  return fc
    .tuple(overwriteSubsetArb, newSetArb)
    .chain(([overwrite, newEntries]) => {
      // At least one change of some kind; otherwise the tool rejects the
      // empty patch and the property has nothing to say.
      if (overwrite.length === 0 && newEntries.length === 0) {
        // Force at least one overwrite by picking the first existing key
        // with a freshly generated value.
        return fc
          .record({
            firstValue: rawValueArb,
          })
          .map(({ firstValue }) => {
            const first = beforeKeys[0];
            const patch: Record<string, string> = { [first]: firstValue };
            return {
              patch,
              beforeKeys,
              patchKeys: [first],
            };
          });
      }

      return fc
        .record({
          overwriteValues: fc.array(rawValueArb, {
            minLength: overwrite.length,
            maxLength: overwrite.length,
          }),
        })
        .map(({ overwriteValues }) => {
          const patch: Record<string, string> = {};
          overwrite.forEach((key, i) => {
            patch[key] = overwriteValues[i];
          });
          for (const [name, value] of newEntries) {
            patch[`input/${name}/events`] = value;
          }
          return {
            patch,
            beforeKeys,
            patchKeys: Object.keys(patch),
          };
        });
    });
}

const scenarioArb = beforeArb.chain((before) =>
  patchArbFor(before).map((p) => ({ before, ...p })),
);

// --------------------------------------------------------------------------
// INI fixture builder
// --------------------------------------------------------------------------

/**
 * Render a `project.godot` containing the fixed preamble plus a single
 * `[input]` section populated from `before`. Key order follows
 * `Object.keys(before)`, which matches generator insertion order.
 */
function renderProjectGodot(before: Record<string, string>): string {
  const lines: string[] = [PREAMBLE + '[input]', ''];
  for (const [key, value] of Object.entries(before)) {
    const local = key.slice('input/'.length);
    lines.push(`${local}=${value}`);
  }
  lines.push('');
  return lines.join('\n');
}

// --------------------------------------------------------------------------
// Workspace lifecycle
// --------------------------------------------------------------------------

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'forgekit-atomic-prop-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function withCase<T>(
  before: Record<string, string>,
  body: (projectRoot: string) => Promise<T>,
): Promise<T> {
  const projectRoot = await mkdtemp(join(workspace, 'case-'));
  try {
    await writeFile(
      join(projectRoot, 'project.godot'),
      renderProjectGodot(before),
    );
    return await body(projectRoot);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

async function readFlatSettings(
  projectRoot: string,
): Promise<Record<string, string>> {
  const source = await readFile(join(projectRoot, 'project.godot'), 'utf8');
  return flattenSettings(parseGodotIni(source));
}

// --------------------------------------------------------------------------
// Properties
// --------------------------------------------------------------------------

describe('Property 31: Atomicity of project.godot writes — existing keys preserved', () => {
  it('P1: every key in patch is written with the patch value verbatim', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ before, patch }) => {
        await withCase(before, async (projectRoot) => {
          await updateSettings({ projectRoot, patch });
          const after = await readFlatSettings(projectRoot);
          for (const [key, value] of Object.entries(patch)) {
            expect(after[key]).toBe(value);
          }
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('P2: every pre-existing key outside patch survives byte-exact', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ before, patch }) => {
        await withCase(before, async (projectRoot) => {
          await updateSettings({ projectRoot, patch });
          const after = await readFlatSettings(projectRoot);
          for (const key of Object.keys(before)) {
            if (key in patch) continue;
            expect(after[key]).toBe(before[key]);
          }
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('P3: no temp file is left behind; project.godot is the only entry after the write', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ before, patch }) => {
        await withCase(before, async (projectRoot) => {
          await updateSettings({ projectRoot, patch });
          const entries = await readdir(projectRoot);
          expect(entries).toEqual(['project.godot']);
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
