/**
 * Feature: forgekit, Property 34: Tag core_min_version compatibility
 *
 * Validates: Requirements 46.2, 46.3, 46.5
 *
 * Property-based test linking three pieces of the tag / module-version
 * story into a single iff statement. For any simulated git history `T`
 * of SemVer `vX.Y.Z` tags for `ForgeKitStudio/forgekit-core` and any
 * pair `(installed_core_tag, manifest.core_min_version)`:
 *
 *   1. If `manifest.core_min_version` does not appear in `T`, the
 *      `forgekit_rpg` release pipeline MUST block publication with
 *      the JSON-RPC error code `-32011 MANIFEST_TAG_NOT_FOUND` and a
 *      payload carrying the offending tag verbatim in `data.tag`.
 *      (Requirements 46.2 + 46.5.)
 *
 *   2. If `manifest.core_min_version` exists in `T`, the pipeline
 *      forwards to `modules.check_compatibility(module_id,
 *      core_version?)`, which MUST return `compatible === true` iff
 *      `installed_core_tag` comes from `T` (the architectural
 *      invariant enforced by `resolveCoreVersionFromGit`) AND
 *      `installed ≥ required` in SemVer ordering. The tool MUST
 *      source the installed tag from the injected `resolveVersion`
 *      hook — proving 46.3, that the comparison uses the on-disk git
 *      tag rather than any in-memory value.
 *
 * The generator draws a non-empty tags list, picks the installed tag
 * from inside the list (matching the invariant that the resolver
 * always returns a real git tag), and draws the manifest tag from the
 * full SemVer cube so both branches of the joint property are
 * exercised. The pipeline step is simulated inline through
 * `simulatePipelineTagCheck` so the property test stays self-contained
 * in the forgekit-core workspace; the pipeline's shell implementation
 * lives in the `forgekit-rpg` repo at `tools/verify-manifest-tag.sh`
 * and is unit-tested there.
 */

import fc from 'fast-check';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkCompatibility } from '../src/tools/modules/check_compatibility.js';

// -----------------------------------------------------------------------------
// Shared constants
// -----------------------------------------------------------------------------

/** Pinned iteration count per the task specification. */
const NUM_RUNS = 100 as const;

/** Module id stamped into every generated `module.manifest.tres`. */
const MODULE_ID = 'forgekit_rpg' as const;

/** JSON-RPC error code for a manifest tag missing from git history. */
const MANIFEST_TAG_NOT_FOUND_CODE = -32011 as const;

/** JSON-RPC error message string for the same failure. */
const MANIFEST_TAG_NOT_FOUND_MESSAGE = 'MANIFEST_TAG_NOT_FOUND' as const;

// -----------------------------------------------------------------------------
// Arbitraries
// -----------------------------------------------------------------------------

type SemverTuple = readonly [major: number, minor: number, patch: number];

/**
 * `(MAJOR, MINOR, PATCH)` with each component in `[0, 9]`. The narrow
 * range keeps tags short and collides often enough that both the
 * tie-breaking path of the comparator and the membership path of the
 * tags list are exercised.
 */
const semverTupleArb: fc.Arbitrary<SemverTuple> = fc.tuple(
  fc.nat({ max: 9 }),
  fc.nat({ max: 9 }),
  fc.nat({ max: 9 }),
);

/** `vX.Y.Z` rendering used inside the simulated git history. */
function fmtTag(v: SemverTuple): string {
  return `v${v[0]}.${v[1]}.${v[2]}`;
}

/** `X.Y.Z` rendering used inside `check_compatibility` inputs. */
function fmtSemver(v: SemverTuple): string {
  return `${v[0]}.${v[1]}.${v[2]}`;
}

/** Lexicographic `>=` over the three components — independent oracle. */
function gte(a: SemverTuple, b: SemverTuple): boolean {
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return true;
}

/**
 * Non-empty unique list of SemVer tags modelling the simulated git
 * history of `ForgeKitStudio/forgekit-core`.
 */
const tagsListArb: fc.Arbitrary<readonly SemverTuple[]> = fc.uniqueArray(
  semverTupleArb,
  {
    minLength: 1,
    maxLength: 8,
    selector: (t) => fmtTag(t),
  },
);

/**
 * Bundle used by the joint property:
 *
 *   - `tags`:      simulated git history (non-empty)
 *   - `installed`: drawn from inside `tags` (resolver invariant)
 *   - `required`:  drawn from the full SemVer cube — may or may not
 *                  appear in `tags`, exercising both branches of the
 *                  pipeline gate.
 */
interface Case {
  readonly tags: readonly SemverTuple[];
  readonly installed: SemverTuple;
  readonly required: SemverTuple;
}

