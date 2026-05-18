/**
/**
 * Unit tests for the Context Commits enforcer used by the pre-commit Git
 * hook. Exercises the pure helpers plus the `runHook` driver through
 * dependency-injected `exec`, filesystem and env so we never touch real Git
 * or the real filesystem.
 */

import { describe, expect, it } from 'vitest';

import {
  anchorWasTouched,
  findRequiredAnchors,
  matchesGlob,
  runHook,
  type ContextMap,
  type HookIo,
} from '../scripts/git-hooks/pre-commit.js';

describe('matchesGlob', () => {
  it('matches a `**/*.gd` pattern against a file inside the directory', () => {
    expect(matchesGlob('addons/forgekit_core/event_bus/game_events.gd', 'addons/forgekit_core/**/*.gd')).toBe(true);
  });

  it('rejects a file outside the pattern directory', () => {
    expect(matchesGlob('addons/forgekit_rpg/combat/hitbox.gd', 'addons/forgekit_core/**/*.gd')).toBe(false);
  });

  it('matches an exact path when no wildcards are present', () => {
    expect(matchesGlob('CLAUDE.md', 'CLAUDE.md')).toBe(true);
    expect(matchesGlob('docs/CLAUDE.md', 'CLAUDE.md')).toBe(false);
  });

  it('matches a pattern with a single-segment `*`', () => {
    expect(matchesGlob('src/foo.ts', 'src/*.ts')).toBe(true);
    expect(matchesGlob('src/deep/foo.ts', 'src/*.ts')).toBe(false);
  });

  it('matches `**` at the end of the pattern', () => {
    expect(matchesGlob('a/b/c/d.gd', 'a/**')).toBe(true);
    expect(matchesGlob('a', 'a/**')).toBe(false);
  });
});

describe('findRequiredAnchors', () => {
  const contextMap: ContextMap = {
    version: 1,
    mappings: [
      {
        pattern: 'addons/forgekit_core/event_bus/**/*.gd',
        anchors: ['CLAUDE.md#event-bus', '.cursorrules#event-bus'],
      },
      {
        pattern: 'mcp-server/src/**/*.ts',
        anchors: ['CLAUDE.md#mcp-server'],
      },
      {
        pattern: 'addons/forgekit_rpg/**/*.gd',
        anchors: ['CLAUDE.md#forgekit-rpg', '.cursorrules#forgekit-rpg'],
      },
    ],
  };

  it('returns anchors for every staged file whose pattern matches', () => {
    const anchors = findRequiredAnchors(
      [
        'addons/forgekit_core/event_bus/game_events.gd',
        'mcp-server/src/index.ts',
      ],
      contextMap,
    );
    expect(anchors).toEqual([
      { code_file: 'addons/forgekit_core/event_bus/game_events.gd', required_anchor: 'CLAUDE.md#event-bus' },
      { code_file: 'addons/forgekit_core/event_bus/game_events.gd', required_anchor: '.cursorrules#event-bus' },
      { code_file: 'mcp-server/src/index.ts', required_anchor: 'CLAUDE.md#mcp-server' },
    ]);
  });

  it('returns an empty array when no staged file matches any mapping', () => {
    expect(findRequiredAnchors(['scenes/Main.tscn'], contextMap)).toEqual([]);
  });
});

describe('anchorWasTouched', () => {
  const fileText = [
    '# Title',           // line 1
    '',                  // line 2
    'preamble line 3',   // line 3
    'preamble line 4',   // line 4
    'preamble line 5',   // line 5
    'preamble line 6',   // line 6
    'preamble line 7',   // line 7
    'preamble line 8',   // line 8
    'preamble line 9',   // line 9
    '## event-bus',      // line 10
    'event-bus line 11', // line 11
    'event-bus line 12', // line 12
    'event-bus line 13', // line 13
    'event-bus line 14', // line 14
    '## resources',      // line 15
    'resources line 16', // line 16
    'resources line 17', // line 17
    'resources line 18', // line 18
  ].join('\n');

  const diffText = [
    'diff --git a/CLAUDE.md b/CLAUDE.md',
    '--- a/CLAUDE.md',
    '+++ b/CLAUDE.md',
    '@@ -10,3 +10,5 @@',
    ' ## event-bus',
    '+New sentence describing the event bus change.',
    '+',
    ' ## resources',
    ' Unrelated line.',
  ].join('\n');

  it('detects a hunk that touches lines below the matching heading', () => {
    expect(anchorWasTouched(diffText, 'event-bus', fileText)).toBe(true);
  });

  it('rejects when the hunk does not touch the requested heading section', () => {
    expect(anchorWasTouched(diffText, 'resources', fileText)).toBe(false);
  });

  it('rejects when the diff is empty', () => {
    expect(anchorWasTouched('', 'event-bus', fileText)).toBe(false);
  });

  it('detects a -U0 hunk inside the section even when the heading line is absent from the diff', () => {
    // Reproduces the bug from the Context Commits enforcer: with -U0, the
    // hunk only contains changed lines and not the heading line above. The
    // implementation must use the staged file content to determine which
    // section the changed line numbers fall in.
    const u0Diff = [
      'diff --git a/CLAUDE.md b/CLAUDE.md',
      '--- a/CLAUDE.md',
      '+++ b/CLAUDE.md',
      '@@ -17 +17 @@',
      '-resources line 17',
      '+resources line 17 updated',
    ].join('\n');
    expect(anchorWasTouched(u0Diff, 'resources', fileText)).toBe(true);
  });
});

