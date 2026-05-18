/**
 * Feature: forgekit, Property 33: Context-file synchronization — pre-commit hook detects stale context
 *
 * Property-based test for the Context Commits enforcer used as a Git
 * pre-commit hook. Exercises the invariants:
 *
 *   1. Biconditional: `runHook` exits 0 iff an independent oracle agrees
 *      that every required (code_file, anchor) pair is touched in the same
 *      commit.
 *   2. Acceptance: scenarios that touch every required anchor section in
 *      CLAUDE.md / .cursorrules cause the hook to exit 0 silently.
 *   3. Rejection payload: scenarios where at least one anchor section is
 *      missing cause the hook to exit non-zero, emit a JSON-RPC error with
 *      code -32012 and message 'CONTEXT_FILE_STALE', and include the
 *      expected {code_file, required_anchor} pairs in data.stale_anchors.
 *   4. Skip semantics: with FORGEKIT_SKIP=1 the hook always exits 0,
 *      regardless of staleness, and appends exactly one JSON line
 *      {ts, author, files, reason} to .git/hooks/context-commit-skips.log.
 *
 * The independent oracle implements the glob matcher via a path-segment
 * walk so the property test genuinely compares two independent
 * specifications of the contract rather than re-running the implementation.
 */

import fc from 'fast-check';
import { describe, it } from 'vitest';

import {
  ERROR_CODE_CONTEXT_FILE_STALE,
  ERROR_MESSAGE_CONTEXT_FILE_STALE,
  runHook,
  type ContextMap,
  type HookIo,
  type StaleAnchor,
} from '../pre-commit.js';

/**
 * Pinned iteration count for every property. Matches the spec requirement
 * that each property runs at least 100 iterations in CI.
 */
const NUM_RUNS = 100 as const;

/**
 * Synthetic context map. Mirrors the structure of
 * `.forgekit/context-map.json` but is kept small so shrinking
 * counterexamples stay readable in CI logs.
 */
const CONTEXT_MAP: ContextMap = {
  version: 1,
  mappings: [
    {
      pattern: 'addons/forgekit_core/**/*.gd',
      anchors: ['CLAUDE.md#core', '.cursorrules#core'],
    },
    {
      pattern: 'mcp-server/src/**/*.ts',
      anchors: ['CLAUDE.md#mcp-server'],
    },
    {
      pattern: 'addons/forgekit_rpg/**/*.gd',
      anchors: ['CLAUDE.md#rpg', '.cursorrules#rpg'],
    },
  ],
};

/** Slugs the scenario generator may choose to touch in each context file. */
const SLUGS_IN_CLAUDE = ['core', 'mcp-server', 'rpg'] as const;
const SLUGS_IN_CURSOR = ['core', 'rpg'] as const;

// -------------------------------------------------------------------------
// Independent oracle
// -------------------------------------------------------------------------

/**
 * Path-segment walker that decides whether `filePath` matches a glob
 * pattern under the same grammar used by `.forgekit/context-map.json`:
 *   - `**` matches zero or more whole path segments,
 *   - `*`  matches any run of characters inside a single segment,
 *   - other characters are literal.
 *
 * The implementation deliberately uses recursion over segments, while the
 * production code under test compiles a single monolithic regex. This
 * difference is the mechanism that makes the biconditional property have
 * teeth rather than tautologically re-running the implementation.
 */
function matchesGlobOracle(filePath: string, pattern: string): boolean {
  const fileSegments = filePath.split('/');
  const patternSegments = pattern.split('/');
  return walkSegments(fileSegments, 0, patternSegments, 0);
}

function walkSegments(
  fs: readonly string[],
  fi: number,
  ps: readonly string[],
  pi: number,
): boolean {
  if (pi === ps.length) {
    return fi === fs.length;
  }
  const pat = ps[pi];
  if (pat === '**') {
    for (let skip = 0; fi + skip <= fs.length; skip++) {
      if (walkSegments(fs, fi + skip, ps, pi + 1)) {
        return true;
      }
    }
    return false;
  }
  if (fi >= fs.length) {
    return false;
  }
  if (!singleSegmentMatches(fs[fi], pat)) {
    return false;
  }
  return walkSegments(fs, fi + 1, ps, pi + 1);
}

function singleSegmentMatches(segment: string, pattern: string): boolean {
  let regex = '^';
  for (const ch of pattern) {
    if (ch === '*') {
      regex += '[^/]*';
    } else if ('\\^$.|?+(){}[]'.includes(ch)) {
      regex += `\\${ch}`;
    } else {
      regex += ch;
    }
  }
  regex += '$';
  return new RegExp(regex).test(segment);
}

