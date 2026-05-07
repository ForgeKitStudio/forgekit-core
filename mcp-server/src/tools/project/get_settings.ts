/**
 * Implementation of the `project.get_settings` MCP tool.
 *
 * Reads `project.godot` from disk and returns the settings as a flat
 * map. Every call re-reads the file so the response always reflects
 * the authoritative on-disk state — never the editor's in-memory copy.
 * This is the explicit contract: after `project.update_settings` writes
 * + fsyncs, the next `get_settings` call shows the new value.
 *
 *   Without `section`: returns `{settings: {"<section>/<key>": "<value>"}}`
 *   With `section`:    returns `{settings: {"<key>": "<value>"}}` for keys
 *                      inside that section only.
 *
 * Values are returned verbatim (the text to the right of `=` in the
 * file). The caller is responsible for unquoting or parsing Godot
 * literals if it needs structured data.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ProjectIoError, ToolInputError } from './errors.js';
import { flattenSettings, parseGodotIni } from './godot_ini.js';

export interface GetSettingsParams {
  projectRoot: string;
  /** Optional section filter, e.g. "application". May not contain `/`. */
  section?: string;
}

export interface GetSettingsResult {
  settings: Record<string, string>;
}

export async function getSettings(
  params: GetSettingsParams,
): Promise<GetSettingsResult> {
  if (
    typeof params.projectRoot !== 'string' ||
    params.projectRoot.trim() === ''
  ) {
    throw new ToolInputError(
      `"projectRoot" must be a non-empty string (got ${JSON.stringify(params.projectRoot)}).`,
    );
  }
  if (params.section !== undefined) {
    if (typeof params.section !== 'string' || params.section.trim() === '') {
      throw new ToolInputError(
        `"section" must be a non-empty string when provided (got ${JSON.stringify(params.section)}).`,
      );
    }
    if (params.section.includes('/')) {
      throw new ToolInputError(
        `"section" must not contain "/" (got ${JSON.stringify(params.section)}); use the section header only.`,
      );
    }
  }

  const projectGodot = join(params.projectRoot, 'project.godot');
  let source: string;
  try {
    source = await readFile(projectGodot, 'utf8');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ProjectIoError(`Unable to read ${projectGodot}: ${reason}`);
  }

  const ini = parseGodotIni(source);

  if (params.section === undefined) {
    return { settings: flattenSettings(ini) };
  }

  const matched = ini.sections.find((s) => s.name === params.section);
  const settings: Record<string, string> = {};
  if (matched !== undefined) {
    for (const { key, value } of matched.keys) {
      settings[key] = value;
    }
  }
  return { settings };
}
