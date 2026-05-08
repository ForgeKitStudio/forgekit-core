/**
 * Pure path-resolution helpers for locating Godot's `user://licenses/`
 * directory on the host filesystem.
 *
 * Godot's `user://` prefix is a per-project data directory whose physical
 * location depends on the platform and on the project's `config/name`:
 *
 *   - macOS   : ~/Library/Application Support/Godot/app_userdata/<name>/
 *   - Linux   : ~/.local/share/godot/app_userdata/<name>/
 *   - Windows : %APPDATA%/Godot/app_userdata/<name>/
 *
 * This module does NOT perform I/O; `startup.ts` composes it with the
 * filesystem to produce a final directory path.
 */

import { posix as pathPosix, win32 as pathWin32 } from 'node:path';

/** Inputs for `resolveUserLicenseDir`. */
export interface ResolveUserLicenseDirOptions {
  /** Node `process.platform` value. */
  readonly platform: NodeJS.Platform | string;
  /** Environment map (typically `process.env`). */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** User home directory (typically `os.homedir()`). */
  readonly homedir: string;
  /** Project name as found in `project.godot`'s `config/name`. */
  readonly projectName: string;
}

/**
 * Builds the absolute path to Godot's `user://licenses/` directory for a
 * given platform. Uses forward-slash joins on POSIX platforms and
 * backslash joins on Windows so the output matches what Godot itself
 * would produce at runtime.
 */
export function resolveUserLicenseDir(
  options: ResolveUserLicenseDirOptions,
): string {
  const { platform, env, homedir, projectName } = options;

  if (platform === 'darwin') {
    return pathPosix.join(
      homedir,
      'Library',
      'Application Support',
      'Godot',
      'app_userdata',
      projectName,
      'licenses',
    );
  }

  if (platform === 'win32') {
    const appData =
      env.APPDATA ?? pathWin32.join(homedir, 'AppData', 'Roaming');
    return pathWin32.join(
      appData,
      'Godot',
      'app_userdata',
      projectName,
      'licenses',
    );
  }

  // Linux and any other POSIX-ish platform.
  return pathPosix.join(
    homedir,
    '.local',
    'share',
    'godot',
    'app_userdata',
    projectName,
    'licenses',
  );
}

/**
 * Extracts the value of `config/name` from the text of a `project.godot`
 * file. The value is expected to be a double-quoted string. Returns
 * `null` if the key is absent or the value is not quoted.
 */
export function parseProjectName(projectGodotContent: string): string | null {
  // Match:  config/name = "Some Name"
  // Whitespace and `=` padding are permitted; the value must be double-quoted.
  const re = /^\s*config\/name\s*=\s*"([^"]*)"\s*$/m;
  const match = projectGodotContent.match(re);
  if (match === null) {
    return null;
  }
  return match[1];
}
