extends RefCounted
## MCP JSON-RPC error codes used by the editor plugin, CLI, and runtime
## bridge. Each entry pairs a numeric JSON-RPC 2.0 error code with its stable
## machine-readable `message` (uppercase constant name) and a default
## actionable `suggestion` returned in the error envelope's `data` field.
##
## Error responses follow the JSON-RPC 2.0 shape:
## `{"code": int, "message": String, "data": {"suggestion": String, ...}}`
## Callers invoke `make_error(code, extra_data)` to produce a well-formed
## envelope whose `data.suggestion` defaults to the text associated with the
## code; callers can extend `data` with contextual fields (e.g. `path`,
## `transaction_id`, `size`, `limit`, `missing_sections[]`) and may override
## `suggestion` by supplying one in `extra_data`.
##
## Additional codes are added by other tasks as the MCP tool surface grows.


class_name McpErrorCodes


# ---------------------------------------------------------------------------
# Domain error codes.
#
# The numeric ranges follow the JSON-RPC 2.0 convention that application
# errors live in the implementation-defined server error range
# (-32000 to -32099). Pre-defined JSON-RPC codes (-32700 parse error,
# -32600 Invalid Request, -32601 Method not found, -32602 Invalid params,
# -32603 Internal error) stay owned by the dispatcher itself.
# ---------------------------------------------------------------------------

## Auth token mismatch or missing. Emitted by the editor plugin WebSocket
## handshake and any tool requiring authenticated access.
const UNAUTHORIZED: int = -32000
const UNAUTHORIZED_MESSAGE: String = "UNAUTHORIZED"

## Target file does not exist in the project. Emitted by any tool that
## accepts a `res://` path and cannot open it.
const FILE_NOT_FOUND: int = -32001
const FILE_NOT_FOUND_MESSAGE: String = "FILE_NOT_FOUND"

## Attempt to mutate a path that belongs to the read-only Core boundary
## declared in `addons/forgekit_core/boundary/core_boundary.gd`.
const CORE_BOUNDARY_VIOLATION: int = -32002
const CORE_BOUNDARY_VIOLATION_MESSAGE: String = "CORE_BOUNDARY_VIOLATION"

## GDScript failed parse validation before save. Emitted by the
## GDScript_Validator ahead of every `.gd` write.
const GDSCRIPT_SYNTAX_ERROR: int = -32003
const GDSCRIPT_SYNTAX_ERROR_MESSAGE: String = "GDSCRIPT_SYNTAX_ERROR"

## Warning (not a hard error) returned alongside a successful MCP tool
## response when the underlying mutation happens outside the
## EditorUndoRedoManager — e.g. writing a file on disk that is not an editor
## resource. The tool result is still returned to the caller; the warning is
## attached so the AI agent knows Ctrl+Z will not revert the change.
const NON_UNDOABLE_OPERATION: int = -32004
const NON_UNDOABLE_OPERATION_MESSAGE: String = "NON_UNDOABLE_OPERATION"

## Raised when `transaction.commit` or `transaction.rollback` receives a
## `transaction_id` that is not currently open in the TransactionManager.
const TRANSACTION_NOT_OPEN: int = -32009
const TRANSACTION_NOT_OPEN_MESSAGE: String = "TRANSACTION_NOT_OPEN"

## Project_Settings_Atomic_Writer failed to complete the
## read → parse → modify → write-temp → fsync → rename sequence. Surfaced
## when the underlying filesystem rename, load, or save step returns a
## non-OK error; the original target file is left untouched.
const ATOMIC_WRITE_FAILED: int = -32010
const ATOMIC_WRITE_FAILED_MESSAGE: String = "ATOMIC_WRITE_FAILED"

## Runtime bridge received a UDP packet larger than the IPv4 UDP limit
## (65 507 bytes). Emitted by the runtime bridge packet parser.
const PACKET_TOO_LARGE: int = -32005
const PACKET_TOO_LARGE_MESSAGE: String = "PACKET_TOO_LARGE"

## Module manifest references a Core git tag that does not exist.
const MANIFEST_TAG_NOT_FOUND: int = -32011
const MANIFEST_TAG_NOT_FOUND_MESSAGE: String = "MANIFEST_TAG_NOT_FOUND"

## AI context file (`CLAUDE.md` or `.cursorrules`) is out of sync with the
## code paths it describes.
const CONTEXT_FILE_STALE: int = -32012
const CONTEXT_FILE_STALE_MESSAGE: String = "CONTEXT_FILE_STALE"

## Commit message does not match the Conventional Commits format enforced
## by the `commit-msg` git hook.
const CONVENTIONAL_COMMITS_FORMAT_VIOLATION: int = -32013
const CONVENTIONAL_COMMITS_FORMAT_VIOLATION_MESSAGE: String = "CONVENTIONAL_COMMITS_FORMAT_VIOLATION"

## Pull request description is missing one or more required sections
## declared by the PR template.
const PR_TEMPLATE_INCOMPLETE: int = -32014
const PR_TEMPLATE_INCOMPLETE_MESSAGE: String = "PR_TEMPLATE_INCOMPLETE"

