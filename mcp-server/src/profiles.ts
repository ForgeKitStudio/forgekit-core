/**
 * Tool profile loader and selector for `@forgekit/core-mcp`.
 *
 * Four profiles control which tools the MCP server exposes:
 *   - Full     — every tool.
 *   - Lite     — tools with `scope === "core"` (both core-minimal and core).
 *   - Minimal  — tools with `module === "core-minimal"`.
 *   - RPG-only — core-minimal tools, plus every combat / crafting /
 *                inventory / stats / effects / magic / equipment /
 *                progression tool after a valid `forgekit_rpg` license
 *                is presented. Without the license only the core-minimal
 *                set is returned.
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
  | 'stats'
  | 'effects'
  | 'magic'
  | 'equipment'
  | 'progression';

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
  /**
   * License identifier (legacy interface).
   *
   * When `licenseId === 'forgekit_rpg'` and `unlockedModules` is not
   * supplied, the RPG-only profile unlocks all eight RPG subsystem
   * modules (combat, crafting, inventory, stats, effects, magic,
   * equipment, progression).
   * When `licenseId` is any other non-null value and `unlockedModules`
   * is not supplied, `RpgLicenseRequiredError` is raised for the
   * RPG-only profile. Ignored by every other profile.
   */
  readonly licenseId?: string | null;
  /**
   * Explicit set of subsystem modules to expose in addition to the
   * base profile filter. When provided, this takes precedence over
   * `licenseId`. Passing a non-empty set turns on the corresponding
   * module tools for any profile (Full, Lite, Minimal, RPG-only) in
   * an additive manner, deduplicating against tools already selected.
   */
  readonly unlockedModules?: ReadonlySet<ToolModule>;
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
  'effects',
  'magic',
  'equipment',
  'progression',
];

const RPG_SUBSYSTEM_MODULES: ReadonlySet<ToolModule> = new Set([
  'combat',
  'crafting',
  'inventory',
  'stats',
  'effects',
  'magic',
  'equipment',
  'progression',
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
 * Filters `profiles.tools` for `profileName`.
 *
 * The optional `options.unlockedModules` set is additive across every
 * profile: any tool whose `module` is contained in the set is included
 * regardless of whether the base profile filter would have kept it.
 * This lets the MCP server's startup license scan unlock RPG subsystem
 * tools on top of any profile without touching the profile definitions.
 *
 * For backwards compatibility the legacy `options.licenseId` argument
 * is honoured when `unlockedModules` is not supplied: `licenseId ===
 * 'forgekit_rpg'` maps to the eight RPG subsystem modules (combat,
 * crafting, inventory, stats, effects, magic, equipment, progression),
 * any other non-null id raises `RpgLicenseRequiredError` for the
 * RPG-only profile.
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
  const explicitUnlock = options.unlockedModules;
  const licenseId = options.licenseId ?? null;

  // Resolve the effective unlock set. Explicit `unlockedModules` wins;
  // otherwise fall back to the legacy licenseId → RPG mapping.
  let unlocked: ReadonlySet<ToolModule>;
  if (explicitUnlock !== undefined) {
    unlocked = explicitUnlock;
  } else if (licenseId === RPG_LICENSE_ID) {
    unlocked = RPG_SUBSYSTEM_MODULES;
  } else {
    unlocked = new Set<ToolModule>();
  }

  const selectByProfile = (t: ToolEntry): boolean => {
    switch (profileName) {
      case 'Full':
        return true;
      case 'Lite':
        return t.scope === 'core';
      case 'Minimal':
        return t.module === 'core-minimal';
      case 'RPG-only':
        return t.module === 'core-minimal';
      default: {
        const never: never = profileName;
        throw new UnknownProfileError(String(never));
      }
    }
  };

  if (profileName === 'RPG-only' && explicitUnlock === undefined) {
    if (licenseId !== null && licenseId !== RPG_LICENSE_ID) {
      throw new RpgLicenseRequiredError(
        `RPG-only profile requires license_id "${RPG_LICENSE_ID}", got "${licenseId}".`,
      );
    }
  }

  const seen = new Set<string>();
  const out: ToolEntry[] = [];
  for (const t of tools) {
    const keep = selectByProfile(t) || unlocked.has(t.module);
    if (!keep) {
      continue;
    }
    if (seen.has(t.name)) {
      continue;
    }
    seen.add(t.name);
    out.push(t);
  }
  return out;
}