const caseArb: fc.Arbitrary<Case> = tagsListArb.chain((tags) =>
  fc.record({
    tags: fc.constant(tags),
    installed: fc.constantFrom(...tags),
    // Draw `required` with a 50/50 mix: half from inside `tags`
    // (exercises Branch A — the `check_compatibility` SemVer-ordering
    // path) and half from the full SemVer cube (exercises Branch B —
    // the `-32011 MANIFEST_TAG_NOT_FOUND` pipeline-gate path). Without
    // this mix the tags list is so small relative to the 10³ cube that
    // Branch A is almost never hit.
    required: fc.oneof(fc.constantFrom(...tags), semverTupleArb),
  }),
);

// -----------------------------------------------------------------------------
// Pipeline gate — inline simulation of `tools/verify-manifest-tag.sh`
// -----------------------------------------------------------------------------

interface PipelineTagError {
  readonly code: typeof MANIFEST_TAG_NOT_FOUND_CODE;
  readonly message: typeof MANIFEST_TAG_NOT_FOUND_MESSAGE;
  readonly data: { readonly tag: string };
}

type PipelineTagCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: PipelineTagError };

/**
 * Returns `{ok: true}` when the manifest tag exists in the simulated
 * git history; otherwise returns a JSON-RPC error payload identical
 * to the one produced by `formatManifestTagError` in the forgekit-rpg
 * repo (`tools/verify-manifest-tag.js`), so the property test
 * documents the exact error contract the release workflow relies on.
 */
function simulatePipelineTagCheck(
  manifestTag: string,
  tags: readonly string[],
): PipelineTagCheck {
  if (tags.includes(manifestTag)) {
    return { ok: true };
  }
  return {
    ok: false,
    error: {
      code: MANIFEST_TAG_NOT_FOUND_CODE,
      message: MANIFEST_TAG_NOT_FOUND_MESSAGE,
      data: { tag: manifestTag },
    },
  };
}

// -----------------------------------------------------------------------------
// Workspace helpers
// -----------------------------------------------------------------------------

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
  workspace = await mkdtemp(join(tmpdir(), 'forgekit-tag-core-min-prop-'));
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

// -----------------------------------------------------------------------------
// Property
// -----------------------------------------------------------------------------

describe('Property 34: Tag ↔ core_min_version compatibility', () => {
  it(
    'pipeline blocks with -32011 when manifest tag ∉ git history; otherwise check_compatibility returns compatible === (installed ≥ required) sourcing installed from the git resolver',
    async () => {
      await fc.assert(
        fc.asyncProperty(caseArb, async ({ tags, installed, required }) => {
          const tagStrings = tags.map(fmtTag);
          const requiredTag = fmtTag(required);
          const pipeline = simulatePipelineTagCheck(requiredTag, tagStrings);
          const requiredInTags = tagStrings.includes(requiredTag);

          // -----------------------------------------------------------
          // Branch B: manifest tag missing from the repo → the release
          // pipeline MUST block publication with the `-32011`
          // MANIFEST_TAG_NOT_FOUND error payload and never reach
          // `check_compatibility`. (Requirements 46.2, 46.5.)
          // -----------------------------------------------------------
          if (!requiredInTags) {
            expect(pipeline.ok).toBe(false);
            // Narrow the discriminated union for the type checker.
            if (pipeline.ok) return false;
            expect(pipeline.error.code).toBe(MANIFEST_TAG_NOT_FOUND_CODE);
            expect(pipeline.error.message).toBe(
              MANIFEST_TAG_NOT_FOUND_MESSAGE,
            );
            expect(pipeline.error.data.tag).toBe(requiredTag);
            return true;
          }

          // -----------------------------------------------------------
          // Branch A: manifest tag present → pipeline forwards to
          // `check_compatibility`, which MUST decide strictly by
          // SemVer ordering over the tag sourced from the injected
          // git resolver. (Requirement 46.3.)
          // -----------------------------------------------------------
          expect(pipeline.ok).toBe(true);
          const requiredStr = fmtSemver(required);
          const installedStr = fmtSemver(installed);
          return withCase(requiredStr, async (projectRoot) => {
            const resolveVersion = async (): Promise<string> => installedStr;
            const result = await checkCompatibility({
              projectRoot,
              moduleId: MODULE_ID,
              resolveVersion,
            });
            expect(result.compatible).toBe(gte(installed, required));
            expect(result.core_version).toBe(installedStr);
            expect(result.core_min_version).toBe(requiredStr);
            expect(result.module_id).toBe(MODULE_ID);
            return true;
          });
        }),
        { numRuns: NUM_RUNS },
      );
    },
  );
});
