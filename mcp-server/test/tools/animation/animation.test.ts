/**
 * Tests for the editor-channel Animation MCP tools:
 *
 *   animation.list(player_path)                                    → {animations: [...]}
 *   animation.play(player_path, name, speed?)                      → {playing, name}
 *   animation.stop(player_path)                                    → {stopped: true}
 *   animation.add_track(player_path, animation_name,
 *                       track_type, path)                          → {track_index, undo_action_id?}
 *
 * All of these dispatch to the editor plugin (WebSocket channel),
 * which reads / drives the target `AnimationPlayer` node through
 * `EditorInterface`. The server-layer shim validates parameters before
 * forwarding the call; the plugin returns the authoritative reply.
 *
 * `animation.add_track` is a mutating tool: the plugin routes it through
 * `Undo_Redo_Wrapper`, so Ctrl+Z in the editor reverts the added track.
 * The TS shim is intentionally thin — it only validates the four
 * non-empty string parameters and forwards the call; it never inspects
 * or constrains the `track_type` string so that new Godot track kinds
 * become usable without a server release.
 *
 * The `speed` parameter on `animation.play` defaults to `1.0` when the
 * caller omits it. The shim always forwards a numeric `speed` so the
 * plugin does not have to guess — this keeps the on-wire contract
 * explicit and matches the GDScript adapter at
 * `addons/forgekit_core/mcp/editor_plugin/tools/animation_tools.gd`,
 * which also defaults `speed` to `1.0`.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  addAnimationTrack,
  listAnimations,
  playAnimation,
  stopAnimation,
  type AnimationDispatcher,
} from '../../../src/tools/animation/animation.js';
import { ToolInputError } from '../../../src/tools/project/errors.js';

// ---------------------------------------------------------------------------
// animation.list
// ---------------------------------------------------------------------------

describe('listAnimations', () => {
  it('forwards player_path and returns {animations} from the plugin', async () => {
    const dispatch: AnimationDispatcher = vi.fn().mockResolvedValue({
      animations: [
        { name: 'idle', length: 1.0, loop_mode: 'linear' },
        { name: 'run', length: 0.75, loop_mode: 'linear' },
      ],
    });
    const result = await listAnimations(
      { player_path: '/root/Main/AnimationPlayer' },
      { dispatch },
    );
    expect(dispatch).toHaveBeenCalledWith('animation.list', {
      player_path: '/root/Main/AnimationPlayer',
    });
    expect(result.animations).toHaveLength(2);
    expect(result.animations?.[0]).toMatchObject({ name: 'idle' });
  });

  it('rejects an empty player_path', async () => {
    const dispatch: AnimationDispatcher = vi.fn();
    await expect(
      listAnimations({ player_path: '' }, { dispatch }),
    ).rejects.toThrow(ToolInputError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects a non-string player_path', async () => {
    const dispatch: AnimationDispatcher = vi.fn();
    await expect(
      listAnimations(
        { player_path: 123 as unknown as string },
        { dispatch },
      ),
    ).rejects.toThrow(ToolInputError);
  });

  it('raises ToolInputError when the dispatcher is missing', async () => {
    await expect(
      listAnimations({ player_path: '/root/P' }, {}),
    ).rejects.toThrow(ToolInputError);
  });
});

// ---------------------------------------------------------------------------
// animation.play
// ---------------------------------------------------------------------------

describe('playAnimation', () => {
  it('forwards player_path and name with default speed = 1.0', async () => {
    const dispatch: AnimationDispatcher = vi.fn().mockResolvedValue({
      playing: true,
      name: 'idle',
    });
    const result = await playAnimation(
      { player_path: '/root/P', name: 'idle' },
      { dispatch },
    );
    expect(dispatch).toHaveBeenCalledWith('animation.play', {
      player_path: '/root/P',
      name: 'idle',
      speed: 1.0,
    });
    expect(result.playing).toBe(true);
    expect(result.name).toBe('idle');
  });

  it('forwards speed verbatim when provided', async () => {
    const dispatch: AnimationDispatcher = vi.fn().mockResolvedValue({
      playing: true,
      name: 'run',
    });
    await playAnimation(
      { player_path: '/root/P', name: 'run', speed: 2.5 },
      { dispatch },
    );
    expect(dispatch).toHaveBeenCalledWith('animation.play', {
      player_path: '/root/P',
      name: 'run',
      speed: 2.5,
    });
  });

  it('forwards negative speed (reverse playback) verbatim', async () => {
    const dispatch: AnimationDispatcher = vi.fn().mockResolvedValue({});
    await playAnimation(
      { player_path: '/root/P', name: 'run', speed: -1.0 },
      { dispatch },
    );
    expect(dispatch).toHaveBeenCalledWith('animation.play', {
      player_path: '/root/P',
      name: 'run',
      speed: -1.0,
    });
  });

  it('rejects an empty player_path', async () => {
    const dispatch: AnimationDispatcher = vi.fn();
    await expect(
      playAnimation(
        { player_path: '', name: 'idle' },
        { dispatch },
      ),
    ).rejects.toThrow(ToolInputError);
  });

  it('rejects an empty animation name', async () => {
    const dispatch: AnimationDispatcher = vi.fn();
    await expect(
      playAnimation(
        { player_path: '/root/P', name: '' },
        { dispatch },
      ),
    ).rejects.toThrow(ToolInputError);
  });

  it('rejects a non-finite speed (NaN, Infinity)', async () => {
    const dispatch: AnimationDispatcher = vi.fn();
    await expect(
      playAnimation(
        { player_path: '/root/P', name: 'idle', speed: Number.NaN },
        { dispatch },
      ),
    ).rejects.toThrow(ToolInputError);
    await expect(
      playAnimation(
        {
          player_path: '/root/P',
          name: 'idle',
          speed: Number.POSITIVE_INFINITY,
        },
        { dispatch },
      ),
    ).rejects.toThrow(ToolInputError);
  });

  it('rejects a non-number speed', async () => {
    const dispatch: AnimationDispatcher = vi.fn();
    await expect(
      playAnimation(
        {
          player_path: '/root/P',
          name: 'idle',
          speed: 'fast' as unknown as number,
        },
        { dispatch },
      ),
    ).rejects.toThrow(ToolInputError);
  });

  it('raises ToolInputError when the dispatcher is missing', async () => {
    await expect(
      playAnimation({ player_path: '/root/P', name: 'idle' }, {}),
    ).rejects.toThrow(ToolInputError);
  });
});

// ---------------------------------------------------------------------------
// animation.stop
// ---------------------------------------------------------------------------

describe('stopAnimation', () => {
  it('forwards player_path and returns {stopped: true} from the plugin', async () => {
    const dispatch: AnimationDispatcher = vi.fn().mockResolvedValue({
      stopped: true,
    });
    const result = await stopAnimation(
      { player_path: '/root/Main/AnimationPlayer' },
      { dispatch },
    );
    expect(dispatch).toHaveBeenCalledWith('animation.stop', {
      player_path: '/root/Main/AnimationPlayer',
    });
    expect(result.stopped).toBe(true);
  });

  it('rejects an empty player_path', async () => {
    const dispatch: AnimationDispatcher = vi.fn();
    await expect(
      stopAnimation({ player_path: '' }, { dispatch }),
    ).rejects.toThrow(ToolInputError);
  });

  it('raises ToolInputError when the dispatcher is missing', async () => {
    await expect(
      stopAnimation({ player_path: '/root/P' }, {}),
    ).rejects.toThrow(ToolInputError);
  });
});

// ---------------------------------------------------------------------------
// animation.add_track
// ---------------------------------------------------------------------------

describe('addAnimationTrack', () => {
  it('forwards all four params and returns the plugin reply verbatim', async () => {
    const dispatch: AnimationDispatcher = vi.fn().mockResolvedValue({
      track_index: 2,
      undo_action_id: 47,
    });
    const result = await addAnimationTrack(
      {
        player_path: '/root/Main/AnimationPlayer',
        animation_name: 'run',
        track_type: 'position_3d',
        path: 'Player/Skeleton:bone',
      },
      { dispatch },
    );
    expect(dispatch).toHaveBeenCalledWith('animation.add_track', {
      player_path: '/root/Main/AnimationPlayer',
      animation_name: 'run',
      track_type: 'position_3d',
      path: 'Player/Skeleton:bone',
    });
    expect(result.track_index).toBe(2);
    expect(result.undo_action_id).toBe(47);
  });

  it('returns the reply even when the plugin omits undo_action_id', async () => {
    const dispatch: AnimationDispatcher = vi.fn().mockResolvedValue({
      track_index: 0,
    });
    const result = await addAnimationTrack(
      {
        player_path: '/root/P',
        animation_name: 'idle',
        track_type: 'value',
        path: 'Player:modulate',
      },
      { dispatch },
    );
    expect(result.track_index).toBe(0);
    expect(result.undo_action_id).toBeUndefined();
  });

  it('does not constrain track_type so new Godot track kinds are forwarded', async () => {
    const dispatch: AnimationDispatcher = vi.fn().mockResolvedValue({
      track_index: 0,
    });
    await addAnimationTrack(
      {
        player_path: '/root/P',
        animation_name: 'idle',
        track_type: 'blend_shape',
        path: 'Mesh:morph/happy',
      },
      { dispatch },
    );
    expect(dispatch).toHaveBeenCalledWith('animation.add_track', {
      player_path: '/root/P',
      animation_name: 'idle',
      track_type: 'blend_shape',
      path: 'Mesh:morph/happy',
    });
  });

  it('rejects an empty player_path', async () => {
    const dispatch: AnimationDispatcher = vi.fn();
    await expect(
      addAnimationTrack(
        {
          player_path: '',
          animation_name: 'run',
          track_type: 'value',
          path: 'Player:modulate',
        },
        { dispatch },
      ),
    ).rejects.toThrow(ToolInputError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects an empty animation_name', async () => {
    const dispatch: AnimationDispatcher = vi.fn();
    await expect(
      addAnimationTrack(
        {
          player_path: '/root/P',
          animation_name: '',
          track_type: 'value',
          path: 'Player:modulate',
        },
        { dispatch },
      ),
    ).rejects.toThrow(ToolInputError);
  });

  it('rejects an empty track_type', async () => {
    const dispatch: AnimationDispatcher = vi.fn();
    await expect(
      addAnimationTrack(
        {
          player_path: '/root/P',
          animation_name: 'run',
          track_type: '',
          path: 'Player:modulate',
        },
        { dispatch },
      ),
    ).rejects.toThrow(ToolInputError);
  });

  it('rejects an empty path', async () => {
    const dispatch: AnimationDispatcher = vi.fn();
    await expect(
      addAnimationTrack(
        {
          player_path: '/root/P',
          animation_name: 'run',
          track_type: 'value',
          path: '',
        },
        { dispatch },
      ),
    ).rejects.toThrow(ToolInputError);
  });

  it('rejects non-string arguments', async () => {
    const dispatch: AnimationDispatcher = vi.fn();
    await expect(
      addAnimationTrack(
        {
          player_path: '/root/P',
          animation_name: 'run',
          track_type: 'value',
          path: 123 as unknown as string,
        },
        { dispatch },
      ),
    ).rejects.toThrow(ToolInputError);
  });

  it('raises ToolInputError when the dispatcher is missing', async () => {
    await expect(
      addAnimationTrack(
        {
          player_path: '/root/P',
          animation_name: 'run',
          track_type: 'value',
          path: 'Player:modulate',
        },
        {},
      ),
    ).rejects.toThrow(ToolInputError);
  });
});
