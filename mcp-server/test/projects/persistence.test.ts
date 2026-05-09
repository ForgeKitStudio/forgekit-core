/**
 * Tests for the workspaces.json persistence layer.
 *
 * The persistence layer writes a snapshot of the ProjectRegistry to
 * `<homeDir>/.forgekit/workspaces.json` atomically via a sibling
 * `.tmp` file + rename. Reads return `null` when the file is missing
 * and return `null` + a logger warning when the contents are
 * malformed.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileSystemWorkspacesPersistence } from '../../src/projects/persistence.js';
import type { WorkspacesSnapshot } from '../../src/projects/persistence.js';

let homeDir: string;

beforeEach(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'forgekit-persist-'));
});

afterEach(async () => {
  await rm(homeDir, { recursive: true, force: true });
});

describe('FileSystemWorkspacesPersistence — read', () => {
  it('returns null when the file does not exist', async () => {
    const persistence = new FileSystemWorkspacesPersistence({ homeDir });
    const snapshot = await persistence.read();
    expect(snapshot).toBeNull();
  });

  it('returns the decoded snapshot when the file is well-formed', async () => {
    const persistence = new FileSystemWorkspacesPersistence({ homeDir });
    const snapshot: WorkspacesSnapshot = {
      version: '1.0',
      active_workspace_id: 'client-a',
      workspaces: [
        {
          workspace_id: 'client-a',
          projectRoot: '/Users/dev/projects/client-a',
          registered_at: '2026-05-09T19:30:00.000Z',
          active: true,
        },
      ],
    };
    await persistence.write(snapshot);
    const loaded = await persistence.read();
    expect(loaded).toEqual(snapshot);
  });

  it('returns null + warns through the injected logger for malformed JSON', async () => {
    const messages: string[] = [];
    const persistence = new FileSystemWorkspacesPersistence({
      homeDir,
      logger: { warn: (message: string) => messages.push(message) },
    });
    const path = join(homeDir, '.forgekit', 'workspaces.json');
    const dir = join(homeDir, '.forgekit');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(dir, { recursive: true });
    await writeFile(path, '{not json', 'utf8');
    const loaded = await persistence.read();
    expect(loaded).toBeNull();
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).toMatch(/workspaces.json/);
  });

  it('returns null + warns when the JSON shape is wrong', async () => {
    const messages: string[] = [];
    const persistence = new FileSystemWorkspacesPersistence({
      homeDir,
      logger: { warn: (message: string) => messages.push(message) },
    });
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(homeDir, '.forgekit'), { recursive: true });
    await writeFile(
      join(homeDir, '.forgekit', 'workspaces.json'),
      JSON.stringify({ wrong: 'shape' }),
      'utf8',
    );
    const loaded = await persistence.read();
    expect(loaded).toBeNull();
    expect(messages.length).toBeGreaterThan(0);
  });
});

describe('FileSystemWorkspacesPersistence — write', () => {
  it('creates the .forgekit directory when missing', async () => {
    const persistence = new FileSystemWorkspacesPersistence({ homeDir });
    await persistence.write({
      version: '1.0',
      active_workspace_id: null,
      workspaces: [],
    });
    const raw = await readFile(
      join(homeDir, '.forgekit', 'workspaces.json'),
      'utf8',
    );
    expect(JSON.parse(raw)).toEqual({
      version: '1.0',
      active_workspace_id: null,
      workspaces: [],
    });
  });

  it('writes atomically via a .tmp sibling and leaves no temp files behind', async () => {
    const persistence = new FileSystemWorkspacesPersistence({ homeDir });
    await persistence.write({
      version: '1.0',
      active_workspace_id: null,
      workspaces: [],
    });
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(join(homeDir, '.forgekit'));
    expect(entries).toContain('workspaces.json');
    expect(entries.filter((name) => name.endsWith('.tmp'))).toHaveLength(0);
  });

  it('overwrites an existing file atomically', async () => {
    const persistence = new FileSystemWorkspacesPersistence({ homeDir });
    await persistence.write({
      version: '1.0',
      active_workspace_id: 'a',
      workspaces: [
        {
          workspace_id: 'a',
          projectRoot: '/a',
          registered_at: '2026-05-09T19:30:00.000Z',
          active: true,
        },
      ],
    });
    await persistence.write({
      version: '1.0',
      active_workspace_id: 'b',
      workspaces: [
        {
          workspace_id: 'b',
          projectRoot: '/b',
          registered_at: '2026-05-09T19:31:00.000Z',
          active: true,
        },
      ],
    });
    const loaded = await persistence.read();
    expect(loaded?.active_workspace_id).toBe('b');
    expect(loaded?.workspaces).toHaveLength(1);
    expect(loaded?.workspaces[0]!.workspace_id).toBe('b');
  });
});