/**
 * Build a mock I/O surface that captures `exec` calls, stderr output, exit
 * code, env vars and appended log files. Each `exec` call is matched against
 * a list of programmed responses so we can simulate git behaviour.
 */
function makeIo(opts: {
  stagedFiles: readonly string[];
  diffs: Record<string, string>; // key: staged file path, value: unified diff for that file
  stagedContents?: Record<string, string>; // key: staged file path, value: post-image content
  repoRoot?: string;
  contextMap: ContextMap;
  env?: Record<string, string | undefined>;
  now?: () => Date;
  author?: string;
}): {
  io: HookIo;
  stderrChunks: string[];
  getExit: () => number | null;
  getAppendedLogs: () => Array<{ path: string; content: string }>;
} {
  const repoRoot = opts.repoRoot ?? '/repo';
  const stderrChunks: string[] = [];
  let exitCode: number | null = null;
  const appendedLogs: Array<{ path: string; content: string }> = [];

  const io: HookIo = {
    exec: async (cmd: string, args: readonly string[]): Promise<string> => {
      if (cmd === 'git' && args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
        return `${repoRoot}\n`;
      }
      if (cmd === 'git' && args[0] === 'diff' && args.includes('--name-only')) {
        return opts.stagedFiles.join('\0');
      }
      if (cmd === 'git' && args[0] === 'diff') {
        // request for a per-file diff: `git diff --cached -U0 -- <file>`
        const fileIdx = args.indexOf('--');
        if (fileIdx >= 0 && args[fileIdx + 1] !== undefined) {
          const file = args[fileIdx + 1];
          return opts.diffs[file] ?? '';
        }
        return '';
      }
      if (cmd === 'git' && args[0] === 'show' && typeof args[1] === 'string' && args[1].startsWith(':')) {
        const file = args[1].slice(1);
        return opts.stagedContents?.[file] ?? '';
      }
      if (cmd === 'git' && args[0] === 'config' && args[1] === 'user.name') {
        return `${opts.author ?? 'test-author'}\n`;
      }
      throw new Error(`unexpected exec: ${cmd} ${args.join(' ')}`);
    },
    readFile: async (path: string): Promise<string> => {
      if (path === `${repoRoot}/.forgekit/context-map.json`) {
        return JSON.stringify(opts.contextMap);
      }
      throw new Error(`unexpected readFile: ${path}`);
    },
    writeStderr: (chunk: string) => {
      stderrChunks.push(chunk);
    },
    exit: (code: number) => {
      exitCode = code;
    },
    appendFile: async (path: string, chunk: string) => {
      appendedLogs.push({ path, content: chunk });
    },
    now: opts.now ?? (() => new Date('2025-01-02T03:04:05.000Z')),
    env: opts.env ?? {},
  };

  return {
    io,
    stderrChunks,
    getExit: () => exitCode,
    getAppendedLogs: () => appendedLogs,
  };
}

const CONTEXT_MAP: ContextMap = {
  version: 1,
  mappings: [
    {
      pattern: 'addons/forgekit_core/event_bus/**/*.gd',
      anchors: ['CLAUDE.md#event-bus'],
    },
  ],
};

