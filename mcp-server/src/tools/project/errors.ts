/**
 * Shared error types for the project tool family.
 *
 * The dispatcher maps `ToolInputError` to JSON-RPC `INVALID_ARGUMENT`,
 * `ProjectIoError` to `PROJECT_IO_ERROR`, and uses `SettingsMergeError.code`
 * for the atomic writer failure modes.
 */

export class ToolInputError extends Error {
  readonly code = 'INVALID_ARGUMENT';

  constructor(message: string) {
    super(message);
    this.name = 'ToolInputError';
  }
}

export class ProjectIoError extends Error {
  readonly code = 'PROJECT_IO_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'ProjectIoError';
  }
}
