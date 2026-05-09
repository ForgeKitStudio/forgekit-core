/**
 * Implementation of the `project.info` MCP tool.
 *
 * Returns a stable summary of the Godot project at `projectRoot`:
 *
 *   {
 *     name: string,            // [application] config/name
 *     godot_version: string,   // extracted from [application] config/features
 *     api_version: string,     // forwarded from the caller (MCP server version)
 *     modules_count: number,   // forgekit_* modules with a valid manifest
 *     root_path: string,       // absolute path to the project root
 *   }
 *
 * The Godot version is the first recognized `X.Y` or `X.Y.Z` literal
 * from `config/features=PackedStringArray("4.3", "Forward Plus")`.
 * When no version literal is present we return `"unknown"` rather than
 * guessing, because silently reporting `"4.x"` would hide real
 * misconfiguration.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ProjectIoError, ToolInputError } from './errors.js';
import { flattenSettings, parseGodotIni } from './godot_ini.js';
import { scanModules } from './module_scan.js';

export interface ProjectInfoParams {
  /** Absolute path to the Godot project root (contains `project.godot`). */
  projectRoot: string;
  /**
   * MCP server SemVer (`@forgekitstudio/core-mcp` package version). Forwarded
   * into the response so the caller doesn't need to resolve it itself.
   */
  apiVersion: string;
}

export interface ProjectInfo {
  name: string;
  godot_version: string;
  api_version: string;
  modules_count: number;
  root_path: string;
}

function requireNonBlank(value: string, field: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ToolInputError(
      `"${field}" must be a non-empty string (got ${JSON.stringify(value)}).`,
    );
  }
}

export async function projectInfo(
  params: ProjectInfoParams,
): Promise<ProjectInfo> {
  requireNonBlank(params.projectRoot, 'projectRoot');
  requireNonBlank(params.apiVersion, 'apiVersion');

  const projectGodot = join(params.projectRoot, 'project.godot');
  let source: string;
  try {
    source = await readFile(projectGodot, 'utf8');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ProjectIoError(
      `Unable to read ${projectGodot}: ${reason}`,
    );
  }

  const ini = parseGodotIni(source);
  const flat = flattenSettings(ini);

  const rawName = flat['application/config/name'] ?? '""';
  const name = unquote(rawName);

  const rawFeatures = flat['application/config/features'] ?? '';
  const godotVersion = extractGodotVersion(rawFeatures);

  const modules = await scanModules(params.projectRoot);

  return {
    name,
    godot_version: godotVersion,
    api_version: params.apiVersion,
    modules_count: modules.length,
    root_path: params.projectRoot,
  };
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Scans `config/features=PackedStringArray("4.3", "Forward Plus")` for
 * the first `X.Y` or `X.Y.Z` token and returns it as a plain string.
 * Returns `"unknown"` when no such token is present.
 */
function extractGodotVersion(raw: string): string {
  const match = /"(\d+\.\d+(?:\.\d+)?)"/.exec(raw);
  return match ? match[1] : 'unknown';
}