## Tool surfaced by `tools/list` was filtered out at `tools/call` time
## because the active license set does not unlock the module that owns
## it (or the module licence expired between `tools/list` and the call).
const PROFILE_TOOL_FILTERED: int = -32024
const PROFILE_TOOL_FILTERED_MESSAGE: String = "PROFILE_TOOL_FILTERED"

## `--profile` flag (or the equivalent `plugin_config.tres` field) carries
## a name that is not declared in `profiles.json`.
const UNKNOWN_PROFILE: int = -32025
const UNKNOWN_PROFILE_MESSAGE: String = "UNKNOWN_PROFILE"


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

## Build a JSON-RPC 2.0 error object for `code`. The returned dictionary is
## shaped `{"code": int, "message": String, "data": Dictionary}`.
##
## `extra_data` is merged into `data` without mutating the caller's copy.
## The default suggestion for `code` is injected under `data.suggestion`
## unless `extra_data` already contains a `suggestion` entry, in which case
## the caller's value wins.
static func make_error(code: int, extra_data: Dictionary = {}) -> Dictionary:
	var data: Dictionary = extra_data.duplicate()
	if not data.has("suggestion"):
		data["suggestion"] = _default_suggestion(code)
	return {
		"code": code,
		"message": _message_for(code),
		"data": data,
	}


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------

static func _message_for(code: int) -> String:
	match code:
		UNAUTHORIZED: return UNAUTHORIZED_MESSAGE
		FILE_NOT_FOUND: return FILE_NOT_FOUND_MESSAGE
		CORE_BOUNDARY_VIOLATION: return CORE_BOUNDARY_VIOLATION_MESSAGE
		GDSCRIPT_SYNTAX_ERROR: return GDSCRIPT_SYNTAX_ERROR_MESSAGE
		NON_UNDOABLE_OPERATION: return NON_UNDOABLE_OPERATION_MESSAGE
		TRANSACTION_NOT_OPEN: return TRANSACTION_NOT_OPEN_MESSAGE
		ATOMIC_WRITE_FAILED: return ATOMIC_WRITE_FAILED_MESSAGE
		PACKET_TOO_LARGE: return PACKET_TOO_LARGE_MESSAGE
		MANIFEST_TAG_NOT_FOUND: return MANIFEST_TAG_NOT_FOUND_MESSAGE
		CONTEXT_FILE_STALE: return CONTEXT_FILE_STALE_MESSAGE
		CONVENTIONAL_COMMITS_FORMAT_VIOLATION: return CONVENTIONAL_COMMITS_FORMAT_VIOLATION_MESSAGE
		PR_TEMPLATE_INCOMPLETE: return PR_TEMPLATE_INCOMPLETE_MESSAGE
		PROFILE_TOOL_FILTERED: return PROFILE_TOOL_FILTERED_MESSAGE
		UNKNOWN_PROFILE: return UNKNOWN_PROFILE_MESSAGE
		_: return "UNKNOWN_ERROR"


static func _default_suggestion(code: int) -> String:
	match code:
		UNAUTHORIZED:
			return "Provide a valid auth_token in the request headers matching plugin_config.tres."
		FILE_NOT_FOUND:
			return "Verify the 'res://' path exists in the project and that the file has been saved."
		CORE_BOUNDARY_VIOLATION:
			return "Target path is declared read-only by core_boundary.gd; write into addons/forgekit_rpg/ or another non-Core location instead."
		GDSCRIPT_SYNTAX_ERROR:
			return "Fix the reported parse errors before retrying the save; the file was not written to disk."
		NON_UNDOABLE_OPERATION:
			return "The change was applied but lives outside EditorUndoRedoManager; Ctrl+Z in the editor will not revert it. Roll back manually if needed."
		TRANSACTION_NOT_OPEN:
			return "Call transaction.begin() to obtain a transaction_id before commit or rollback."
		ATOMIC_WRITE_FAILED:
			return "The target file was not modified; check file permissions and retry the atomic write."
		PACKET_TOO_LARGE:
			return "Split the request payload; the runtime bridge accepts up to 65507 bytes per UDP datagram."
		MANIFEST_TAG_NOT_FOUND:
			return "Update module.manifest.tres so core_min_version points to a tag that exists in the Core repository."
		CONTEXT_FILE_STALE:
			return "Regenerate CLAUDE.md and .cursorrules so they reflect the current code paths, then recommit."
		CONVENTIONAL_COMMITS_FORMAT_VIOLATION:
			return "Rewrite the commit message as '<type>(<scope>): <subject>' per the Conventional Commits 1.0 spec."
		PR_TEMPLATE_INCOMPLETE:
			return "Populate the required PR template sections (Test Report, Gameplay Scenarios, Affected MCP Tools, Breaking Changes) before requesting review."
		PROFILE_TOOL_FILTERED:
			return "Activate the required module license or switch to a profile that exposes this tool, then call tools/list again."
		UNKNOWN_PROFILE:
			return "Pass --profile with one of full|lite|minimal|rpg-only or remove the flag to use the default profile."
		_:
			return "Consult the MCP error-code documentation for remediation steps."
