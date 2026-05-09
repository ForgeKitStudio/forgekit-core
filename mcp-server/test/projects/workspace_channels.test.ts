/**
 * Tests for WorkspaceChannels and WorkspaceChannelsRegistry.
 *
 * The registry owns per-workspace transport state (ports + connection
 * placeholders). Its read/write surface supports the dispatcher's port
 * isolation logic: `allPortsInUse(channel)` returns the union of every
 * workspace's current port for that channel so the scanner can exclude
 * the aggregate before picking a new free port.
 */

import { describe, expect, it } from 'vitest';

import { WorkspaceChannelsRegistry } from '../../src/projects/workspace_channels.js';

describe('WorkspaceChannelsRegistry.getOrCreate', () => {
  it('creates an empty record with null ports for a new workspace', () => {
    const registry = new WorkspaceChannelsRegistry();
    const channels = registry.getOrCreate('a');
    expect(channels.editor_port).toBeNull();
    expect(channels.runtime_port).toBeNull();
    expect(channels.visualizer_port).toBeNull();
    expect(channels.health_port).toBeNull();
  });

  it('returns the same record on repeated calls for the same workspace', () => {
    const registry = new WorkspaceChannelsRegistry();
    const first = registry.getOrCreate('a');
    first.editor_port = 6012;
    const second = registry.getOrCreate('a');
    expect(second.editor_port).toBe(6012);
    expect(second).toBe(first);
  });

  it('keeps distinct records per workspace', () => {
    const registry = new WorkspaceChannelsRegistry();
    const a = registry.getOrCreate('a');
    const b = registry.getOrCreate('b');
    a.editor_port = 6011;
    b.editor_port = 6012;
    expect(registry.getOrCreate('a').editor_port).toBe(6011);
    expect(registry.getOrCreate('b').editor_port).toBe(6012);
  });
});

describe('WorkspaceChannelsRegistry.allPortsInUse', () => {
  it('returns an empty set when no workspaces have allocated ports', () => {
    const registry = new WorkspaceChannelsRegistry();
    expect([...registry.allPortsInUse('editor')]).toEqual([]);
  });

  it('aggregates per-channel ports across all workspaces', () => {
    const registry = new WorkspaceChannelsRegistry();
    registry.getOrCreate('a').editor_port = 6011;
    registry.getOrCreate('b').editor_port = 6013;
    registry.getOrCreate('c').editor_port = null;
    expect([...registry.allPortsInUse('editor')].sort()).toEqual([6011, 6013]);
    expect([...registry.allPortsInUse('runtime')]).toEqual([]);
  });

  it('returns a fresh set that does not mutate the registry', () => {
    const registry = new WorkspaceChannelsRegistry();
    registry.getOrCreate('a').editor_port = 6011;
    const ports = registry.allPortsInUse('editor');
    expect(ports.has(6011)).toBe(true);
    // Mutating the snapshot must not affect future reads.
    (ports as Set<number>).clear?.();
    expect([...registry.allPortsInUse('editor')]).toEqual([6011]);
  });
});

describe('WorkspaceChannelsRegistry.release', () => {
  it('removes the workspace record so its ports drop out of the aggregate', () => {
    const registry = new WorkspaceChannelsRegistry();
    registry.getOrCreate('a').editor_port = 6011;
    registry.getOrCreate('b').editor_port = 6013;
    registry.release('a');
    expect([...registry.allPortsInUse('editor')]).toEqual([6013]);
  });

  it('is a no-op for unknown workspaces', () => {
    const registry = new WorkspaceChannelsRegistry();
    expect(() => registry.release('missing')).not.toThrow();
  });

  it('re-calling getOrCreate after release produces a fresh empty record', () => {
    const registry = new WorkspaceChannelsRegistry();
    registry.getOrCreate('a').editor_port = 6011;
    registry.release('a');
    const fresh = registry.getOrCreate('a');
    expect(fresh.editor_port).toBeNull();
  });
});