function splitAnchorOracle(anchor: string): { file: string; slug: string } {
  const idx = anchor.indexOf('#');
  return idx < 0
    ? { file: anchor, slug: '' }
    : { file: anchor.slice(0, idx), slug: anchor.slice(idx + 1) };
}

interface Scenario {
  readonly codeFiles: readonly string[];
  readonly stagedClaude: boolean;
  readonly touchedInClaude: ReadonlySet<string>;
  readonly stagedCursor: boolean;
  readonly touchedInCursor: ReadonlySet<string>;
}

/**
 * Enumerate the expected stale anchors for a scenario. Iteration order
 * matches the implementation: each code file, each mapping in context-map
 * order, each anchor in mapping order. The returned list may contain
 * duplicates when `codeFiles` does.
 */
function oracleStale(scenario: Scenario): StaleAnchor[] {
  const out: StaleAnchor[] = [];
  for (const codeFile of scenario.codeFiles) {
    for (const mapping of CONTEXT_MAP.mappings) {
      if (!matchesGlobOracle(codeFile, mapping.pattern)) {
        continue;
      }
      for (const anchor of mapping.anchors) {
        if (!isAnchorTouched(anchor, scenario)) {
          out.push({ code_file: codeFile, required_anchor: anchor });
        }
      }
    }
  }
  return out;
}

function isAnchorTouched(anchor: string, scenario: Scenario): boolean {
  const { file, slug } = splitAnchorOracle(anchor);
  if (file === 'CLAUDE.md') {
    return scenario.stagedClaude && scenario.touchedInClaude.has(slug);
  }
  if (file === '.cursorrules') {
    return scenario.stagedCursor && scenario.touchedInCursor.has(slug);
  }
  return false;
}

// -------------------------------------------------------------------------
// Arbitraries
// -------------------------------------------------------------------------

const fileNameAlphabet = fc.constantFrom(
  ...'abcdefghijklmnopqrstuvwxyz0123456789_',
);

const shortName = fc.stringOf(fileNameAlphabet, { minLength: 1, maxLength: 8 });

/** Matches `addons/forgekit_core/**\/*.gd`. */
const coreGd = fc
  .tuple(shortName, shortName)
  .map(([dir, name]) => `addons/forgekit_core/${dir}/${name}.gd`);

/** Matches `mcp-server/src/**\/*.ts`. */
const mcpTs = shortName.map((name) => `mcp-server/src/${name}.ts`);

/** Matches `addons/forgekit_rpg/**\/*.gd`. */
const rpgGd = shortName.map((name) => `addons/forgekit_rpg/${name}.gd`);

const codeFileArb = fc.oneof(coreGd, mcpTs, rpgGd);

/** Small, shrinking-friendly subset arbitrary over a finite slug list. */
function subsetOfArb(
  slugs: readonly string[],
): fc.Arbitrary<ReadonlySet<string>> {
  if (slugs.length === 0) {
    return fc.constant(new Set<string>());
  }
  return fc
    .tuple(...slugs.map(() => fc.boolean()))
    .map((mask) => {
      const out = new Set<string>();
      for (let i = 0; i < slugs.length; i++) {
        if (mask[i]) {
          out.add(slugs[i]);
        }
      }
      return out;
    });
}

const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  codeFiles: fc.array(codeFileArb, { maxLength: 6 }),
  stagedClaude: fc.boolean(),
  touchedInClaude: subsetOfArb(SLUGS_IN_CLAUDE),
  stagedCursor: fc.boolean(),
  touchedInCursor: subsetOfArb(SLUGS_IN_CURSOR),
});

/**
 * Scenario where every required anchor is touched. Derived from
 * `scenarioArb` by forcing the staging flags and slug sets to cover every
 * anchor implied by the randomly-chosen code files.
 */
const fullyTouchedScenarioArb: fc.Arbitrary<Scenario> = scenarioArb.map(
  (scenario) => {
    const requiredAnchors = new Set<string>();
    for (const codeFile of scenario.codeFiles) {
      for (const mapping of CONTEXT_MAP.mappings) {
        if (matchesGlobOracle(codeFile, mapping.pattern)) {
          for (const anchor of mapping.anchors) {
            requiredAnchors.add(anchor);
          }
        }
      }
    }
    const touchedClaude = new Set(scenario.touchedInClaude);
    const touchedCursor = new Set(scenario.touchedInCursor);
    let stagedClaude = scenario.stagedClaude;
    let stagedCursor = scenario.stagedCursor;
    for (const anchor of requiredAnchors) {
      const { file, slug } = splitAnchorOracle(anchor);
      if (file === 'CLAUDE.md') {
        stagedClaude = true;
        touchedClaude.add(slug);
      } else if (file === '.cursorrules') {
        stagedCursor = true;
        touchedCursor.add(slug);
      }
    }
    return {
      codeFiles: scenario.codeFiles,
      stagedClaude,
      stagedCursor,
      touchedInClaude: touchedClaude,
      touchedInCursor: touchedCursor,
    };
  },
);

