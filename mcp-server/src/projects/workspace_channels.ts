/**
 * Per-workspace transport state.
 *
 * Each registered workspace owns its own `WorkspaceChannels` record.
 * Ports are `null` until a channel binds (editor WebSocket, runtime
 * UDP, visualizer HTTP, health HTTP). The connection placeholders are
 * typed as `unknown` for now; later phases replace them with the real
 * WebSocket / UDP wrapper classes.
 *
 * The `WorkspaceChannelsRegistry` owns a Map of workspace_id to
 * record and exposes `allPortsInUse(channel)` so the port scanner can
 * exclude ports already taken by sibling workspaces in the same
 * process.
 */

import type { ChannelName } from './errors.js';

/** Per-workspace transport state bag. */
export interface WorkspaceChannels {
  editor_port: number | null;
  runtime_port: number | null;
  visualizer_port: number | null;
  health_port: number | null;
  /** Editor WebSocket state placeholder. Later phases swap in a real type. */
  editor_connection: unknown;
  /** Runtime UDP state placeholder. Later phases swap in a real type. */
  runtime_connection: unknown;
}

const CHANNEL_TO_PORT_KEY: Readonly<Record<ChannelName, keyof WorkspaceChannels>> = {
  editor: 'editor_port',
  runtime: 'runtime_port',
  visualizer: 'visualizer_port',
  health: 'health_port',
};

/**
 * In-memory directory of per-workspace channel records. Records are
 * created lazily on `getOrCreate` so callers don't need to invoke a
 * separate lifecycle hook after `ProjectRegistry.register`.
 */
export class WorkspaceChannelsRegistry {
  private readonly channels = new Map<string, WorkspaceChannels>();

  /** Return the (possibly freshly-created) record for `workspace_id`. */
  getOrCreate(workspace_id: string): WorkspaceChannels {
    const existing = this.channels.get(workspace_id);
    if (existing !== undefined) {
      return existing;
    }
    const fresh: WorkspaceChannels = {
      editor_port: null,
      runtime_port: null,
      visualizer_port: null,
      health_port: null,
      editor_connection: null,
      runtime_connection: null,
    };
    this.channels.set(workspace_id, fresh);
    return fresh;
  }

  /**
   * Return the union of every workspace's current port for the given
   * channel. Callers pass this set as `excluded` to `scanFreePort` so
   * a port in use by workspace A cannot be handed to workspace B.
   */
  allPortsInUse(channel: ChannelName): ReadonlySet<number> {
    const key = CHANNEL_TO_PORT_KEY[channel];
    const out = new Set<number>();
    for (const record of this.channels.values()) {
      const value = record[key];
      if (typeof value === 'number') {
        out.add(value);
      }
    }
    return out;
  }

  /** Drop the workspace record so its ports free up for other workspaces. */
  release(workspace_id: string): void {
    this.channels.delete(workspace_id);
  }
}
