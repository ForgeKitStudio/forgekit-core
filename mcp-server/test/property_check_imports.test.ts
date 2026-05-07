/**
 * Feature: forgekit, Property 7: project.check_imports detects ForgeKit_Core / ForgeKit_RPG_Module boundary violations
 *
 * Property-based test for {@link checkImports}.
 *
 * Generates a random population of `.gd` files that either sit under
 * `addons/forgekit_core/` or under `addons/forgekit_rpg/<subsystem>/`,
 * each carrying a random set of `res://` import targets drawn from a
 * fixed pool. Each iteration materializes the files on disk, runs
 * {@link checkImports}, and compares the returned violations against an
 * independent oracle that re-derives the expected violations from the
 * generated description alone.
 *
 * Properties (each run {@link NUM_RUNS} times):
 *   P1 — soundness + completeness: the set of flagged files equals the
 *        set produced by the oracle.
 *   P2 — core boundary: every core file whose imports include a
 *        `forgekit_<non-core>/...` target is flagged; the rest are not.
 *   P3 — rpg subsystem boundary: every rpg file whose imports reach
 *        outside its own subsystem (and are not core nor the shared
 *        `public_api.gd`) is flagged; the rest are not.
 *   P4 — aggregation: each violation's `imports` array contains exactly
 *        the bad targets from that file, preserving first-seen order,
 *        with no good imports leaking in.
 */

import fc from 'fast-check';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkImports } from '../src/tools/project/check_imports.js';

// --------------------------------------------------------------------------
// Shared constants
// --------------------------------------------------------------------------

/** Pinned iteration count applied to every property in this file. */
const NUM_RUNS = 100 as const;

const SUBSYSTEMS = ['combat', 'crafting', 'inventory', 'stats'] as const;
type Subsystem = (typeof SUBSYSTEMS)[number];

const CORE_ROOT = 'res://addons/forgekit_core/';
const RPG_ROOT = 'res://addons/forgekit_rpg/';
const PUBLIC_API_IMPORT = 'res://addons/forgekit_rpg/public_api.gd';

/** Imports that are always safe for both core and rpg callers. */
const CORE_IMPORT_POOL = [
  'res://addons/forgekit_core/event_bus/game_events.gd',
  'res://addons/forgekit_core/resources/item_resource.gd',
  'res://addons/forgekit_core/manifest/module_loader.gd',
] as const;

/** Direct cross-subsystem rpg targets (bad for any subsystem that is not that subsystem). */
const RPG_SUBSYSTEM_IMPORT_POOL = [
  'res://addons/forgekit_rpg/combat/hitbox.gd',
  'res://addons/forgekit_rpg/combat/state_machine.gd',
  'res://addons/forgekit_rpg/crafting/manager.gd',
  'res://addons/forgekit_rpg/crafting/recipes.gd',
  'res://addons/forgekit_rpg/inventory/inventory.gd',
  'res://addons/forgekit_rpg/inventory/slot.gd',
  'res://addons/forgekit_rpg/stats/base.gd',
  'res://addons/forgekit_rpg/stats/modifier.gd',
] as const;

/** Imports into another forgekit_* module — never allowed from core or rpg. */
const OTHER_MODULE_IMPORT_POOL = [
  'res://addons/forgekit_survivors/bullets.gd',
  'res://addons/forgekit_tactics/grid.gd',
] as const;

/** Imports outside the forgekit_* namespace — always ignored by the analyzer. */
const NON_FORGEKIT_IMPORT_POOL = [
  'res://scenes/level.tscn',
  'res://assets/icon.svg',
] as const;

/** Union pool — any single file may draw from any of these. */
const ALL_IMPORT_POOL = [
  ...CORE_IMPORT_POOL,
  PUBLIC_API_IMPORT,
  ...RPG_SUBSYSTEM_IMPORT_POOL,
  ...OTHER_MODULE_IMPORT_POOL,
  ...NON_FORGEKIT_IMPORT_POOL,
] as const;

// --------------------------------------------------------------------------
// Generated description — shape handed to both the writer and the oracle
// --------------------------------------------------------------------------

interface GeneratedFile {
  readonly kind: 'core' | 'rpg';
  /** Populated for `kind === 'rpg'`, `null` for core. */
  readonly subsystem: Subsystem | null;
  /** Project-relative path with forward slashes. */
  readonly path: string;
  /** Unique `res://` targets to emit in the generated `.gd` file. */
  readonly imports: readonly string[];
}

interface Violation {
  readonly file: string;
  readonly imports: readonly string[];
}

// --------------------------------------------------------------------------
// Arbitraries
// --------------------------------------------------------------------------

const importsArb = fc.uniqueArray(fc.constantFrom(...ALL_IMPORT_POOL), {
  minLength: 0,
  maxLength: 5,
});

const rawCoreFileArb = importsArb.map((imports) => ({
  kind: 'core' as const,
  subsystem: null as Subsystem | null,
  imports,
}));

const rawRpgFileArb = fc
  .tuple(fc.constantFrom(...SUBSYSTEMS), importsArb)
  .map(([subsystem, imports]) => ({
    kind: 'rpg' as const,
    subsystem: subsystem as Subsystem | null,
    imports,
  }));

/**
 * Array of raw file descriptions; indices are later stamped into filenames
 * so every generated file has a unique path inside the workspace.
 */
const fileListArb = fc
  .array(fc.oneof(rawCoreFileArb, rawRpgFileArb), {
    minLength: 0,
    maxLength: 12,
  })
  .map((rawList): GeneratedFile[] =>
    rawList.map((raw, index) => {
      const filename = `file_${index}.gd`;
      if (raw.kind === 'core') {
        return {
          kind: 'core',
          subsystem: null,
          path: `addons/forgekit_core/${filename}`,
          imports: raw.imports,
        };
      }
      return {
        kind: 'rpg',
        subsystem: raw.subsystem,
        path: `addons/forgekit_rpg/${raw.subsystem}/${filename}`,
        imports: raw.imports,
      };
    }),
  );

