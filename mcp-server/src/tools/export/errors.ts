/**
 * Shared error types for the export tool family.
 *
 * The MCP JSON-RPC dispatcher turns thrown errors into typed JSON-RPC
 * error responses. Each class exposes a `code` string that the dispatcher
 * attaches to the JSON-RPC error object so callers can route on it.
 */

/** Raised when `export_presets.cfg` cannot be read from the project root. */
export class ExportPresetsFileMissingError extends Error {
  readonly code = 'EXPORT_PRESETS_FILE_MISSING';

  constructor(path: string) {
    super(`export_presets.cfg was not found at "${path}"`);
    this.name = 'ExportPresetsFileMissingError';
  }
}