describe('runHook — Context Commits enforcement', () => {
  it('exits non-zero with CONTEXT_FILE_STALE when the anchor section is not touched', async () => {
    const { io, stderrChunks, getExit } = makeIo({
      stagedFiles: ['addons/forgekit_core/event_bus/game_events.gd'],
      diffs: {
        'addons/forgekit_core/event_bus/game_events.gd': 'diff',
        'CLAUDE.md': [
          'diff --git a/CLAUDE.md b/CLAUDE.md',
          '--- a/CLAUDE.md',
          '+++ b/CLAUDE.md',
          '@@ -50,1 +50,2 @@',
          ' ## resources',
          '+Unrelated edit.',
        ].join('\n'),
      },
      contextMap: CONTEXT_MAP,
    });

    await runHook(io);

    expect(getExit()).not.toBe(0);
    const body = stderrChunks.join('');
    const jsonStart = body.indexOf('{');
    expect(jsonStart).toBeGreaterThanOrEqual(0);
    const parsed = JSON.parse(body.slice(jsonStart));
    expect(parsed.jsonrpc).toBe('2.0');
    expect(parsed.error.code).toBe(-32012);
    expect(parsed.error.message).toBe('CONTEXT_FILE_STALE');
    expect(parsed.error.data.stale_anchors).toEqual([
      {
        code_file: 'addons/forgekit_core/event_bus/game_events.gd',
        required_anchor: 'CLAUDE.md#event-bus',
      },
    ]);
  });

  it('exits zero silently when every required anchor section is touched', async () => {
    const { io, stderrChunks, getExit } = makeIo({
      stagedFiles: [
        'addons/forgekit_core/event_bus/game_events.gd',
        'CLAUDE.md',
      ],
      diffs: {
        'addons/forgekit_core/event_bus/game_events.gd': 'diff',
        'CLAUDE.md': [
          'diff --git a/CLAUDE.md b/CLAUDE.md',
          '--- a/CLAUDE.md',
          '+++ b/CLAUDE.md',
          '@@ -10,2 +10,3 @@',
          ' ## event-bus',
          '+Documented new behaviour.',
        ].join('\n'),
      },
      stagedContents: {
        'CLAUDE.md': [
          '# Title',
          '',
          'preamble line 3',
          'preamble line 4',
          'preamble line 5',
          'preamble line 6',
          'preamble line 7',
          'preamble line 8',
          'preamble line 9',
          '## event-bus',
          'Documented new behaviour.',
          'event-bus original line 12',
        ].join('\n'),
      },
      contextMap: CONTEXT_MAP,
    });

    await runHook(io);

    expect(getExit()).toBe(0);
    expect(stderrChunks.join('')).toBe('');
  });

  it('exits zero when -U0 hunks land inside the section without including the heading line', async () => {
    // With `git diff --cached -U0` the hunk for an edit deep inside
    // `## event-bus` does not contain the heading line. The
    // hook must consult the staged file content to determine which section
    // the hunk falls in instead of relying on heading lines inside the
    // diff itself.
    const { io, stderrChunks, getExit } = makeIo({
      stagedFiles: [
        'addons/forgekit_core/event_bus/game_events.gd',
        'CLAUDE.md',
      ],
      diffs: {
        'addons/forgekit_core/event_bus/game_events.gd': 'diff',
        'CLAUDE.md': [
          'diff --git a/CLAUDE.md b/CLAUDE.md',
          '--- a/CLAUDE.md',
          '+++ b/CLAUDE.md',
          '@@ -13 +13 @@',
          '-event-bus line 13',
          '+event-bus line 13 updated',
        ].join('\n'),
      },
      stagedContents: {
        'CLAUDE.md': [
          '# Title',           // 1
          '',                  // 2
          'preamble line 3',   // 3
          'preamble line 4',   // 4
          'preamble line 5',   // 5
          'preamble line 6',   // 6
          'preamble line 7',   // 7
          'preamble line 8',   // 8
          'preamble line 9',   // 9
          '## event-bus',      // 10
          'event-bus line 11', // 11
          'event-bus line 12', // 12
          'event-bus line 13 updated', // 13
          'event-bus line 14', // 14
          '## resources',      // 15
          'resources line 16', // 16
        ].join('\n'),
      },
      contextMap: CONTEXT_MAP,
    });

    await runHook(io);

    expect(getExit()).toBe(0);
    expect(stderrChunks.join('')).toBe('');
  });

  it('exits zero when no staged file matches any mapping', async () => {
    const { io, getExit } = makeIo({
      stagedFiles: ['scenes/Main.tscn'],
      diffs: {},
      contextMap: CONTEXT_MAP,
    });

    await runHook(io);

    expect(getExit()).toBe(0);
  });

  it('writes a JSON skip log and exits zero when FORGEKIT_SKIP=1 is set', async () => {
    const { io, getExit, getAppendedLogs } = makeIo({
      stagedFiles: ['addons/forgekit_core/event_bus/game_events.gd'],
      diffs: {
        'addons/forgekit_core/event_bus/game_events.gd': 'diff',
      },
      contextMap: CONTEXT_MAP,
      env: { FORGEKIT_SKIP: '1', FORGEKIT_SKIP_REASON: 'urgent hotfix' },
      author: 'alice',
    });

    await runHook(io);

    expect(getExit()).toBe(0);
    const logs = getAppendedLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].path).toBe('/repo/.git/hooks/context-commit-skips.log');
    const entry = JSON.parse(logs[0].content.trim());
    expect(entry.ts).toBe('2025-01-02T03:04:05.000Z');
    expect(entry.author).toBe('alice');
    expect(entry.files).toEqual(['addons/forgekit_core/event_bus/game_events.gd']);
    expect(entry.reason).toBe('urgent hotfix');
  });
});