// --------------------------------------------------------------------------
// Independent oracle — intentionally does not share code with check_imports
// --------------------------------------------------------------------------

/**
 * Re-derive expected violations from a generated file list. Mirrors the
 * boundary contract directly from the generator description without going
 * through disk or the implementation under test.
 */
function classifyFiles(files: readonly GeneratedFile[]): Violation[] {
  const out: Violation[] = [];
  for (const f of files) {
    const bad = collectBadImports(f);
    if (bad.length > 0) {
      out.push({ file: f.path, imports: bad });
    }
  }
  return out;
}

function collectBadImports(f: GeneratedFile): string[] {
  const bad: string[] = [];
  for (const target of f.imports) {
    if (!isForgekitTarget(target)) continue; // non-forgekit imports are ignored
    if (f.kind === 'core') {
      if (target.startsWith(CORE_ROOT)) continue; // self-reference is fine
      if (!bad.includes(target)) bad.push(target);
      continue;
    }
    // f.kind === 'rpg' — must have a subsystem by construction.
    if (target.startsWith(CORE_ROOT)) continue;
    if (target === PUBLIC_API_IMPORT) continue;
    if (
      f.subsystem !== null &&
      target.startsWith(`${RPG_ROOT}${f.subsystem}/`)
    ) {
      continue;
    }
    if (!bad.includes(target)) bad.push(target);
  }
  return bad;
}

function isForgekitTarget(target: string): boolean {
  return target.startsWith('res://addons/forgekit_');
}

// --------------------------------------------------------------------------
// Disk helpers
// --------------------------------------------------------------------------

function renderGdFile(imports: readonly string[]): string {
  const lines: string[] = ['extends Node'];
  imports.forEach((target, i) => {
    // JSON.stringify gives us a properly-quoted string literal.
    lines.push(`var _v_${i} = preload(${JSON.stringify(target)})`);
  });
  lines.push('');
  return lines.join('\n');
}

async function materialize(
  projectRoot: string,
  files: readonly GeneratedFile[],
): Promise<void> {
  for (const f of files) {
    const full = join(projectRoot, f.path);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, renderGdFile(f.imports));
  }
}

// --------------------------------------------------------------------------
// Workspace lifecycle — one base dir per test, one fresh case dir per iteration
// --------------------------------------------------------------------------

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'forgekit-check-imports-prop-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function withCase<T>(
  files: readonly GeneratedFile[],
  body: (projectRoot: string) => Promise<T>,
): Promise<T> {
  const projectRoot = await mkdtemp(join(workspace, 'case-'));
  try {
    await materialize(projectRoot, files);
    return await body(projectRoot);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

// --------------------------------------------------------------------------
// Properties
// --------------------------------------------------------------------------

describe('Property 7: project.check_imports detects ForgeKit_Core / ForgeKit_RPG_Module boundary violations', () => {
  it('P1: the set of flagged files matches the independent oracle', async () => {
    await fc.assert(
      fc.asyncProperty(fileListArb, async (files) => {
        return withCase(files, async (projectRoot) => {
          const { violations } = await checkImports({ projectRoot });
          const expected = classifyFiles(files);

          const actualPaths = new Set(violations.map((v) => v.file));
          const expectedPaths = new Set(expected.map((v) => v.file));

          expect(actualPaths).toEqual(expectedPaths);
          return true;
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('P2: every core file importing any forgekit_<non-core> target is flagged; all other core files are not', async () => {
    await fc.assert(
      fc.asyncProperty(fileListArb, async (files) => {
        return withCase(files, async (projectRoot) => {
          const { violations } = await checkImports({ projectRoot });
          const flagged = new Set(violations.map((v) => v.file));

          for (const f of files) {
            if (f.kind !== 'core') continue;
            const hasBad = f.imports.some(
              (t) => isForgekitTarget(t) && !t.startsWith(CORE_ROOT),
            );
            expect(flagged.has(f.path)).toBe(hasBad);
          }
          return true;
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('P3: every rpg file importing outside its subsystem (not core, not public_api) is flagged; all others are not', async () => {
    await fc.assert(
      fc.asyncProperty(fileListArb, async (files) => {
        return withCase(files, async (projectRoot) => {
          const { violations } = await checkImports({ projectRoot });
          const flagged = new Set(violations.map((v) => v.file));

          for (const f of files) {
            if (f.kind !== 'rpg' || f.subsystem === null) continue;
            const sameSubsystemPrefix = `${RPG_ROOT}${f.subsystem}/`;
            const hasBad = f.imports.some((t) => {
              if (!isForgekitTarget(t)) return false;
              if (t.startsWith(CORE_ROOT)) return false;
              if (t === PUBLIC_API_IMPORT) return false;
              if (t.startsWith(sameSubsystemPrefix)) return false;
              return true;
            });
            expect(flagged.has(f.path)).toBe(hasBad);
          }
          return true;
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('P4: each violation aggregates exactly the bad targets from that file, deduplicated and in first-seen order', async () => {
    await fc.assert(
      fc.asyncProperty(fileListArb, async (files) => {
        return withCase(files, async (projectRoot) => {
          const { violations } = await checkImports({ projectRoot });
          const byPath = new Map<string, GeneratedFile>();
          for (const f of files) byPath.set(f.path, f);

          for (const v of violations) {
            const source = byPath.get(v.file);
            expect(source).toBeDefined();
            const expectedBad = collectBadImports(source as GeneratedFile);
            expect(v.imports).toEqual(expectedBad);
          }
          return true;
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
