/**
 * Tool profile loader and selector for `@forgekit/core-mcp`.
 *
 * Four profiles control which tools the MCP server exposes:
 *   - Full     — every tool.
 *   - Lite     — tools with `scope === "core"` (both core-minimal and core).
 *   - Minimal  — tools with `module === "core-minimal"`.
 *   - RPG-only — core-minimal tools, plus every combat/crafting/inventory/
 *                stats tool after a valid `forgekit_rpg` license is
 *                presented. Without the license only the core-minimal set
 *                is returned.
 */

import { readFile } from 'node:fs/promises';

export type ProfileName = 'Full' | 'Lite' | 'Minimal' | 'RPG-only';

export type ToolScope = 'core' | 'module';
export type ToolChannel = 'editor' | 'runtime' | 'cli' | 'cross';
export type ToolModule =
  | 'core-minimal'
  | 'core'
  | 'combat'
  | 'crafting'
  | 'inventory'
  | 'stats';

export interface ToolEntry {
  readonly name: string;
  readonly scope: ToolScope;
  readonly channel: ToolChannel;
  readonly module: ToolModule;
}

export interface ProfilesFile {
  readonly version: string;
  readonly tools: ReadonlyArray<ToolEntry>;
}

export interface ApplyProfileOptions {
  /** License identifier required for RPG-only profile subsystem tools. */
  readonly licenseId?: string | null;
}

export const VALID_PROFILES: ReadonlyArray<ProfileName> = [
  'Full',
  'Lite',
  'Minimal',
  'RPG-only',
];

const VALID_SCOPES: ReadonlyArray<ToolScope> = ['core', 'module'];
const VALID_CHANNELS: ReadonlyArray<ToolChannel> = ['editor', 'runtime', 'cli', 'cross'];
const VALID_MODULES: ReadonlyArray<ToolModule> = [
  'core-minimal',
  'core',
  'combat',
  'crafting',
  'inventory',
  'stats',
];

const RPG_SUBSYSTEM_MODULES: ReadonlySet<ToolModule> = new Set([
  'combat',
  'crafting',
  'inventory',
  'stats',
]);

const RPG_LICENSE_ID = 'forgekit_rpg';

/** Error raised when an unknown profile name is requested. */
export class UnknownProfileError extends Error {
  readonly code = 'UNKNOWN_PROFILE';
  readonly requested: string;
  readonly valid: ReadonlyArray<ProfileName>;

  constructor(requested: string) {
    super(
      `Unknown profile "${requested}". Valid profiles: ${VALID_PROFILES.join(', ')}.`,
    );
    this.name = 'UnknownProfileError';
    this.requested = requested;
    this.valid = VALID_PROFILES;
  }
}

/** Error raised when the `forgekit_rpg` license is required but invalid. */
export class RpgLicenseRequiredError extends Error {
  readonly code = 'RPG_LICENSE_REQUIRED';
  readonly expectedLicenseId = RPG_LICENSE_ID;

  constructor(message: string) {
    super(message);
    this.name = 'RpgLicenseRequiredError';
  }
}

/** Error raised when `profiles.json` fails schema validation. */
export class ProfilesFileInvalidError extends Error {
  readonly code = 'PROFILES_FILE_INVALID';
  readonly path: string;

  constructor(path: string, reason: string) {
    super(`profiles.json at ${path} is invalid: ${reason}`);
    this.name = 'ProfilesFileInvalidError';
    this.path = path;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateToolEntry(entry: unknown, index: number): ToolEntry {
  if (!isRecord(entry)) {
    throw new Error(`tools[${index}] must be an object.`);
  }
  const { name, scope, channel, module } = entry;
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`tools[${index}].name must be a non-empty string.`);
  }
  if (typeof scope !== 'string' || !VALID_SCOPES.includes(scope as ToolScope)) {
    throw new Error(
      `tools[${index}].scope must be one of: ${VALID_SCOPES.join(', ')}.`,
    );
  }
  if (
    typeof channel !== 'string' ||
    !VALID_CHANNELS.includes(channel as ToolChannel)
  ) {
    throw new Error(
      `tools[${index}].channel must be one of: ${VALID_CHANNELS.join(', ')}.`,
    );
  }
  if (
    typeof module !== 'string' ||
    !VALID_MODULES.includes(module as ToolModule)
  ) {
    throw new Error(
      `tools[${index}].module must be one of: ${VALID_MODULES.join(', ')}.`,
    );
  }
  return {
    name,
    scope: scope as ToolScope,
    channel: channel as ToolChannel,
    module: module as ToolModule,
  };
}

/**
 * Loads and validates `profiles.json` from disk. Throws
 * `ProfilesFileInvalidError` when the file is not valid JSON or the shape
 * does not match the schema.
 */
export async function loadProfiles(path: string): Promise<ProfilesFile> {
  const raw = await readFile(path, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ProfilesFileInvalidError(path, `not valid JSON (${reason})`);
  }

  if (!isRecord(parsed)) {
    throw new ProfilesFileInvalidError(path, 'expected a JSON object.');
  }

  const { version, tools } = parsed;
  if (typeof version !== 'string' || version.length === 0) {
    throw new ProfilesFileInvalidError(path, 'missing or empty "version" field.');
  }
  if (!Array.isArray(tools)) {
    throw new ProfilesFileInvalidError(path, '"tools" must be an array.');
  }

  const validated: ToolEntry[] = [];
  try {
    tools.forEach((entry, i) => {
      validated.push(validateToolEntry(entry, i));
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ProfilesFileInvalidError(path, reason);
  }

  return { version, tools: validated };
}

/**
 * Filters `profiles.tools` for `profileName`. The RPG-only profile consults
 * `options.licenseId`; other profiles ignore licensing.
 */
export function applyProfile(
  profiles: ProfilesFile,
  profileName: ProfileName,
  options: ApplyProfileOptions = {},
): ToolEntry[] {
  if (!VALID_PROFILES.includes(profileName)) {
    throw new UnknownProfileError(String(profileName));
  }

  const tools = profiles.tools;

  switch (profileName) {
    case 'Full':
      return [...tools];

    case 'Lite':
      return tools.filter((t) => t.scope === 'core');

    case 'Minimal':
      return tools.filter((t) => t.module === 'core-minimal');

    case 'RPG-only': {
      const licenseId = options.licenseId ?? null;
      if (licenseId !== null && licenseId !== RPG_LICENSE_ID) {
        throw new RpgLicenseRequiredError(
          `RPG-only profile requires license_id "${RPG_LICENSE_ID}", got "${licenseId}".`,
        );
      }
      const hasLicense = licenseId === RPG_LICENSE_ID;
      return tools.filter((t) => {
        if (t.module === 'core-minimal') {
          return true;
        }
        if (RPG_SUBSYSTEM_MODULES.has(t.module)) {
          return hasLicense;
        }
        return false;
      });
    }

    default: {
      // Exhaustive guard: if a new profile is added this branch will flag it.
      const never: never = profileName;
      throw new UnknownProfileError(String(never));
    }
  }
}
