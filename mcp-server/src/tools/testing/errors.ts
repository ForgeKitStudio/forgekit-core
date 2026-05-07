/**
 * Shared error types for the testing/QA tool family.
 *
 * The MCP JSON-RPC dispatcher turns thrown errors into typed JSON-RPC error
 * responses. `ToolInputError` is the canonical "bad input" error: the
 * dispatcher reads `code` and attaches it to the JSON-RPC error object.
 */

/**
 * Error raised when a tool is invoked with missing or invalid parameters.
 * Maps to JSON-RPC error code `INVALID_ARGUMENT` at the dispatcher layer.
 */
export class ToolInputError extends Error {
  readonly code = 'INVALID_ARGUMENT';

  constructor(message: string) {
    super(message);
    this.name = 'ToolInputError';
  }
}
