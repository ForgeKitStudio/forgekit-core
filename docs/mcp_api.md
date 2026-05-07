# MCP API — v0.1 MVP

This document describes the MVP tool surface exposed by
`@forgekit/core-mcp` in the v0.1 ForgeKit_Core milestone. The full target
of 215 tools across 34 categories is tracked in the design document; the
shapes below cover what ships in v0.1 and are stable from this milestone
onward.

## Transports

The server multiplexes calls across three channels. Every tool is
annotated with the channel it uses.

| Channel   | Transport                               | Default ports | Notes |
| --------- | --------------------------------------- | ------------- | ----- |
| `editor`  | WebSocket JSON-RPC 2.0                  | `6010-6019`   | Runs in the Godot editor via the plugin. |
| `cli`     | `spawn("godot", ["--headless", ...])`   | —             | Used by CI and pre-commit; returns a `TestReport` on stdout. |
| `runtime` | UDP JSON-RPC framed into single datagrams | `6020-6029`   | Active only with `--mcp-bridge`; datagrams over 65 507 bytes are rejected with `PACKET_TOO_LARGE`. |

## JSON-RPC 2.0 envelope

All tools use the JSON-RPC 2.0 request/response envelope. `params` for
each tool is a JSON object with the fields documented below.

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "<category>.<tool>",
  "params": { ... }
}
```

Successful responses carry a `result` object. Errors use the standard
JSON-RPC `error` object. ForgeKit-specific error codes live in the
negative range reserved for server errors (`-32000` to `-32099`):

| Code     | Symbol                             | Meaning |
| -------- | ---------------------------------- | ------- |
| `-32004` | `NON_UNDOABLE_OPERATION`           | Warning envelope attached to a successful result when the underlying mutation happens outside `EditorUndoRedoManager`. |
| `-32009` | `TRANSACTION_NOT_OPEN`             | `transaction.commit` / `transaction.rollback` was called with a `transaction_id` that is not currently open. |
| `-32011` | `MANIFEST_TAG_NOT_FOUND`           | `manifest.core_min_version` points at a Git tag that does not exist in Core. |
| `-32012` | `CONTEXT_FILE_STALE`               | `CLAUDE.md` / `.cursorrules` not updated alongside a code change. |
| `-32013` | `CONVENTIONAL_COMMITS_FORMAT_VIOLATION` | Commit message does not match the Conventional Commits grammar. |
| `-32014` | `PR_TEMPLATE_INCOMPLETE`           | Pull request description is missing one of the required sections. |

Tool-level errors thrown during validation (missing `projectRoot`,
unknown section name, malformed patch) raise `ToolInputError`. I/O
failures (`project.godot` unreadable, permission denied) raise
`ProjectIoError`. Both are translated into JSON-RPC error responses with
a human-readable `message` and a machine-readable `data` payload.

## Undo/Redo semantics for `editor` tools

Every mutating tool on the `editor` channel routes its change through
`EditorUndoRedoManager` so a single `Ctrl+Z` in the Godot editor reverts
the agent's edit. This is implemented by `McpUndoRedoWrapper` and
surfaces three rules the caller needs to know about.

**Action naming.** Each standalone mutation opens an UndoRedo action
named `MCP: <tool_name> <target>`, where `<target>` identifies the
changed scene, node, or resource. When `target` is empty the name
collapses to `MCP: <tool_name>`; when both are empty it collapses to
`MCP: batch` — the same label used by transactions.

**Transactions collapse N ops into one Undo.** Tools accept an optional
`transaction_id` parameter. When it is supplied and refers to an open
transaction (`transaction.begin` &rarr; &hellip; &rarr;
`transaction.commit`), the wrapper enqueues the operation on the
transaction instead of opening its own action. Commit then replays the
whole queue inside a single UndoRedo action, so N successive tool calls
between `begin` and `commit` collapse to one Undo entry. An unknown or
empty `transaction_id` falls back to a standalone single-op action so
the mutation remains undoable on its own.

**`NON_UNDOABLE_OPERATION` warnings.** Some tools mutate state that
lives outside the editor's UndoRedo stack — writing a file that is not
an editor resource is the canonical example. In that case the tool
still returns a normal `result`, but attaches a warning envelope:

```json
{
  "code": -32004,
  "message": "NON_UNDOABLE_OPERATION",
  "data": {
    "tool_name": "<tool>",
    "target": "<target>",
    "reason": "<why the change bypasses UndoRedo>",
    "suggestion": "The change was applied but lives outside EditorUndoRedoManager; Ctrl+Z in the editor will not revert it. Roll back manually if needed."
  }
}
```

Callers should treat the warning as advisory: the operation succeeded,
but `Ctrl+Z` will not undo it and the caller must roll the change back
by hand if needed.

## Project category

### `project.info` — `editor`, `cli`

Returns a stable summary of a project.

**Params:**

```json
{ "projectRoot": "<absolute path>", "apiVersion": "<server SemVer>" }
```

**Result:**

```json
{
  "name": "ForgeKit Core Template",
  "godot_version": "4.3",
  "api_version": "0.1.0",
  "modules_count": 0,
  "root_path": "/abs/path/to/project"
}
```

`godot_version` is extracted from
`[application] config/features=PackedStringArray("4.3", "Forward Plus")`.
When no `X.Y[.Z]` literal is present the value is `"unknown"` rather
than a guess. `modules_count` is the number of `addons/forgekit_*/`
directories that ship a valid `module.manifest.tres`.

### `project.list_modules` — `editor`, `cli`

Enumerates installed modules discovered under `addons/forgekit_*/` that
carry a valid `module.manifest.tres`.

**Params:** `{ "projectRoot": "<absolute path>" }`

**Result:**

```json
{
  "modules": [
    {
      "id": "forgekit_rpg",
      "version": "1.0.0",
      "license_id": "forgekit_rpg_eula",
      "core_min_version": "0.1.0",
      "source_repo": "ForgeKitStudio/forgekit-rpg",
      "enabled": true
    }
  ]
}
```

Entries are sorted by `id` in ascending order so callers get a stable
diff across calls. `enabled` is `true` for any discoverable module in
v0.1; the `modules.enable` / `modules.disable` pair that flips this flag
ships in a later phase.

### `project.check_imports` — `cli`

Walks every `.gd` file under `addons/forgekit_core/**` and
`addons/forgekit_rpg/**`, extracts every `preload("res://...")`,
`load("res://...")`, and `extends "res://..."` target, and flags
boundary violations.

**Params:** `{ "projectRoot": "<absolute path>" }`

**Result:**

```json
{
  "violations": [
    {
      "file": "addons/forgekit_rpg/combat/hitbox.gd",
      "imports": ["res://addons/forgekit_rpg/inventory/inventory_system.gd"],
      "reason": "RPG subsystem imports another subsystem directly; cross-subsystem references must go through addons/forgekit_rpg/public_api.gd."
    }
  ]
}
```

An empty `violations` array means the project is clean. Each violation
aggregates every offending target from a single file, deduplicated in
first-seen order, so callers act on files rather than individual lines.

### `project.get_settings` — `editor`

Reads `project.godot` from disk on every call (not from the editor's
in-memory copy), so the response always reflects the authoritative
on-disk state.

**Params:**

```json
{ "projectRoot": "<absolute path>", "section": "<optional section name without brackets>" }
```

**Result:** without `section`,
`{ "settings": { "<section>/<key>": "<raw value>", ... } }`; with
`section`, only keys inside that section are returned with the section
prefix stripped. Unknown sections resolve to `{ "settings": {} }`. Values
are returned verbatim — literal strings such as
`PackedStringArray("4.3", "Forward Plus")` are not coerced.

### `project.update_settings` — `editor`

Applies a per-key patch atomically. Writes go through a temp file plus
`fsync` plus `rename`, so a concurrent reader observes either the full
previous contents or the full new contents, never a truncated file. This
is the fix for the classic `events`-overwrite bug that affects naive
`update_project_settings` implementations.

**Params:**

```json
{
  "projectRoot": "<absolute path>",
  "patch": {
    "application/config/name": "\"My Project\"",
    "input/jump": "{ \"deadzone\": 0.5, \"events\": [...] }"
  }
}
```

Values in `patch` are raw INI literals — the caller wraps strings in
quotes and pre-serializes dictionaries. Only keys named in `patch` are
touched; every other section and key is preserved byte-for-byte.

**Result:**

```json
{
  "applied": { "application/config/name": "\"My Project\"" },
  "previous": { "application/config/name": "\"Old Name\"" }
}
```

`previous` reports `null` for keys that did not exist before the call.

### `project.reload` — `editor`

Asks the running editor to rescan the filesystem and reload cached
resources.

**Params:** `{}` (reserved shape; future flags such as `force` can be
added without breaking the contract).

**Result:**

```json
{ "reloaded": true, "duration_ms": 42 }
```

`duration_ms` is wall-clock time between dispatch and reply, rounded to
the nearest millisecond. If the editor WebSocket is not connected, the
tool fails with `ToolInputError` rather than timing out silently.

### `project.list_addons` — `editor`

Enumerates every directory under `addons/` that ships a `plugin.cfg`.

**Params:** `{ "projectRoot": "<absolute path>" }`

**Result:**

```json
{
  "addons": [
    { "id": "forgekit_core", "enabled": true, "path": "addons/forgekit_core" },
    { "id": "gut",            "enabled": true, "path": "addons/gut" }
  ]
}
```

`enabled` is derived from `[editor_plugins] enabled=PackedStringArray(...)`
in `project.godot`. Directories without a `plugin.cfg` are skipped, matching
Godot's own "Plugins" editor list.

## Testing/QA category

All testing tools return a `TestReport` — the canonical JSON shape
emitted by GUT, property, and gameplay runs — defined in
`addons/forgekit_core/testing/test_report.gd` and mirrored on the server
in `@forgekit/core-mcp`.

### `TestReport` shape

```text
TestReport { run_id, timestamp, total, passed, failed, tests[], suggested_action }
TestCase   { name, status, duration_ms, assertions[], failure_message, stack_trace }
Assertion  { description, passed, expected, actual }
```

`status` is one of `"passed"`, `"failed"`, or `"skipped"` (producers
pick the vocabulary). `suggested_action` is empty when `failed == 0`;
otherwise it is one of `inspect_tres`, `validate_gdscript`,
`rerun_test`, `manual_review`.

### `tests.run_unit` — `cli`

Runs GUT against a directory.

**Params:**

```json
{ "path": "tests/unit", "pattern": "<optional GUT test name filter>" }
```

**Result:** `TestReport` (see shape above). A missing or malformed
report combined with a non-zero exit code produces a synthetic failed
report rather than an error, so the self-healing loop always receives a
well-formed `TestReport`.

### `tests.run_suite` — `cli`

Runs a named GUT suite.

**Params:** `{ "suite_name": "<name>" }`

**Result:** `TestReport`.

### `tests.run_gameplay` — `cli`

Launches Godot with `--mcp-bridge` against a scene that drives a gameplay
scenario.

**Params:**

```json
{ "scene_path": "res://tests/gameplay/crafting.tscn", "steps": ["add:iron_ore:2", "craft:iron_ingot"] }
```

`steps` are serialized as a single JSON argv element
(`--mcp-bridge-steps=<json>`) so the scene script reads them via
`OS.get_cmdline_args()` without further parsing.

**Result:** `TestReport`.

### `tests.run_property` — `cli`

Runs property-based tests (CoreFuzz on the Godot side, `fast-check` on
the server side) with configurable iterations and seed.

**Params:**

```json
{ "path": "tests/property/test_event_bus_propagation.gd", "iterations": 100, "seed": 42 }
```

`iterations` defaults to 100 when omitted. Both `iterations` and `seed`
must be integers; the tool rejects non-integer values with
`ToolInputError`.

**Result:** `TestReport` plus an optional `counterexample` field on
failure. The counterexample sits alongside the report rather than
inside it because the canonical `TestReport` schema has no
`counterexample` field.

### `test_report.parse` — `cli`, `editor`

Parses a JSON string into a `TestReport` value.

**Params:** `{ "json": "<serialized TestReport>" }`

**Result:** a `TestReport` value. On any malformed input (non-string
payload, invalid JSON, wrong root type, missing or mistyped field,
non-object entry in `tests[]` or `assertions[]`) the tool raises
`TestReportParseError` with code `TEST_REPORT_PARSE_ERROR`. The error
message identifies the offending field by path, for example
`tests[2].assertions[0].expected is missing.`

### `test_report.serialize` — `cli`, `editor`

Serializes a `TestReport` value to JSON.

**Params:** `{ "report": <TestReport> }`

**Result:** `{ "json": "<serialized TestReport>" }`. Round-trip: for
every valid `TestReport` `r`,
`parseTestReport(serializeTestReport(r).json)` reproduces every field on
`r`, including Unicode strings in `failure_message`, `stack_trace`,
`TestCase.name`, and `Assertion` descriptions.

## Script category (preview)

The following tool ships in v0.1 so that CLI-only clients can validate
GDScript files without spinning up the editor.

### `gdscript.validate` — `cli`, `editor`

Parses a GDScript source string and returns its syntactic diagnostics.

**Params:** `{ "source": "<GDScript source>" }`

**Result:**

```json
{
  "ok": false,
  "errors": [
    { "line": 17, "col": 4, "msg": "Unexpected token 'func'" }
  ]
}
```

The validator completes within 500 ms for files up to 200 KB on a
four-core CPU. A file that parses cleanly returns
`{ "ok": true, "errors": [] }`.

## Beyond v0.1

Tools for Scene, Node, Input, Runtime, Animation, TileMap, Theme,
Batch/Refactor, Shader, Export, Resource, Physics, 3D Scene, Particle,
Navigation, Audio, AnimationTree, State Machine, Blend Tree,
Analysis/Search, Android Deploy, Module Management, Self-Healing, Asset
Generation, and Visualizer ship across later milestones (v0.2 through
v1.0). Each of those tools follows the same JSON-RPC 2.0 envelope and
the same error-code conventions described above. See the design
document for the full inventory and the phase in which each tool lands.
