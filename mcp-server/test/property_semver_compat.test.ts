/**
 * Feature: forgekit, Property 26: modules.check_compatibility correctly compares SemVer
 *
 * Property-based test for {@link checkCompatibility}. For every pair
 * of `MAJOR.MINOR.PATCH` versions `(required, installed)`, the tool
 * MUST return `compatible === true` iff `installed >= required` in
 * SemVer ordering. When the pair is incompatible, the tool MUST emit
 * a `CORE_VERSION_MISMATCH` warning carrying the module id, required
 * version, and installed version — so callers can surface the
 * mismatch without re-reading the manifest.
 *
 * The generator draws each tuple component from a bounded natural
 * range so the two iterations (ordering property + warning property)
 * each exercise `numRuns` fresh pairs, regularly producing equal
 * components to stress the tie-breaking comparator.
 */

import fc from 'fast-check';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkCompatibility } from '../src/tools/modules/check_compatibility.js';

// --------------------------------------------------------------------------
// Shared constants
// --------------------------------------------------------------------------

/** Pinned iteration count applied to every property in this file. */
const NUM_RUNS = 100 as const;

/** Module id stamped into every generated `module.manifest.tres`. */
const MODULE_ID = 'forgekit_rpg' as const;

// --------------------------------------------------------------------------
// Arbitraries
// --------------------------------------------------------------------------

type SemverTuple = readonly [major: number, minor: number, patch: number];

/**
 * `(MAJOR, MINOR, PATCH)` with components in `[0, 99]`. The bound is
 * irrelevant for correctness but keeps the generated strings short
 * and produces collisions often enough that the comparator's
 * tie-breaking path is also exercised.
 */
const semverTupleArb: fc.Arbitrary<SemverTuple> = fc.tuple(
  fc.nat({ max: 99 }),
  fc.nat({ max: 99 }),
  fc.nat({ max: 99 }),
);

function fmt(v: SemverTuple): string {
  return `${v[0]}.${v[1]}.${v[2]}`;
}

/** Independent oracle: lexicographic `>=` over the three components. */
function gte(a: SemverTuple, b: SemverTuple): boolean {
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return true;
}

// --------------------------------------------------------------------------
// Workspace helpers
// --------------------------------------------------------------------------

function manifestFor(id: string, coreMin: string): string {
  return `[gd_resource type="Resource" script_class="ModuleManifest" load_steps=2 format=3]

[ext_resource type="Script" path="res://addons/forgekit_core/manifest/module_manifest.gd" id="1"]

[resource]
script = ExtResource("1")
id = &"${id}"
version = "0.1.0"
core_min_version = "${coreMin}"
depends_on = Array[StringName]([])
license_id = "${id}"
source_repo = "ForgeKitStudio/${id}"
`;
}

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'forgekit-semver-prop-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function withCase<T>(
  requiredVersion: string,
  body: (projectRoot: string) => Promise<T>,
): Promise<T> {
  const projectRoot = await mkdtemp(join(workspace, 'case-'));
  try {
    await mkdir(join(projectRoot, 'addons', MODULE_ID), { recursive: true });
    await writeFile(
      join(projectRoot, 'addons', MODULE_ID, 'module.manifest.tres'),
      manifestFor(MODULE_ID, requiredVersion),
    );
    return await body(projectRoot);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

// --------------------------------------------------------------------------
// Properties
// --------------------------------------------------------------------------

describe('Property 26: modules.check_compatibility correctly compares SemVer', () => {
  it('returns compatible === true iff installed >= required in SemVer order', async () => {
    await fc.assert(
      fc.asyncProperty(
        semverTupleArb,
        semverTupleArb,
        async (required, installed) => {
          const requiredStr = fmt(required);
          const installedStr = fmt(installed);
          return withCase(requiredStr, async (projectRoot) => {
            const result = await checkCompatibility({
              projectRoot,
              moduleId: MODULE_ID,
              coreVersion: installedStr,
            });
            expect(result.compatible).toBe(gte(installed, required));
            expect(result.core_version).toBe(installedStr);
            expect(result.core_min_version).toBe(requiredStr);
            expect(result.module_id).toBe(MODULE_ID);
            return true;
          });
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('logs CORE_VERSION_MISMATCH with module id, required, and installed when incompatible', async () => {
    await fc.assert(
      fc.asyncProperty(
        semverTupleArb,
        semverTupleArb,
        async (required, installed) => {
          const requiredStr = fmt(required);
          const installedStr = fmt(installed);
          return withCase(requiredStr, async (projectRoot) => {
            const messages: string[] = [];
            const logger = { warn: (m: string): void => void messages.push(m) };
            const result = await checkCompatibility({
              projectRoot,
              moduleId: MODULE_ID,
              coreVersion: installedStr,
              logger,
            });
            if (result.compatible) {
              expect(messages).toEqual([]);
            } else {
              expect(messages.length).toBe(1);
              const msg = messages[0];
              expect(msg).toContain('CORE_VERSION_MISMATCH');
              expect(msg).toContain(MODULE_ID);
              expect(msg).toContain(requiredStr);
              expect(msg).toContain(installedStr);
            }
            return true;
          });
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