/**
 * Scenarios the oracle classifies as having at least one stale anchor.
 * With at least one code file the unfiltered acceptance rate is well above
 * 60%, so the filter rarely discards more than a few draws per property.
 */
const atLeastOneStaleScenarioArb: fc.Arbitrary<Scenario> = fc
  .record({
    codeFiles: fc.array(codeFileArb, { minLength: 1, maxLength: 6 }),
    stagedClaude: fc.boolean(),
    touchedInClaude: subsetOfArb(SLUGS_IN_CLAUDE),
    stagedCursor: fc.boolean(),
    touchedInCursor: subsetOfArb(SLUGS_IN_CURSOR),
  })
  .filter((scenario) => oracleStale(scenario).length > 0);

// -------------------------------------------------------------------------
// Fake Git + FS surface
// -------------------------------------------------------------------------

const REPO_ROOT = '/repo';

function buildAnchorDiff(file: string, touchedSlugs: ReadonlySet<string>): string {
  const lines = [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
  ];
  let start = 10;
  for (const slug of touchedSlugs) {
    lines.push(
      `@@ -${start},1 +${start},2 @@`,
      ` ## ${slug}`,
      `+Updated ${slug} context line.`,
    );
    start += 10;
  }
  return lines.join('\n');
}

/**
 * Build the post-image content of an anchor file so that each touched slug
 * has its heading line at the same line number used in the matching hunk
 * header inside {@link buildAnchorDiff}. The Context Commits enforcer
 * needs the staged file content to compute heading line ranges, so the
 * mock content must be aligned with the synthetic diff.
 */
function buildAnchorContent(touchedSlugs: ReadonlySet<string>): string {
  const lines: string[] = [];
  let start = 10;
  for (const slug of touchedSlugs) {
    while (lines.length < start - 1) {
      lines.push(`filler line ${lines.length + 1}`);
    }
    lines.push(`## ${slug}`);
    lines.push(`Updated ${slug} context line.`);
    start += 10;
  }
  return lines.join('\n');
}

interface MockHandles {
  io: HookIo;
  stderrChunks: string[];
  logs: Array<{ path: string; content: string }>;
  getExit: () => number | null;
  stagedFiles: readonly string[];
}

function makeIo(
  scenario: Scenario,
  options: { env?: Record<string, string | undefined>; author?: string } = {},
): MockHandles {
  const stagedFiles: string[] = [
    ...scenario.codeFiles,
    ...(scenario.stagedClaude ? ['CLAUDE.md'] : []),
    ...(scenario.stagedCursor ? ['.cursorrules'] : []),
  ];
  const diffs: Record<string, string> = {};
  const stagedContents: Record<string, string> = {};
  for (const codeFile of scenario.codeFiles) {
    diffs[codeFile] = `diff --git a/${codeFile} b/${codeFile}\n`;
  }
  if (scenario.stagedClaude) {
    diffs['CLAUDE.md'] = buildAnchorDiff('CLAUDE.md', scenario.touchedInClaude);
    stagedContents['CLAUDE.md'] = buildAnchorContent(scenario.touchedInClaude);
  }
  if (scenario.stagedCursor) {
    diffs['.cursorrules'] = buildAnchorDiff(
      '.cursorrules',
      scenario.touchedInCursor,
    );
    stagedContents['.cursorrules'] = buildAnchorContent(scenario.touchedInCursor);
  }

  const stderrChunks: string[] = [];
  let exitCode: number | null = null;
  const logs: Array<{ path: string; content: string }> = [];
  const author = options.author ?? 'property-author';

  const io: HookIo = {
    exec: async (cmd, args) => {
      if (cmd !== 'git') {
        throw new Error(`unexpected exec: ${cmd} ${args.join(' ')}`);
      }
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
        return `${REPO_ROOT}\n`;
      }
      if (args[0] === 'diff' && args.includes('--name-only')) {
        return stagedFiles.join('\0');
      }
      if (args[0] === 'diff') {
        const sep = args.indexOf('--');
        if (sep >= 0 && args[sep + 1] !== undefined) {
          return diffs[args[sep + 1]] ?? '';
        }
        return '';
      }
      if (args[0] === 'show' && typeof args[1] === 'string' && args[1].startsWith(':')) {
        return stagedContents[args[1].slice(1)] ?? '';
      }
      if (args[0] === 'config' && args[1] === 'user.name') {
        return `${author}\n`;
      }
      throw new Error(`unexpected exec: ${cmd} ${args.join(' ')}`);
    },
    readFile: async (path) => {
      if (path === `${REPO_ROOT}/.forgekit/context-map.json`) {
        return JSON.stringify(CONTEXT_MAP);
      }
      throw new Error(`unexpected readFile: ${path}`);
    },
    writeStderr: (chunk) => {
      stderrChunks.push(chunk);
    },
    exit: (code) => {
      exitCode = code;
    },
    appendFile: async (path, chunk) => {
      logs.push({ path, content: chunk });
    },
    now: () => new Date('2025-06-07T12:34:56.000Z'),
    env: options.env ?? {},
  };

  return {
    io,
    stderrChunks,
    logs,
    getExit: () => exitCode,
    stagedFiles,
  };
}

