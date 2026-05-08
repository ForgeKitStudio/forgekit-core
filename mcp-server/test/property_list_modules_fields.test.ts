/**
 * Feature: forgekit, Property 27: project.list_modules returns the complete required field set
 *
 * Property-based test for {@link listModules}. For any set of
 * installed ForgeKit modules `M`, the tool MUST return a list of
 * length `|M|` in which every entry carries non-empty values for
 * `{id, version, license_id, core_min_version, source_repo}`. These
 * are the five fields downstream consumers (NOTICE.md generator,
 * repository topology verifier, license UI) rely on; any empty field
 * in the returned list would force callers to re-read the manifest or
 * silently drop a module, which is exactly what the list API is
 * supposed to prevent.
 *
 * The generator draws a random set of installed modules (size 0..5).
 * Each module is given independently-generated non-empty values for
 * the five required fields, then written to disk as a real
 * `module.manifest.tres` next to a fresh temporary `addons/` root.
 * The property then calls the production tool and checks each
 * returned entry against the source-of-truth map keyed by id. A size
 * of 0 is allowed (empty set of modules) and is expected to return
 * an empty list without violating any other invariant.
 */

import fc from 'fast-check';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { listModules } from '../src/tools/project/list_modules.js';

// --------------------------------------------------------------------------
// Shared constants
// --------------------------------------------------------------------------

/** Pinned iteration count applied to every property in this file. */
const NUM_RUNS = 100 as const;

/** Fields every returned entry must expose with a non-empty string value. */
const REQUIRED_FIELDS = [
  'id',
  'version',
  'license_id',
  'core_min_version',
  'source_repo',
] as const;

type RequiredField = (typeof REQUIRED_FIELDS)[number];

// --------------------------------------------------------------------------
// Arbitraries
// --------------------------------------------------------------------------

/**
 * Non-empty alphanumeric slug (underscore allowed). Kept short and
 * TRES-safe so generated values round-trip cleanly through the
 * line-oriented manifest parser without escaping concerns.
 */
const slugArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[a-z][a-z0-9_]{0,15}$/)
  .filter((s) => s.length > 0);

/** Non-empty SemVer-shaped string `MAJOR.MINOR.PATCH` with small components. */
const semverArb: fc.Arbitrary<string> = fc
  .tuple(fc.nat({ max: 9 }), fc.nat({ max: 9 }), fc.nat({ max: 9 }))
  .map(([a, b, c]) => `${a}.${b}.${c}`);

/** Non-empty `<org>/<repo>` identifier shaped like a GitHub repo path. */
const repoArb: fc.Arbitrary<string> = fc
  .tuple(slugArb, slugArb)
  .map(([org, repo]) => `${org}/${repo}`);

interface GeneratedModule {
  /** Directory under `addons/`, always `forgekit_<id>`. */
  dir: string;
  id: string;
  version: string;
  license_id: string;
  core_min_version: string;
  source_repo: string;
}

/**
 * One generated module whose directory name derives from its id.
 * Using the id as the directory suffix matches the production
 * convention and keeps the uniqueness constraint trivially satisfied
 * downstream (unique ids → unique directories).
 */
const moduleArb: fc.Arbitrary<GeneratedModule> = fc
  .record({
    idSuffix: slugArb,
    version: semverArb,
    license_id: slugArb,
    core_min_version: semverArb,
    source_repo: repoArb,
  })
  .map(({ idSuffix, version, license_id, core_min_version, source_repo }) => {
    const id = `forgekit_${idSuffix}`;
    return {
      dir: id,
      id,
      version,
      license_id,
      core_min_version,
      source_repo,
    };
  });

/**
 * A set `M` of installed modules (|M| in 0..5) with unique ids. An
 * empty set is explicitly allowed so the "return list of length |M|"
 * clause is exercised at both ends.
 */
const moduleSetArb: fc.Arbitrary<GeneratedModule[]> = fc
  .uniqueArray(moduleArb, {
    minLength: 0,
    maxLength: 5,
    selector: (m) => m.id,
  });

// --------------------------------------------------------------------------
// Workspace helpers
// --------------------------------------------------------------------------

function manifestFor(m: GeneratedModule): string {
  return `[gd_resource type="Resource" script_class="ModuleManifest" load_steps=2 format=3]

[ext_resource type="Script" path="res://addons/forgekit_core/manifest/module_manifest.gd" id="1"]

[resource]
script = ExtResource("1")
id = &"${m.id}"
version = "${m.version}"
core_min_version = "${m.core_min_version}"
depends_on = Array[StringName]([])
license_id = "${m.license_id}"
source_repo = "${m.source_repo}"
`;
}

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'forgekit-list-modules-prop-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function installModules(
  projectRoot: string,
  modules: readonly GeneratedModule[],
): Promise<void> {
  for (const m of modules) {
    const moduleDir = join(projectRoot, 'addons', m.dir);
    await mkdir(moduleDir, { recursive: true });
    await writeFile(join(moduleDir, 'module.manifest.tres'), manifestFor(m));
  }
}

async function withCase<T>(
  modules: readonly GeneratedModule[],
  body: (projectRoot: string) => Promise<T>,
): Promise<T> {
  const projectRoot = await mkdtemp(join(workspace, 'case-'));
  try {
    await installModules(projectRoot, modules);
    return await body(projectRoot);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

// --------------------------------------------------------------------------
// Property
// --------------------------------------------------------------------------

describe('Property 27: project.list_modules returns the complete required field set', () => {
  it('returns |M| entries, each carrying non-empty {id, version, license_id, core_min_version, source_repo}', async () => {
    await fc.assert(
      fc.asyncProperty(moduleSetArb, async (modules) => {
        return withCase(modules, async (projectRoot) => {
          const result = await listModules({ projectRoot });

          // Length equals |M|.
          expect(result.modules.length).toBe(modules.length);

          // Every returned entry exposes the five required fields as
          // non-empty strings and the values match the manifest we
          // wrote for that id.
          const expectedById = new Map(modules.map((m) => [m.id, m]));
          for (const entry of result.modules) {
            for (const field of REQUIRED_FIELDS) {
              const value = entry[field as RequiredField];
              expect(typeof value).toBe('string');
              expect(value.length).toBeGreaterThan(0);
            }
            const expected = expectedById.get(entry.id);
            expect(expected).toBeDefined();
            if (expected === undefined) return false;
            expect(entry.version).toBe(expected.version);
            expect(entry.license_id).toBe(expected.license_id);
            expect(entry.core_min_version).toBe(expected.core_min_version);
            expect(entry.source_repo).toBe(expected.source_repo);
          }

          return true;
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