function parseJsonRpcError(stderr: string): {
  jsonrpc?: string;
  error?: {
    code?: number;
    message?: string;
    data?: { stale_anchors?: StaleAnchor[] };
  };
} | null {
  const start = stderr.indexOf('{');
  if (start < 0) {
    return null;
  }
  try {
    return JSON.parse(stderr.slice(start)) as {
      jsonrpc?: string;
      error?: {
        code?: number;
        message?: string;
        data?: { stale_anchors?: StaleAnchor[] };
      };
    };
  } catch {
    return null;
  }
}

function asUniqueSortedKeys(anchors: readonly StaleAnchor[]): string[] {
  const out = new Set<string>();
  for (const anchor of anchors) {
    out.add(`${anchor.code_file}|${anchor.required_anchor}`);
  }
  return [...out].sort();
}

// -------------------------------------------------------------------------
// Properties
// -------------------------------------------------------------------------

describe('Feature: forgekit, Property 33: Context-file synchronization — pre-commit hook detects stale context', () => {
  it('exits 0 iff the independent oracle sees no stale anchors', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        const { io, getExit } = makeIo(scenario);
        await runHook(io);
        const oracleAccepts = oracleStale(scenario).length === 0;
        return oracleAccepts === (getExit() === 0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('exits 0 silently when every required anchor section is touched', async () => {
    await fc.assert(
      fc.asyncProperty(fullyTouchedScenarioArb, async (scenario) => {
        const { io, getExit, stderrChunks } = makeIo(scenario);
        await runHook(io);
        return getExit() === 0 && stderrChunks.join('') === '';
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('emits JSON-RPC -32012 with the expected stale_anchors on rejection', async () => {
    await fc.assert(
      fc.asyncProperty(atLeastOneStaleScenarioArb, async (scenario) => {
        const { io, getExit, stderrChunks } = makeIo(scenario);
        await runHook(io);
        if (getExit() === 0) {
          return false;
        }
        const parsed = parseJsonRpcError(stderrChunks.join(''));
        if (parsed === null) {
          return false;
        }
        if (
          parsed.jsonrpc !== '2.0' ||
          parsed.error?.code !== ERROR_CODE_CONTEXT_FILE_STALE ||
          parsed.error?.message !== ERROR_MESSAGE_CONTEXT_FILE_STALE
        ) {
          return false;
        }
        const actualKeys = asUniqueSortedKeys(
          parsed.error.data?.stale_anchors ?? [],
        );
        const expectedKeys = asUniqueSortedKeys(oracleStale(scenario));
        if (actualKeys.length !== expectedKeys.length) {
          return false;
        }
        for (let i = 0; i < actualKeys.length; i++) {
          if (actualKeys[i] !== expectedKeys[i]) {
            return false;
          }
        }
        return true;
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('bypasses validation and logs a skip entry when FORGEKIT_SKIP=1', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        const { io, getExit, logs, stagedFiles } = makeIo(scenario, {
          env: { FORGEKIT_SKIP: '1', FORGEKIT_SKIP_REASON: 'test bypass' },
          author: 'property-author',
        });
        await runHook(io);
        if (getExit() !== 0) {
          return false;
        }
        if (logs.length !== 1) {
          return false;
        }
        if (
          logs[0].path !==
          `${REPO_ROOT}/.git/hooks/context-commit-skips.log`
        ) {
          return false;
        }
        let entry: {
          ts?: unknown;
          author?: unknown;
          files?: unknown;
          reason?: unknown;
        };
        try {
          entry = JSON.parse(logs[0].content.trim()) as {
            ts?: unknown;
            author?: unknown;
            files?: unknown;
            reason?: unknown;
          };
        } catch {
          return false;
        }
        return (
          typeof entry.ts === 'string' &&
          entry.author === 'property-author' &&
          Array.isArray(entry.files) &&
          (entry.files as string[]).length === stagedFiles.length &&
          entry.reason === 'test bypass'
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
