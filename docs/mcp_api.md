# MCP API

This document describes the tool surface exposed by
`@forgekitstudio/core-mcp`. The v0.1 MVP shapes below are stable from that
milestone onward; Phase 6A adds fourteen editor/CLI-channel tool
categories that bring the full surface to 215 tools across 34
categories, tracked in the design document.

## Tools by category

The table below is the single-source index for every category shipped
through the server. Each entry links to the section that documents
the category in detail.

| Category | Channel(s) | Summary |
| :------- | :--------- | :------ |
| [Project](#project-category) | editor, cli | Project root inspection, module listing, boundary checks, atomic `project.godot` reads/writes, addon enumeration. |
| [Testing / QA](#testingqa-category) | cli | Headless GUT, gameplay, and property-based runs returning a canonical `TestReport`. |
| [Script](#script-category-preview) | cli, editor | GDScript parsing and save-with-validation. |
| [Profiling](#profiling-category) | runtime | Samples from the Godot `Performance` singleton on the running game. |
| [Runtime](#runtime-category) | runtime | Scene-tree introspection and scene control on the running game. |
| [Module management](#module-management-category) | editor, cli | Lifecycle of installed `forgekit_*` modules (list, inspect, compat check, license activation, enable/disable). |
| [Animation](#animation-category) | editor | `AnimationPlayer` introspection and UndoRedo-wrapped track/keyframe edits. |
| [Theme / UI](#theme-and-ui-category-preview) | editor | Theme resources, `Control` hierarchies, layout presets. |
| [Particle](#particle-category) | editor | GPU and CPU particle setup and preview. |
| [Audio](#audio-category) | editor, runtime | Bus configuration plus runtime stream playback. |
| [Blend Tree](#blend-tree-category) | editor | `AnimationNodeBlendTree` graph node configuration. |
| [Export](#export-category) | cli | `export_presets.cfg` inspection and headless exports. |
| [Visualizer](#visualizer-category) | editor | Browser visualizer lifecycle and snapshot endpoints. |
| [Asset Generation](#asset-generation-category) | editor | SVG rasterisation, atlas packing, noise textures, icon sets. |
| [Self-Healing](#self-healing-category) | editor | Inspect failing `.tres` files, suggest actions, bounded retry loop. |
| [Animation (Phase 6A)](#animation-phase-6a) | editor | Phase 6A parity tool sequence for `AnimationPlayer`. |
| [TileMap (Phase 6A)](#tilemap-phase-6a) | editor | TileMap cell and region edits, JSON import/export. |
| [Theme / UI (Phase 6A)](#theme--ui-phase-6a) | editor | Phase 6A theme / UI adapter surface. |
| [Shader (Phase 6A)](#shader-phase-6a) | editor | Shader creation, validation, uniform inspection. |
| [Physics (Phase 6A)](#physics-phase-6a) | editor, runtime | Collision-layer configuration plus runtime spatial queries. |
| [3D Scene (Phase 6A)](#3d-scene-phase-6a) | editor | MeshInstance, lights, camera, environment, glTF import, lightmap baking. |
| [Particle (Phase 6A)](#particle-phase-6a) | editor | Phase 6A particle adapter surface. |
| [Navigation (Phase 6A)](#navigation-phase-6a) | editor, runtime | NavMesh baking, agent setup, runtime pathfinding and debug draw. |
| [Audio (Phase 6A)](#audio-phase-6a) | editor, runtime | Phase 6A audio adapter surface. |
| [AnimationTree (Phase 6A)](#animationtree-phase-6a) | editor | AnimationTree lifecycle and parameter introspection. |
| [State Machine (Phase 6A)](#state-machine-phase-6a) | editor, runtime | `AnimationNodeStateMachinePlayback` control. |
| [Blend Tree (Phase 6A)](#blend-tree-phase-6a) | editor | Phase 6A blend-tree node configuration. |
| [Export (Phase 6A — CLI channel)](#export-phase-6a--cli-channel) | cli | Phase 6A export-preset tools (list, validate, run). |
| [Android Deploy (Phase 6A — CLI channel)](#android-deploy-phase-6a--cli-channel) | cli | `adb` device enumeration, APK install, logcat window. |
| [Observability](#observability) | server | Structured logs, trace/span ids, canonical metric registry. |
| [Health endpoint](#health-endpoint) | server | `/health`, `/metrics`, `/version`, `/trace/:trace_id` HTTP endpoints. |

Additional RPG-domain categories (`combat`, `crafting`, `inventory`,
`stats`, `effects`, `magic`, `equipment`, `progression`, `enemies`,
`loot`, `spawner`, `chests`, `npc`, `dialog`, `vendor`) are documented
alongside the `forgekit_rpg` module in the paid-module repository; the
`modules.activate_license` call unlocks the full set behind a single
`license_id`.

## Known error codes

Every ForgeKit-specific error code uses the negative JSON-RPC server
error range (`-32000` to `-32099`). The table below consolidates the
codes referenced throughout this document; per-tool sections repeat
the relevant entry with the exact `data` payload.

| Code     | Symbol                                   | Channel(s)    | Meaning |
| -------- | ---------------------------------------- | ------------- | ------- |
| `-32004` | `NON_UNDOABLE_OPERATION`                 | editor        | Advisory warning on a successful result when the mutation happens outside `EditorUndoRedoManager`. |
| `-32005` | `PACKET_TOO_LARGE`                       | runtime       | UDP datagram above the 65 507-byte limit. `data` carries `{size, limit, suggestion}`. |
| `-32005` | `MODULE_NOT_FOUND`                       | editor, cli   | A `modules.*` call referenced a `module_id` not installed under `<projectRoot>/addons/`. Shares the numeric code with `PACKET_TOO_LARGE`; disambiguated by channel and by `message`. |
| `-32006` | `license_verification_failed`            | editor, cli   | `modules.activate_license` rejected the supplied signature. `data` carries `{module_id}`. |
| `-32007` | `ACTIVATION_FAILED`                      | editor, cli   | `modules.activate_license` failed for a non-canonical reason (file I/O, HMAC-context error). `data` carries `{module_id, original_error}`. |
| `-32008` | `CORE_VERSION_UNAVAILABLE`               | editor, cli   | `modules.check_compatibility` could not resolve the installed Core version from the repository git tag. `data.reason` is `"git_describe_failed"` or `"git_describe_empty"`. |
| `-32009` | `TRANSACTION_NOT_OPEN`                   | editor        | `transaction.commit` / `transaction.rollback` was called with a `transaction_id` that is not currently open. |
| `-32011` | `MANIFEST_TAG_NOT_FOUND`                 | cli (release) | `manifest.core_min_version` points at a Git tag that does not exist in Core. `data` carries `{tag}`. |
| `-32012` | `CONTEXT_FILE_STALE`                     | cli (hooks)   | `CLAUDE.md` / `.cursorrules` not updated alongside a code change. Raised by the `pre-commit` hook. |
| `-32013` | `CONVENTIONAL_COMMITS_FORMAT_VIOLATION`  | cli (hooks)   | Commit message does not match the Conventional Commits grammar. Raised by the `commit-msg` hook. |
| `-32014` | `PR_TEMPLATE_INCOMPLETE`                 | cli (CI)      | Pull request description is missing one of the four required sections. |
| `-32015` | `WORKSPACE_NOT_FOUND`                    | editor, runtime, cli | `workspace_id` is not registered. `data` carries `{workspace_id}`. |
| `-32016` | `WORKSPACE_ALREADY_REGISTERED`           | editor, cli   | `project.add` was called with a `workspace_id` already mapped to a different record. `data` carries `{workspace_id, existing_workspace}`. |
| `-32017` | `PROJECT_ROOT_ALREADY_REGISTERED`        | editor, cli   | `project.add` was called with a `projectRoot` already owned by another workspace. `data` carries `{projectRoot, existing_workspace_id}`. |
| `-32018` | `INVALID_PROJECT_ROOT`                   | editor, cli   | `projectRoot` failed path validation. `data` carries `{projectRoot, reason}` where `reason ∈ {"not_absolute", "not_a_directory", "missing_project_godot"}`. |
| `-32019` | `WORKSPACE_LIMIT_EXCEEDED`               | editor, cli   | Attempted to register beyond the `MAX_WORKSPACES = 32` limit. `data` carries `{limit, current}`. |
| `-32020` | `PORT_RANGE_EXHAUSTED`                   | editor, runtime | Every port in the range is occupied (between kernel-level binds and ports already taken by sibling workspaces). `data` carries `{channel, range_start, range_end, in_use}`. |
| `-32021` | `NO_ACTIVE_WORKSPACE`                    | editor, runtime, cli | A tool call without `workspace_id` reached the dispatcher while the registry is empty. `data` is `{}`. |
| `-32022` | `WORKSPACE_ROOT_MISMATCH`                | editor, runtime, cli | Explicit `projectRoot` does not match the resolved workspace's registered root. `data` carries `{workspace_id, registered_project_root, requested_project_root}`. |

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
| `-32005` | `PACKET_TOO_LARGE`                 | A UDP datagram arriving on the `runtime` channel exceeds the configured size limit. `data` carries `{ size, limit, suggestion }`, where `size` is the rejected datagram's byte length and `limit` defaults to 65 507 (the IPv4 UDP payload ceiling). |
| `-32005` | `MODULE_NOT_FOUND`                 | A `modules.*` tool was called with a `module_id` that is not present under `<projectRoot>/addons/`. Shares a numeric code with `PACKET_TOO_LARGE` but is disambiguated by `message` and by the originating channel (`editor` / `cli`, not `runtime`). |
| `-32006` | `license_verification_failed`      | `modules.activate_license` rejected the supplied license. `data` carries `{ module_id }`. |
| `-32007` | `ACTIVATION_FAILED`                | `modules.activate_license` failed for a non-canonical reason (file I/O, HMAC-context errors). `data` carries `{ module_id, original_error }`. |
| `-32008` | `CORE_VERSION_UNAVAILABLE`         | `modules.check_compatibility` could not resolve the installed Core version from the repository's git tag. `data.reason` is `"git_describe_failed"` or `"git_describe_empty"`; `data.git_stderr` mirrors git's stderr when present. |
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
diff across calls. `enabled` is `true` for any discoverable module that
has not been disabled through `modules.disable`; the flag is toggled
via the `modules.enable` / `modules.disable` pair documented in the
Module management category below.

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

## Project management (multi-project)

The MCP server owns a per-process `ProjectRegistry` so a single server
instance can serve multiple Godot projects (workspaces) at once.
Workspace state is mirrored to `$HOME/.forgekit/workspaces.json` via
atomic temp-file + rename, so restarting the server restores the exact
same set of workspaces without a rescan. The persistence file carries
a `version: "1.0"` field so future migrations can be handled without
breaking existing on-disk state.

Every mutating tool call accepts an optional `workspace_id` parameter.
When omitted, the dispatcher uses the currently active workspace; when
the registry is empty the dispatcher returns `NO_ACTIVE_WORKSPACE`
(`-32021`). Explicit `projectRoot` continues to work for pre-v0.9.0
clients, but if both are supplied and they diverge the dispatcher
returns `WORKSPACE_ROOT_MISMATCH` (`-32022`).

### Identifier and label rules

- `workspace_id` must match `^[a-z][a-z0-9_-]{0,63}$` — lowercase ASCII,
  kebab or snake case, 1–64 characters, starting with a letter.
- `label` is optional, human-readable, and capped at 120 characters.
- `projectRoot` must be an absolute path to an existing directory that
  contains `project.godot` at the top level.

### Default workspace and backwards compatibility

On startup, if `$HOME/.forgekit/workspaces.json` does not exist, the
server auto-registers a single `default` workspace using the current
working directory (or the nearest ancestor containing
`project.godot`); `label` defaults to the basename of that directory,
and the workspace is marked active. When the working directory is not
a Godot project, the registry starts empty and the first tool call
without `workspace_id` returns `NO_ACTIVE_WORKSPACE`.

A `--cwd <path>` flag on the server process is treated as a shortcut
for `project.add({workspace_id: "default", projectRoot: <path>,
make_active: true})`. Pre-v0.9.0 clients that pass only `projectRoot`
continue to work unchanged — no new `workspace_id` parameter is
required.

All five tools below are `scope: core, channel: editor,
module: core-minimal` — available in every profile including
`Minimal`.

### `project.list_workspaces` — `editor`, `cli`

Read-only enumeration of the registry.

**Params:** `{}`

**Result:**

```json
{
  "workspaces": [
    {
      "workspace_id": "client-a",
      "projectRoot": "/Users/dev/projects/client-a",
      "label": "Client A — RPG game",
      "registered_at": "2026-05-09T19:30:00.000Z",
      "active": true
    }
  ],
  "active_workspace_id": "client-a",
  "limit": 32
}
```

`workspaces` is sorted ascending by `workspace_id`. `limit` is the
hard `MAX_WORKSPACES` ceiling enforced at registration.

### `project.add` — `editor`, `cli`

Register a new workspace. Idempotent: re-adding the same
`(workspace_id, projectRoot, label)` triple returns the existing record
unchanged. Mismatched fields raise `WORKSPACE_ALREADY_REGISTERED`
(`-32016`). Duplicate `projectRoot` under a different `workspace_id`
raises `PROJECT_ROOT_ALREADY_REGISTERED` (`-32017`). `projectRoot`
must be an absolute path pointing at an existing directory that
contains `project.godot`; failures raise `INVALID_PROJECT_ROOT`
(`-32018`). Exceeding the `MAX_WORKSPACES = 32` ceiling raises
`WORKSPACE_LIMIT_EXCEEDED` (`-32019`).

**Params:** `{ "workspace_id": "<id>", "projectRoot": "<absolute path>", "label": "<optional>", "make_active": false }`

**Result:**

```json
{
  "workspace": {
    "workspace_id": "client-a",
    "projectRoot": "/Users/dev/projects/client-a",
    "label": "Client A — RPG game",
    "registered_at": "2026-05-09T19:30:00.000Z",
    "active": true
  }
}
```

When `make_active=true`, the server also calls `setActive` so the new
workspace becomes the default target for tool calls without
`workspace_id`.

### `project.switch` — `editor`, `cli`

Change the active workspace. Idempotent on self-switch. Unknown
`workspace_id` raises `WORKSPACE_NOT_FOUND` (`-32015`).

**Params:** `{ "workspace_id": "<id>" }`

**Result:**

```json
{ "previous_workspace_id": "default", "active_workspace_id": "client-a" }
```

### `project.remove` — `editor`, `cli`

Unregister a workspace. No-op for unknown ids (returns `{removed:
null}`). When the removed workspace was the active one, the server
auto-promotes the most recently registered remaining workspace;
`active_workspace_id` is `null` when the registry becomes empty.

**Params:** `{ "workspace_id": "<id>" }`

**Result:**

```json
{
  "removed": {
    "workspace_id": "client-a",
    "projectRoot": "/Users/dev/projects/client-a",
    "registered_at": "2026-05-09T19:30:00.000Z",
    "active": false
  },
  "active_workspace_id": "internal-demo"
}
```

### `project.get_active` — `editor`, `cli`

Return the currently active workspace.

**Params:** `{}`

**Result:**

```json
{
  "active_workspace_id": "client-a",
  "workspace": {
    "workspace_id": "client-a",
    "projectRoot": "/Users/dev/projects/client-a",
    "registered_at": "2026-05-09T19:30:00.000Z",
    "active": true
  }
}
```

Both fields are `null` when the registry is empty.

## Testing/QA category

All testing tools return a `TestReport` — the canonical JSON shape
emitted by GUT, property, and gameplay runs — defined in
`addons/forgekit_core/testing/test_report.gd` and mirrored on the server
in `@forgekitstudio/core-mcp`.

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

## Profiling category

Tools in the profiling category target the `runtime` channel and return
samples from the Godot `Performance` singleton on the running game.

### `profiling.get_performance_monitors` — `runtime`

Samples the requested `Performance` monitors and returns their current
values.

**Params:**

```json
{ "monitors": ["fps", "draw_calls", "physics_frames"] }
```

`monitors` is optional. When omitted or empty, the runtime bridge
returns the full baseline set, which includes at minimum `fps`,
`draw_calls`, and `physics_frames`. When provided, only the requested
monitors are returned; unknown monitor names are omitted from the
response. Monitor names follow Godot's `Performance` vocabulary
(for example `fps`, `draw_calls`, `physics_frames`, `memory_static`,
`render_total_objects`).

**Result:**

```json
{
  "monitors": {
    "fps": 60.0,
    "draw_calls": 128.0,
    "physics_frames": 60.0
  }
}
```

All monitor values are numbers; integer-valued monitors are returned as
floats so callers never need to branch on the underlying type. The tool
is read-only and safe to call at any frame rate; a single call samples
each requested monitor exactly once.

## Runtime category

Runtime-channel tools drive the live game over the UDP MCP bridge. They
are reachable only while the game is running with `--mcp-bridge`. Each
handler accepts JSON-RPC `params` either by-name (a `Dictionary`) or
by-position (an `Array`); the positional order matches the named
parameters documented below.

### `runtime.get_scene_tree` — `runtime`

Returns a snapshot of the live scene tree rooted at the active scene.
This is the runtime-channel sibling of the editor-channel
`scene.get_tree_snapshot` tool.

**Params:**

```json
{ "max_depth": 2 }
```

`max_depth` is optional. When omitted it defaults to `-1`, meaning no
depth limit. `0` returns the root only, `1` includes its direct
children, and so on. Non-integer values are coerced through the same
param adapter used by the rest of the runtime category.

**Result:**

```json
{
  "tree": {
    "path": "/root/Main",
    "type": "Node",
    "children": []
  }
}
```

Each node in `tree` carries at minimum its absolute `path`, its Godot
`type`, and its `children` array. The tool is read-only and safe to
call at any frame rate.

### `runtime.get_current_scene` — `runtime`

Returns the active scene's filesystem path and its root node path in
the live tree.

**Params:** `{}`

**Result:**

```json
{
  "scene_path": "res://scenes/main.tscn",
  "root_path": "/root/Main"
}
```

`scene_path` is the `res://` path of the active scene resource;
`root_path` is the absolute node path of its root in the running tree.

### `runtime.change_scene` — `runtime`

Requests a scene change in the running game. The game drives the actual
transition through `SceneTree.change_scene_to_file()` on the next
available frame.

**Params:**

```json
{ "scene_path": "res://scenes/other.tscn" }
```

`scene_path` is required and must resolve to an existing `res://` scene
file. Positional form (`["res://scenes/other.tscn"]`) is accepted as an
equivalent shape.

**Result:**

```json
{ "changed": true }
```

The `changed: true` envelope confirms the change request was accepted
by the bridge; the actual scene transition happens asynchronously on
the next frame boundary.

### `runtime.reload_current_scene` — `runtime`

Reloads the active scene in place, preserving the running process.

**Params:** `{}`

**Result:**

```json
{ "reloaded": true }
```

The tool is idempotent from the caller's perspective: successive calls
each trigger a fresh reload of whichever scene is active at call time.

## Module management category

The `modules.*` tool family ships alongside `project.list_modules` and
lets agents inspect installed modules, check Core compatibility,
activate license keys, and toggle module enablement. Together with
`project.list_modules`, these tools are the contract
`docs/SKILLS/module_licensing.md` walks through end-to-end.

All parameters below accept either by-name (`{ ... }`) or by-position
(`[ ... ]`) JSON-RPC params. `projectRoot` is always an absolute path
to the Godot project root.

### `modules.list` — `editor`, `cli`

Enumerates every discovered module under `addons/forgekit_*/` together
with its persisted `enabled` flag and a derived `has_active_license`
flag.

**Params:**

```json
{ "projectRoot": "<absolute path>", "licenseDir": "<absolute path to user://licenses mirror>" }
```

`licenseDir` is the host-side mirror of Godot's `user://licenses/`
directory. The server resolves this path automatically on startup so
typical MCP callers pass through whatever the server supplied.

**Result:**

```json
{
  "modules": [
    {
      "id": "forgekit_rpg",
      "version": "1.0.0",
      "license_id": "forgekit_rpg_eula",
      "core_min_version": "0.7.0",
      "source_repo": "ForgeKitStudio/forgekit-rpg",
      "enabled": true,
      "has_active_license": true
    }
  ]
}
```

`has_active_license` is `true` when a `<module_id>.key` file exists in
`licenseDir`; `false` otherwise. Entries are sorted by `id` in
ascending order for stable diffs across calls.

### `modules.inspect_manifest` — `editor`, `cli`

Returns the full manifest of a single installed module plus the
absolute `manifest_path` that was read.

**Params:** `{ "projectRoot": "<absolute path>", "moduleId": "<id>" }`

**Result:**

```json
{
  "id": "forgekit_rpg",
  "version": "1.0.0",
  "core_min_version": "0.7.0",
  "depends_on": [],
  "license_id": "forgekit_rpg_eula",
  "source_repo": "ForgeKitStudio/forgekit-rpg",
  "manifest_path": "/abs/path/addons/forgekit_rpg/module.manifest.tres"
}
```

An unknown `moduleId` raises `MODULE_NOT_FOUND` (`-32005`).

### `modules.check_compatibility` — `editor`, `cli`

Compares a module's `core_min_version` to the Core version resolved
from the repository's git tag at `projectRoot`. SemVer pre-release and
build metadata are stripped before comparison because ForgeKit
manifests do not use them.

**Params:** `{ "projectRoot": "<absolute path>", "moduleId": "<id>" }`

**Result:**

```json
{
  "compatible": true,
  "core_version": "0.7.0",
  "core_min_version": "0.7.0",
  "module_id": "forgekit_rpg"
}
```

When `compatible` is `false` the response includes a human-readable
`reason` field (for example `"core_version 0.6.0 < core_min_version
0.7.0"`), and the server emits a `CORE_VERSION_MISMATCH` warning
through its logger with the same `module_id`, `core_min_version`, and
`core_version` values so operators can see the mismatch in the log
stream without re-reading the manifest.

Errors:

- `MODULE_NOT_FOUND` (`-32005`) — `moduleId` is not installed.
- `CORE_VERSION_UNAVAILABLE` (`-32008`) — git could not resolve a tag
  at `projectRoot`. `data.reason` is `"git_describe_failed"` or
  `"git_describe_empty"`.

### `modules.activate_license` — `editor`, `cli`

Activates a license key and persists the activation record. The actual
persistence runs inside Godot through the GDScript `LicenseStore`; the
server-side tool accepts a pluggable `activator` whose signature
mirrors the store's HMAC-SHA256 verifier.

**Params:**

```json
{
  "moduleId": "forgekit_rpg",
  "licenseId": "forgekit_rpg_eula",
  "signature": "<HMAC-SHA256 signature issued by the publisher>"
}
```

**Result (success):**

```json
{
  "activated": true,
  "module_id": "forgekit_rpg",
  "record": {
    "license_id": "forgekit_rpg_eula",
    "activated_at": "2026-05-09T12:34:56Z",
    "fingerprint": "<machine fingerprint>"
  },
  "path": "<abs path to user://licenses/forgekit_rpg.key>"
}
```

Errors:

- `license_verification_failed` (`-32006`) — the HMAC signature did
  not verify. `data.module_id` identifies the module.
- `ACTIVATION_FAILED` (`-32007`) — activation failed for a
  non-canonical reason (file I/O, HMAC-context start error). The
  original failure string is forwarded verbatim as
  `data.original_error` so operators can diagnose host-specific
  breakage without the code being rebundled under the canonical
  verification-failed code.

### `modules.enable` / `modules.disable` — `editor`, `cli`

Flips the persisted `enabled` flag for an installed module. The flag
is stored in `<projectRoot>/.forgekit/modules_state.json`, which is
written atomically (sibling `.tmp` file + rename) so concurrent
readers never observe a truncated file.

**Params:** `{ "projectRoot": "<absolute path>", "moduleId": "<id>" }`

**Result:**

```json
{ "module_id": "forgekit_rpg", "enabled": true }
```

`modules.disable` returns the same shape with `"enabled": false`.
Calling either tool for a module that is already in the requested
state is a no-op. An unknown `moduleId` raises `MODULE_NOT_FOUND`
(`-32005`).

### Licenses and tool exposure

On startup the server reads every `<module_id>.key` file under
`licenseDir` and derives the set of tool categories to expose beyond
the base profile. Today a single `forgekit_rpg` license record unlocks
fifteen RPG subsystem categories — `combat`, `crafting`, `inventory`,
`stats`, `effects`, `magic`, `equipment`, `progression`, `enemies`,
`loot`, `spawner`, `chests`, `npc`, `dialog`, `vendor` — in the
`RPG-only` profile and in `Full`. Malformed or unknown `.key` files
are skipped with a warning; the server never fails to start because
of licensing.

## Animation category

The `animation.*` tools drive an `AnimationPlayer` through the editor
plugin. All six tools live on the `editor` channel under the `core`
module. Each handler accepts JSON-RPC `params` either by-name
(a `Dictionary`) or by-position (an `Array`); the positional order
matches the named parameters documented below. The three mutating
tools — `add_track`, `insert_keyframe`, `remove_track` — route their
change through `EditorUndoRedoManager`, so a single `Ctrl+Z` reverts
the agent's edit.

### `animation.list(player_path)`

- **Params:** `{ "player_path": "<node path to AnimationPlayer>" }`.
- **Result:** `{ "animations": [{ "name", "length", "loop_mode" }, ...] }`.

### `animation.play(player_path, name, speed?)`

- **Params:**
  - `player_path` (string, required) — node path to the
    `AnimationPlayer`.
  - `name` (string, required) — animation name to play.
  - `speed` (optional float, default `1.0`) — playback scale.
- **Result:** `{ "playing": true, "name": "<name>" }`.

### `animation.stop(player_path)`

- **Params:** `{ "player_path": "<node path>" }`.
- **Result:** `{ "stopped": true }`.

### `animation.add_track(player_path, animation_name, track_type, path)`

- **Params:**
  - `player_path` (string, required).
  - `animation_name` (string, required).
  - `track_type` (string, required) — Godot animation track type name
    (for example `"value"`, `"position_3d"`, `"rotation_3d"`,
    `"method"`).
  - `path` (string, required) — node / property path targeted by the
    new track.
- **Result:** `{ "track_index": <int> }`.
- **Undo/Redo:** change is wrapped in a single
  `EditorUndoRedoManager` action.

### `animation.insert_keyframe(player_path, animation_name, track, time, value)`

- **Params:**
  - `player_path`, `animation_name` (string, required).
  - `track` (int, required) — target track index.
  - `time` (float, required) — keyframe time in seconds.
  - `value` (any, required) — keyframe value, forwarded verbatim to
    the backend.
- **Result:** `{ "keyframe_index": <int> }`.
- **Undo/Redo:** change is wrapped in a single
  `EditorUndoRedoManager` action.

### `animation.remove_track(player_path, animation_name, track_index)`

- **Params:**
  - `player_path`, `animation_name` (string, required).
  - `track_index` (int, required).
- **Result:** `{ "removed": true }`.
- **Undo/Redo:** change is wrapped in a single
  `EditorUndoRedoManager` action.

## Theme and UI category (preview)

The `theme.*` and `ui.*` tools let an agent create and mutate Godot
`Theme` resources and build `Control` hierarchies through the editor
plugin. Every mutation flows through `McpUndoRedoWrapper`, so a single
`Ctrl+Z` in the editor reverts the agent's change.

All six preview tools run on the `editor` channel under the `core`
module.

### `theme.create(path)`

Creates a new `Theme` resource at `path`.

- **Params:**
  - `path` (string, required) — `res://` path where the new `Theme`
    resource is written.
- **Undo/Redo:** change is wrapped in a single
  `EditorUndoRedoManager` action.

### `theme.set_default_font(path, font_path, size)`

Sets the default font and font size on the `Theme` at `path`.

- **Params:**
  - `path` (string, required) — `res://` path of the target `Theme`
    resource.
  - `font_path` (string, required) — `res://` path of the font file
    (`.ttf`, `.otf`, or `.fnt`).
  - `size` (int, required) — font size in pixels.
- **Undo/Redo:** change is wrapped in a single
  `EditorUndoRedoManager` action.

### `theme.set_color(path, class_name, color_name, value)`

Sets a color entry on a theme class.

- **Params:**
  - `path` (string, required) — `res://` path of the target `Theme`.
  - `class_name` (string, required) — theme class name, for example
    `"Button"` or `"Label"`.
  - `color_name` (string, required) — color entry name, for example
    `"font_color"`.
  - `value` (any, required) — color value. The adapter forwards
    `value` verbatim to the backend, which resolves string literals
    such as `"#ff0000"` or `"Color(1,0,0,1)"` through Smart_Type_Parser
    without evaluating arbitrary GDScript.
- **Undo/Redo:** change is wrapped in a single
  `EditorUndoRedoManager` action.

### `theme.set_stylebox(path, class_name, stylebox_name, stylebox_resource_path)`

Binds a `StyleBox` resource to a theme class entry.

- **Params:**
  - `path` (string, required) — `res://` path of the target `Theme`.
  - `class_name` (string, required) — theme class name.
  - `stylebox_name` (string, required) — stylebox entry name, for
    example `"panel"` or `"normal"`.
  - `stylebox_resource_path` (string, required) — `res://` path of the
    `StyleBox` resource to bind.
- **Undo/Redo:** change is wrapped in a single
  `EditorUndoRedoManager` action.

### `ui.build_control_tree(scene_path, spec)`

Builds a `Control` hierarchy inside the scene at `scene_path` from a
declarative spec.

- **Params:**
  - `scene_path` (string, required) — `res://` path of the target
    scene.
  - `spec` (object, required) — declarative `Control` tree. The
    adapter forwards `spec` verbatim to the backend, which materializes
    the nodes in a single UndoRedo action.
- **Undo/Redo:** change is wrapped in a single
  `EditorUndoRedoManager` action.

### `ui.apply_layout_preset(node_path, preset)`

Applies a built-in layout preset to a `Control` node.

- **Params:**
  - `node_path` (string, required) — absolute scene-tree path of the
    target `Control`.
  - `preset` (string, required) — layout preset identifier, for
    example `"full_rect"` or `"center"`.
- **Undo/Redo:** change is wrapped in a single
  `EditorUndoRedoManager` action.

## Particle category

The `particle.*` tools drive GPU- and CPU-based particle systems
through the editor plugin. All five tools live on the `editor` channel
under the `core` module. Each handler accepts JSON-RPC `params` either
by-name (a `Dictionary`) or by-position (an `Array`); the positional
order matches the named parameters documented below. The four mutating
tools — `create_gpu`, `create_cpu`, `set_emission_shape`,
`convert_cpu_to_gpu` — route their change through
`EditorUndoRedoManager`, so a single `Ctrl+Z` reverts the agent's edit.

### `particle.create_gpu(scene_path, parent_path, transform?)`

- **Params:**
  - `scene_path` (string, required) — `res://` path of the target
    scene.
  - `parent_path` (string, required) — absolute scene-tree path of the
    parent node that receives the new `GPUParticles3D` child.
  - `transform` (optional) — forwarded verbatim to the backend when
    present; omit to use the default transform.
- **Result:** `{ "node_path": "<absolute path of the new node>" }`.
- **Undo/Redo:** change is wrapped in a single
  `EditorUndoRedoManager` action.

### `particle.create_cpu(scene_path, parent_path, transform?)`

- **Params:** same shape as `particle.create_gpu`, but the created
  child is a `CPUParticles3D`.
- **Result:** `{ "node_path": "<absolute path of the new node>" }`.
- **Undo/Redo:** change is wrapped in a single
  `EditorUndoRedoManager` action.

### `particle.set_emission_shape(material_path, shape, params)`

Sets the emission shape on a particle process material.

- **Params:**
  - `material_path` (string, required) — `res://` path of the target
    particle process material.
  - `shape` (string, required) — emission shape identifier (for example
    `"sphere"`, `"box"`, `"points"`).
  - `params` (object, required) — shape-specific parameters (for
    example `{"radius": 2.0}` for `"sphere"`). Forwarded verbatim to
    the backend.
- **Result:** `{ "applied": true }`.
- **Undo/Redo:** change is wrapped in a single
  `EditorUndoRedoManager` action.

### `particle.preview_in_editor(node_path, duration?)`

Triggers a fire-and-forget preview of a particle node inside the
editor viewport.

- **Params:**
  - `node_path` (string, required) — absolute scene-tree path of the
    particle node to preview.
  - `duration` (optional int, default `2000`) — preview duration in
    milliseconds.
- **Result:** `{ "previewing": true, "duration_ms": <int> }`. The
  backend returns immediately after scheduling the preview timer; it
  does not block for `duration` ms.
- **Undo/Redo:** none — preview does not mutate scene or resource
  state.

### `particle.convert_cpu_to_gpu(node_path)`

Converts an existing `CPUParticles3D` node to a `GPUParticles3D`
equivalent, preserving transform and emission properties where they
map across types.

- **Params:**
  - `node_path` (string, required) — absolute scene-tree path of the
    `CPUParticles3D` node to convert.
- **Result:** `{ "new_node_path": "<absolute path of the replacement node>" }`.
- **Undo/Redo:** change is wrapped in a single
  `EditorUndoRedoManager` action.

## Audio category

The `audio.*` tools let an agent inspect and mutate the project's audio
bus layout and import sound assets through the editor plugin. The four
editor-channel tools documented below live on the `editor` channel
under the `core` module. Each handler accepts JSON-RPC `params` either
by-name (a `Dictionary`) or by-position (an `Array`); the positional
order matches the named parameters documented below. The three
mutating tools — `set_bus_volume_db`, `add_bus_effect`, `import_sound`
— route their change through `EditorUndoRedoManager`, so a single
`Ctrl+Z` reverts the agent's edit.

Two additional runtime-channel audio tools, `audio.play_stream` and
`audio.stop_stream`, live on the runtime dispatcher and are documented
in the Runtime category.

### `audio.list_buses()`

Lists the project's audio buses.

- **Params:** none (empty object or array accepted).
- **Result:** `{ "buses": [ ... ] }`. Each bus entry is forwarded
  verbatim from the backend and typically exposes at minimum the bus
  name, volume in decibels, and the chain of effects bound to it.

### `audio.set_bus_volume_db(bus_name, db)`

Sets the volume of an audio bus.

- **Params:**
  - `bus_name` (string, required) — name of the target audio bus.
  - `db` (float, required) — new volume in decibels. Integer values
    are accepted and coerced to float.
- **Undo/Redo:** change is wrapped in a single
  `EditorUndoRedoManager` action.

### `audio.add_bus_effect(bus_name, effect_type, params?)`

Adds an audio effect to an audio bus.

- **Params:**
  - `bus_name` (string, required) — name of the target audio bus.
  - `effect_type` (string, required) — effect identifier drawn from
    Godot's `AudioEffect` subclass list. Common values include
    `"reverb"`, `"chorus"`, `"delay"`, `"compressor"`, and `"eq"`; the
    backend validates the full set.
  - `params` (object, optional) — effect-specific parameters forwarded
    verbatim to the backend. Defaults to `{}` when omitted.
- **Undo/Redo:** change is wrapped in a single
  `EditorUndoRedoManager` action.

### `audio.import_sound(source_path, target_path, import_flags?)`

Imports a sound file into the project.

- **Params:**
  - `source_path` (string, required) — absolute filesystem path of the
    source audio file.
  - `target_path` (string, required) — `res://` path where the imported
    resource is written.
  - `import_flags` (object, optional) — import options forwarded
    verbatim to the backend (for example loop and compression flags).
    Defaults to `{}` when omitted.
- **Undo/Redo:** change is wrapped in a single
  `EditorUndoRedoManager` action.

## Blend Tree category

The `blend_tree.*` tool lets an agent configure an individual node
inside an `AnimationNodeBlendTree` resource owned by an
`AnimationTree`. The single tool lives on the `editor` channel under
the `core` module. The handler accepts JSON-RPC `params` either
by-name (a `Dictionary`) or by-position (an `Array`); the positional
order matches the named parameters documented below. The mutation
routes through `EditorUndoRedoManager`, so a single `Ctrl+Z` reverts
the agent's edit.

### `blend_tree.configure_node(tree_path, node_id, type, params?)`

Configures a node inside the blend tree attached to an
`AnimationTree`.

- **Params:**
  - `tree_path` (string, required) — absolute scene-tree path of the
    target `AnimationTree`.
  - `node_id` (string, required) — identifier of the blend-tree node
    to configure.
  - `type` (string, required) — `AnimationNode` subclass name, for
    example `"Blend2"`, `"Blend3"`, `"BlendSpace1D"`, or
    `"Animation"`.
  - `params` (object, optional) — node-specific configuration
    forwarded verbatim to the backend. Defaults to `{}` when omitted.
- **Result:** `{ "applied": true }`.
- **Undo/Redo:** change is wrapped in a single
  `EditorUndoRedoManager` action.

## Export category

The `export.*` tools expose Godot's export pipeline to headless clients.
All three tools live on the `cli` channel under the `core` module.
Each tool reads `export_presets.cfg` from the project root (override via
the optional `project_root` parameter) and fails with
`EXPORT_PRESETS_FILE_MISSING` when the file is absent.

### `export.list_presets` — `cli`

Enumerates the presets defined in `export_presets.cfg`.

**Params:**

```json
{ "project_root": "<optional absolute path>" }
```

`project_root` defaults to the server's working directory when omitted.

**Result:**

```json
{
  "presets": [
    {
      "name": "Windows Desktop",
      "platform": "Windows Desktop",
      "runnable": true,
      "export_path": "dist/game.exe"
    }
  ]
}
```

Presets are returned in the order in which they appear in
`export_presets.cfg` (by ascending `preset.<index>` section). Only the
top-level preset keys are parsed; nested sections such as
`[preset.0.options]` are ignored.

**Errors:**

- `EXPORT_PRESETS_FILE_MISSING` — `export_presets.cfg` was not found at
  the resolved path.

### `export.run_preset` — `cli`

Spawns `godot --headless --export-release <preset> <output>` (or
`--export-debug` when `debug=true`) and captures stdout/stderr into a
timestamped log under `user://export_logs/`.

**Params:**

```json
{
  "preset_name": "Windows Desktop",
  "output_path": "dist/game.exe",
  "debug": false
}
```

`preset_name` and `output_path` are required and must be non-empty
strings; blank values are rejected with `ToolInputError`. `debug`
defaults to `false` (release export).

**Result:**

```json
{
  "success": true,
  "log_path": "user://export_logs/export-2026-05-09T12-34-56-000Z.log",
  "artifact_path": "dist/game.exe"
}
```

`success` is `true` when Godot exits with code `0`. The log file always
contains both the stdout and stderr streams, prefixed by `stdout:` and
`stderr:` headers, so the self-healing loop can inspect failures
without re-running the export.

### `export.validate_preset` — `cli`

Statically validates that a preset declared in `export_presets.cfg`
carries the fields required to run an export (`name`, `platform`,
`export_path`).

**Params:**

```json
{
  "preset_name": "Windows Desktop",
  "project_root": "<optional absolute path>"
}
```

**Result:**

```json
{
  "valid": true,
  "errors": []
}
```

On failure, `valid` is `false` and `errors` lists every offending
field:

```json
{
  "valid": false,
  "errors": [
    { "field": "export_path", "reason": "export_path is empty" }
  ]
}
```

When `preset_name` does not match any preset in the file, the tool
returns a single error with `field: "preset_name"` and `reason`
identifying the missing preset. `runnable` is not validated because
non-runnable presets are legal in Godot. This tool is read-only and
does not spawn a Godot process — use it as a fast pre-flight before
`export.run_preset`.

## Beyond v0.1

Tools for Scene, Node, Input, Runtime, Batch/Refactor, Resource,
Analysis/Search, Progression, Enemies, Loot, Spawner, World, NPC,
Dialog, and Vendor ship across later milestones (v0.2 through v1.0).
Each of those tools follows the same JSON-RPC 2.0 envelope and the
same error-code conventions described above. See the design document
for the full inventory and the phase in which each tool lands.

## Profiling category

Two runtime-channel tools surface frame-level performance telemetry from
the live game to clients that hold the MCP Runtime Bridge connection.
Both tools require the game to have been launched with `--mcp-bridge`.

### `profiling.get_frame_stats` — `runtime`

Returns percentile-summarized frame times and the current draw-call
count over a rolling window of the most recent frames captured by the
MCP Runtime Bridge.

**Params:**

```json
{ "window_frames": 120 }
```

`window_frames` is optional. When omitted the bridge uses a default of
120 (≈2 seconds at 60 fps). The value must be a positive integer; zero,
negative, non-integer, or non-numeric values are rejected with
`INVALID_ARGUMENT`.

**Result:**

```json
{
  "window_frames": 120,
  "samples": 120,
  "frame_time_ms": { "p50": 16.5, "p95": 19.0, "p99": 22.0 },
  "draw_calls": 742
}
```

- `window_frames` echoes the requested window size.
- `samples` is the actual number of frames present in the ring buffer at
  call time. During the first `window_frames` frames after `--mcp-bridge`
  startup, `samples` is less than `window_frames`; from then on the two
  are equal.
- `frame_time_ms.pXX` are nearest-rank percentiles (ms) of the buffered
  frame times. When `samples == 0` all three values are `0.0`.
- `draw_calls` is the latest sample from the Godot `Performance`
  `RENDER_TOTAL_DRAW_CALLS_IN_FRAME` monitor.

## Visualizer category

The `visualizer.*` tools expose the browser-based scene / module /
event-bus inspector. The underlying HTTP server binds the first free
TCP port in `6030-6039` on `127.0.0.1`, serves a force-directed-graph
HTML page at `/`, and exposes three JSON endpoints: `/api/scene_tree`,
`/api/module_graph`, `/api/event_bus`. The editor plugin opens the page
automatically on first use.

### `visualizer.start(port?)`

- **Channel:** `editor`. **Module:** `core`.
- **Params:**
  - `port` (optional int) — when provided, the server binds exactly that
    port instead of scanning the `6030-6039` range. Useful for tests and
    for CI environments with a fixed port budget.
- **Result:**
  - `url` — `http://127.0.0.1:<port>`.
  - `port` — the chosen port.
  - `already_running` (optional bool) — `true` when a previous call has
    already started the server and the port is still bound.

### `visualizer.stop()`

- **Channel:** `editor`. **Module:** `core`.
- **Params:** `{}`.
- **Result:** `{"stopped": true}`. Releases the TCP port and erases the
  `visualizer` entry in `user://mcp_active_port.json`.

### `visualizer.render_scene_tree(scene_path?, format?)`

- **Channel:** `editor`. **Module:** `core`.
- **Params:**
  - `scene_path` (optional string) — reserved for forward compatibility.
    The current implementation ignores this field and serializes the
    editor's active scene via the injected scene provider.
  - `format` (optional string) — `"json"` (default) or `"svg"`.
- **Result (json):** `{nodes: [{id, label, type}], edges: [{from, to}], truncated?}`.
- **Result (svg):** `{svg: "<svg ...>..."}`, rendered on a simple grid
  layout without running the force-directed engine.

### `visualizer.render_module_graph(format?)`

- **Channel:** `editor`. **Module:** `core`.
- **Params:**
  - `format` (optional string) — `"json"` or `"svg"`.
- **Result (json):** `{nodes: [{id, version, depends_on}], edges: [{from, to}], truncated?}`.
  Each edge points from a dependent module to the module it depends on.

### `visualizer.render_event_bus(format?)`

- **Channel:** `editor`. **Module:** `core`.
- **Params:**
  - `format` (optional string) — `"json"` or `"svg"`.
- **Result (json):** `{signals: [{name, payload_types, subscribers: [{object_id, object_class, method}]}], truncated?}`.

## Asset Generation category

The `assetgen.*` tools generate graphical assets through the editor
plugin. Every write is routed through `McpUndoRedoWrapper` so a single
Ctrl+Z reverts the file. All four tools live on the `editor` channel
under the `core` module.

### `assetgen.sprite_from_svg(svg_source, target_path, size?)`

- **Params:**
  - `svg_source` (string, required) — SVG source text.
  - `target_path` (string, required) — `res://` path of the PNG to write.
  - `size` (optional int, default `64`) — edge length in pixels.
- **Result:** `{target_path, size}`.
- **Error:** `SVG_RASTERIZE_FAILED` when the SVG source does not parse.

### `assetgen.atlas_pack(source_paths, target_path, max_size?)`

- **Params:**
  - `source_paths` (array of string, required) — `res://` paths of the
    source PNGs to pack.
  - `target_path` (string, required) — `res://` path of the atlas PNG.
  - `max_size` (optional int, default `1024`) — maximum atlas edge
    length. Images that exceed this budget abort the pack with
    `ATLAS_PACK_FAILED`.
- **Result:** `{target_path, tres_path, placements: [{index, x, y, width, height}]}`.
  The sibling `<target>.atlas.tres` is saved alongside the atlas PNG
  inside the same UndoRedo action so Ctrl+Z reverts both files
  atomically.
- **Error:** `ASSET_LOAD_FAILED` when any source path cannot be loaded.

### `assetgen.noise_texture(target_path, width, height, noise_type, seed?)`

- **Params:**
  - `target_path` (string, required).
  - `width`, `height` (int, required).
  - `noise_type` (string, required) — `"perlin"`, `"simplex"`, or
    `"cellular"`. Unknown values fall back to `"perlin"` with a
    warning.
  - `seed` (optional int, default `0` meaning randomize) — when
    `seed == 0` the adapter calls `RandomNumberGenerator.randomize()`
    and returns the chosen seed in the response so the texture can be
    reproduced.
- **Result:** `{target_path, width, height, noise_type, seed}`.

### `assetgen.icon_set(source_svg, target_dir, sizes)`

- **Params:**
  - `source_svg` (string, required).
  - `target_dir` (string, required) — `res://` directory that receives
    one PNG per size.
  - `sizes` (array of int, required).
- **Result:** `{target_dir, targets: [{size, path}]}`. Each PNG is saved
  as `<target_dir>/<size>.png` inside its own UndoRedo action so
  individual sizes can be rolled back.

## Self-Healing category

The `healing.*` tools let the AI agent reason about test failures and
attempt repairs with a bounded retry budget. Retry state is kept in
memory for the editor session and resets on every editor restart.

`ALLOWED_SUGGESTED_ACTIONS = {"inspect_tres", "validate_gdscript",
"rerun_test", "manual_review"}`.

### `healing.suggest_action(report)`

- **Channel:** `editor`. **Module:** `core`.
- **Params:** `{report: {status, failure_message?, resource_path?}}`.
- **Result:** `{suggested_action}` where `suggested_action` is drawn
  from the allowed set.
- **Rule set** (first match wins, except when retry budget is
  exhausted):
  - `failure_message` contains `.tres` or `ext_resource` →
    `inspect_tres`.
  - `failure_message` contains `parse error` or `unexpected token` →
    `validate_gdscript`.
  - `failure_message` contains `timeout`, `timed out`, or `flaky` →
    `rerun_test`.
  - Otherwise → `manual_review`.
- **Retry escalation (Property 22):** when the retry counter for
  `resource_path` is at or above the limit of 3, the rule set is
  bypassed and the response is always `{"suggested_action": "manual_review"}`.

### `healing.inspect_failure(report_or_message)`

- **Params:** `{report: string | TestReport}`.
- **Result:** `{root_cause, candidates: [{category, suggestion, confidence}]}`.
  `confidence` is a float in `[0.0, 1.0]`. At least one candidate is
  always returned; an unclassified failure falls back to an
  `investigate` candidate so the agent sees some guidance.

### `healing.get_retry_count(resource_path)`

- **Params:** `{resource_path: string}`.
- **Result:** `{attempts, limit: 3}`.

### `healing.reset_retry_count(resource_path)`

- **Params:** `{resource_path: string}`.
- **Result:** `{ok: true}`. Clears the `retry_exhausted` latch so the
  signal can refire on the next exhaustion.

### `healing.apply_and_retest(fix, test_command)`

- **Params:**
  - `fix` (object, required) — forwarded to the editor backend's
    `apply_fix(path, fix)` method. The `path` field of `fix` must be a
    valid `res://` path.
  - `test_command` (string, required) — shell command forwarded to the
    injected test runner.
- **Result:** `{applied, test_status, retries_remaining}` where
  `retries_remaining = limit - attempts_after_this_call`. On a failed
  test run the retry counter is advanced and the `mcp.healing.retries`
  counter increments through the injected metrics sink.


## Animation (Phase 6A)

Six editor-channel tools for driving `AnimationPlayer` nodes and the
underlying `Animation` resources. All three mutating tools flow through
`McpUndoRedoWrapper` so a single Ctrl+Z reverts the AI-driven change.

### `animation.list(player_path)`

- **Params:** `{player_path: string}`.
- **Result:** `{animations: [{name, length, loop_mode}]}`.

### `animation.play(player_path, name, speed?)`

- **Params:** `{player_path, name, speed?: float = 1.0}`.
- **Result:** `{playing: true, name}`.

### `animation.stop(player_path)`

- **Params:** `{player_path}`.
- **Result:** `{stopped: true}`.

### `animation.add_track(player_path, animation_name, track_type, path)`

- **Params:** `{player_path, animation_name, track_type, path}`.
- **Result:** `{track_index}`. UndoRedo-wrapped.

### `animation.insert_keyframe(player_path, animation_name, track, time, value)`

- **Params:** `{player_path, animation_name, track: int, time: float, value}`.
- **Result:** `{keyframe_index}`. UndoRedo-wrapped.

### `animation.remove_track(player_path, animation_name, track_index)`

- **Params:** `{player_path, animation_name, track_index: int}`.
- **Result:** `{removed: true}`. UndoRedo-wrapped.

## TileMap (Phase 6A)

Six editor-channel tools for authoring TileMap layers. Five mutating
tools are UndoRedo-wrapped; `tilemap.get_cell` and
`tilemap.export_to_json` are read-only.

### `tilemap.set_cell(node_path, layer, coords, source_id?, atlas_coords?)`

- **Params:** `{node_path, layer: int, coords: [x, y], source_id?: int = -1, atlas_coords?: [x, y]}`.
- **Result:** `{set: true}`. UndoRedo-wrapped. `source_id = -1` erases the cell.

### `tilemap.get_cell(node_path, layer, coords)`

- **Params:** `{node_path, layer, coords}`.
- **Result:** `{source_id, atlas_coords}`.

### `tilemap.fill_rect(node_path, layer, rect, source_id, atlas_coords)`

- **Params:** `{node_path, layer, rect: [x, y, w, h], source_id, atlas_coords}`.
- **Result:** `{cells_written}`. UndoRedo-wrapped.

### `tilemap.clear_layer(node_path, layer)`

- **Params:** `{node_path, layer}`.
- **Result:** `{cleared: true}`. UndoRedo-wrapped.

### `tilemap.import_from_json(node_path, json_path)`

- **Params:** `{node_path, json_path}`.
- **Result:** `{imported_cells}`. UndoRedo-wrapped.

### `tilemap.export_to_json(node_path, target_path)`

- **Params:** `{node_path, target_path}`.
- **Result:** `{target_path, bytes_written}`.

## Theme / UI (Phase 6A)

Four Theme tools plus two UI layout tools. Every mutation flows through
`McpUndoRedoWrapper`.

### `theme.create(path)`

- **Params:** `{path}` — absolute `res://` path for the new `.tres` theme.
- **Result:** `{path}`.

### `theme.set_default_font(path, font_path, size)`

- **Params:** `{path, font_path, size: int}`.
- **Result:** `{applied: true}`.

### `theme.set_color(path, class_name, color_name, value)`

- **Params:** `{path, class_name, color_name, value}`. `value` is forwarded verbatim; the backend routes strings like `"#ff0000"` or `"Color(1,0,0)"` through Smart_Type_Parser.
- **Result:** `{applied: true}`.

### `theme.set_stylebox(path, class_name, stylebox_name, stylebox_resource_path)`

- **Params:** `{path, class_name, stylebox_name, stylebox_resource_path}`.
- **Result:** `{applied: true}`.

### `ui.build_control_tree(scene_path, spec)`

- **Params:** `{scene_path, spec: Dictionary}`. `spec` is a recursive
  Dictionary `{type, name?, properties?, children?: [...]}` describing
  the Control hierarchy.
- **Result:** `{root_path}`.

### `ui.apply_layout_preset(node_path, preset)`

- **Params:** `{node_path, preset}`. `preset ∈ {top_left, top_right, bottom_left, bottom_right, center, center_left, center_top, center_right, center_bottom, top_wide, left_wide, right_wide, bottom_wide, vcenter_wide, hcenter_wide, full_rect}`.
- **Result:** `{applied: true, preset}`.

## Shader (Phase 6A)

Six editor-channel tools for creating, validating, and configuring
shaders. Four mutating tools are UndoRedo-wrapped; `shader.validate` and
`shader.list_uniforms` are read-only.

### `shader.create(path, template?)`

- **Params:** `{path, template?: "canvas_item" | "spatial" | "particles" = "canvas_item"}`.
- **Result:** `{path}`. UndoRedo-wrapped.

### `shader.validate(source)`

- **Params:** `{source}`.
- **Result:** `{ok: bool, errors: [{line, col, msg}]}`.

### `shader.save_with_validation(path, source)`

- **Params:** `{path, source}`.
- **Result:** `{path, size_bytes}` on success; an `INVALID_LITERAL`-shaped error envelope when validation fails. UndoRedo-wrapped when validation succeeds.

### `shader.set_uniform(material_path, uniform, value)`

- **Params:** `{material_path, uniform, value}`. `value` forwarded verbatim (Smart_Type_Parser).
- **Result:** `{applied: true}`. UndoRedo-wrapped.

### `shader.list_uniforms(material_path)`

- **Params:** `{material_path}`.
- **Result:** `{uniforms: [{name, type, default_value}]}`.

### `shader.convert_visual_to_text(visual_shader_path, target_path)`

- **Params:** `{visual_shader_path, target_path}`.
- **Result:** `{target_path}`. UndoRedo-wrapped.

## Physics (Phase 6A)

Six tools split across editor and runtime channels:

**Editor channel** (atomic `project.godot` writes via
`McpProjectSettingsAtomicWriter`):

### `physics.set_gravity(vector)`

- **Params:** `{vector: [x, y, z]}`.
- **Result:** `{applied: true}`.

### `physics.get_collision_layer_names()`

- **Result:** `{layers: [{index, name}]}`.

### `physics.configure_layer(index, name, mask?)`

- **Params:** `{index, name, mask?: int = 0}`.
- **Result:** `{applied: true}`.

**Runtime channel** (requires `--mcp-bridge`, queries
`PhysicsDirectSpaceState`):

### `physics.raycast(from, to, collision_mask?, exclude?)`

- **Params:** `{from, to, collision_mask?: int = 0xFFFFFFFF, exclude?: [node_path, ...]}`.
- **Result:** `{hit, position, normal, collider_path}`.

### `physics.shape_cast(shape, from, motion, collision_mask?)`

- **Params:** `{shape, from, motion, collision_mask?: int = 0xFFFFFFFF}`.
- **Result:** `{hits: [{position, normal, collider_path}]}`.

### `physics.query_point(position, collision_mask?)`

- **Params:** `{position, collision_mask?: int = 0xFFFFFFFF}`.
- **Result:** `{collider_paths}`.

## 3D Scene (Phase 6A)

Six editor-channel tools for constructing 3D scenes. Five mutating tools
are UndoRedo-wrapped; `scene3d.bake_lightmap` surfaces the outcome of a
long-running bake.

### `scene3d.add_mesh_instance(scene_path, parent_path, mesh_path, transform?)`

- **Params:** `{scene_path, parent_path, mesh_path, transform?}`.
- **Result:** `{node_path}`. UndoRedo-wrapped.

### `scene3d.add_light(scene_path, parent_path, type, transform?, params?)`

- **Params:** `{scene_path, parent_path, type: "directional" | "omni" | "spot", transform?, params?}`.
- **Result:** `{node_path}`. UndoRedo-wrapped.

### `scene3d.add_camera(scene_path, parent_path, transform?, params?)`

- **Params:** `{scene_path, parent_path, transform?, params?}`.
- **Result:** `{node_path}`. UndoRedo-wrapped.

### `scene3d.set_environment(scene_path, env_path)`

- **Params:** `{scene_path, env_path}`.
- **Result:** `{applied: true}`. UndoRedo-wrapped.

### `scene3d.bake_lightmap(scene_path, quality?)`

- **Params:** `{scene_path, quality?: "low" | "medium" | "high" = "medium"}`.
- **Result:** `{success, lightmap_path, duration_ms}`.

### `scene3d.import_gltf(source_path, target_path)`

- **Params:** `{source_path, target_path}`.
- **Result:** `{target_path}`. UndoRedo-wrapped.

## Particle (Phase 6A)

Five editor-channel tools for GPU / CPU particle authoring. Four
mutating tools are UndoRedo-wrapped; `particle.preview_in_editor` is
fire-and-forget and returns immediately after scheduling the preview.

### `particle.create_gpu(scene_path, parent_path, transform?)`

- **Params:** `{scene_path, parent_path, transform?}`.
- **Result:** `{node_path}`. UndoRedo-wrapped.

### `particle.create_cpu(scene_path, parent_path, transform?)`

- **Params:** `{scene_path, parent_path, transform?}`.
- **Result:** `{node_path}`. UndoRedo-wrapped.

### `particle.set_emission_shape(material_path, shape, params)`

- **Params:** `{material_path, shape, params}`.
- **Result:** `{applied: true}`. UndoRedo-wrapped.

### `particle.preview_in_editor(node_path, duration?)`

- **Params:** `{node_path, duration?: int = 2000}` — milliseconds.
- **Result:** `{previewing: true, duration_ms}`.

### `particle.convert_cpu_to_gpu(node_path)`

- **Params:** `{node_path}`.
- **Result:** `{new_node_path}`. UndoRedo-wrapped.

## Navigation (Phase 6A)

Six tools split across editor and runtime channels:

**Editor channel:**

### `navigation.bake_mesh(nav_region_path, quality?)`

- **Params:** `{nav_region_path, quality?: "low" | "medium" | "high" = "medium"}`.
- **Result:** `{success, mesh_path}`.

### `navigation.add_agent(scene_path, parent_path, params?)`

- **Params:** `{scene_path, parent_path, params?}`.
- **Result:** `{node_path}`. UndoRedo-wrapped.

### `navigation.set_avoidance(agent_path, enabled, params?)`

- **Params:** `{agent_path, enabled: bool, params?}`.
- **Result:** `{applied: true}`. UndoRedo-wrapped.

### `navigation.configure_layers(layers)`

- **Params:** `{layers: [{index, name}]}`.
- **Result:** `{applied: true}`. Atomic `project.godot` write.

**Runtime channel:**

### `navigation.find_path(from, to, optimize?)`

- **Params:** `{from, to, optimize?: bool = true}`.
- **Result:** `{path_points, cost}`.

### `navigation.debug_draw(enabled)`

- **Params:** `{enabled: bool}`.
- **Result:** `{enabled}`.

## Audio (Phase 6A)

Six tools split across editor and runtime channels:

**Editor channel:**

### `audio.list_buses()`

- **Result:** `{buses: [{index, name, volume_db, mute, solo, bypass, effects}]}`.

### `audio.set_bus_volume_db(bus_name, db)`

- **Params:** `{bus_name, db: float}`.
- **Result:** `{applied: true}`. UndoRedo-wrapped.

### `audio.add_bus_effect(bus_name, effect_type, params?)`

- **Params:** `{bus_name, effect_type, params?}`. `effect_type ∈ {reverb, chorus, delay, compressor, eq, ...}`.
- **Result:** `{applied: true}`. UndoRedo-wrapped.

### `audio.import_sound(source_path, target_path, import_flags?)`

- **Params:** `{source_path, target_path, import_flags?}`.
- **Result:** `{target_path}`. UndoRedo-wrapped.

**Runtime channel:**

### `audio.play_stream(stream_path, bus?, volume_db?)`

- **Params:** `{stream_path, bus?: string = "Master", volume_db?: float = 0.0}`.
- **Result:** `{player_id}`.

### `audio.stop_stream(player_id)`

- **Params:** `{player_id}`.
- **Result:** `{stopped: true}`.

## AnimationTree (Phase 6A)

Four editor-channel tools for wiring up and driving `AnimationTree`
nodes. Three mutating tools are UndoRedo-wrapped.

### `animation_tree.create(scene_path, parent_path, anim_player_path)`

- **Params:** `{scene_path, parent_path, anim_player_path}`.
- **Result:** `{node_path}`. UndoRedo-wrapped.

### `animation_tree.set_parameter(tree_path, parameter_path, value)`

- **Params:** `{tree_path, parameter_path, value}`. `value` forwarded verbatim (Smart_Type_Parser).
- **Result:** `{applied: true}`. UndoRedo-wrapped.

### `animation_tree.get_parameters(tree_path)`

- **Params:** `{tree_path}`.
- **Result:** `{parameters: [{path, type, value}]}`.

### `animation_tree.set_active(tree_path, active)`

- **Params:** `{tree_path, active: bool}`.
- **Result:** `{applied: true}`. UndoRedo-wrapped.

## State Machine (Phase 6A)

Three tools split across editor and runtime channels:

**Editor channel:**

### `state_machine.list_states(tree_path, playback_param)`

- **Params:** `{tree_path, playback_param}`.
- **Result:** `{states: [string, ...]}`.

**Runtime channel:**

### `state_machine.travel(tree_path, playback_param, state_name)`

- **Params:** `{tree_path, playback_param, state_name}`.
- **Result:** `{traveling: true}`.

### `state_machine.get_current(tree_path, playback_param)`

- **Params:** `{tree_path, playback_param}`.
- **Result:** `{state_name, progress}`.

## Blend Tree (Phase 6A)

One editor-channel tool for configuring `AnimationNodeBlendTree` children.

### `blend_tree.configure_node(tree_path, node_id, type, params?)`

- **Params:** `{tree_path, node_id, type, params?}`. `type` is an `AnimationNode` subclass name.
- **Result:** `{applied: true}`. UndoRedo-wrapped.

## Export (Phase 6A — CLI channel)

Three CLI-channel tools that shell out to `godot --headless --export-*`
or read `export_presets.cfg` on disk.

### `export.list_presets(project_root?)`

- **Params:** `{project_root?}`.
- **Result:** `{presets: [{name, platform, runnable, export_path}]}`.
- **Errors:** `EXPORT_PRESETS_FILE_MISSING` when `export_presets.cfg` is absent.

### `export.run_preset(preset_name, output_path, debug?)`

- **Params:** `{preset_name, output_path, debug?: bool = false}`.
- **Result:** `{success, log_path, artifact_path}`. Spawns `godot --headless --export-release` (or `--export-debug`) and captures stdout/stderr to `log_path`.

### `export.validate_preset(preset_name, project_root?)`

- **Params:** `{preset_name, project_root?}`.
- **Result:** `{valid, errors: [{field, reason}]}`. Verifies `name`, `platform`, and `export_path` are present and non-empty.

## Android Deploy (Phase 6A — CLI channel)

Three CLI-channel tools that shell out to `adb`.

### `android.list_devices()`

- **Result:** `{devices: [{serial, state, model}]}`. Parses `adb devices -l`.

### `android.install_apk(apk_path, device_serial?)`

- **Params:** `{apk_path, device_serial?}`.
- **Result:** `{installed, output}`. Runs `adb install <apk>` or `adb -s <serial> install <apk>`.

### `android.run_logcat(filter?, duration_ms?)`

- **Params:** `{filter?, duration_ms?}`.
- **Result:** `{log_lines: [string]}`. Runs `adb logcat` with the optional filter expression.

## Observability

Phase 6B adds an observability layer covering structured logs, trace
propagation, and an in-memory metrics registry. The three concerns
live under `mcp-server/src/observability/` on the server side and
`addons/forgekit_core/mcp/observability/` on the Godot side.

### JSON Lines log stream

Every MCP component writes one JSON line per event. The shared line
shape is:

```json
{
  "ts": "2026-05-16T18:12:33.540Z",
  "level": "info",
  "component": "editor_plugin",
  "trace_id": "abcd1234",
  "span_id": "0001",
  "method": "scene.open",
  "duration_ms": 12,
  "data": { "path": "res://levels/forest.tscn" }
}
```

`ts`, `level`, and `component` are always present. `trace_id`,
`span_id`, `method`, and `duration_ms` are hoisted to the top level
when the caller supplies them. All other caller-supplied fields live
under `data`.

| Side | File path | Rotation | Level flag |
| ---- | --------- | -------- | ---------- |
| Server | `$HOME/.forgekit/logs/<YYYY-MM-DD>.jsonl` | One file per UTC day. Created on first write. | `--mcp-log-level <debug\|info\|warn\|error>` |
| Godot | `user://mcp_logs/<component>/<YYYY-MM-DD>.jsonl` | One file per component per UTC day. Created on first write. | `FORGEKIT_MCP_LOG_LEVEL` env var, or `logger.level = &"…"` per instance. |

Lines below the configured level are dropped silently.

### Trace propagation

Every MCP request carries a `trace_id` so log lines emitted by the
server, the editor plugin, and the runtime bridge can be correlated
with a single `grep`.

- `trace_id` — 8-char lowercase hex (`[0-9a-f]{8}`), 32 bits of
  entropy per request.
- `span_id`  — 4-char lowercase hex (`[0-9a-f]{4}`), identifies
  sub-operations inside one trace.

Transport embedding:

- **Editor channel (WebSocket).** Clients MAY include a
  `_forgekit_trace: {trace_id, span_id}` field on the incoming
  JSON-RPC request. The dispatcher echoes it through
  `get_last_trace_context()`. Missing or malformed envelopes are
  replaced with a freshly minted pair so every request is
  correlatable.
- **Runtime channel (UDP).** Clients MAY include a top-level `trace`
  field with the same shape. `McpBridge.observe_packet(request)`
  echoes it through `get_last_trace_context()`.
- **Server.** `generateTraceId()`, `generateSpanId()`, and
  `newTraceContext()` mint fresh pairs from
  `mcp-server/src/observability/trace.ts` whenever the upstream
  transport did not supply one.

### Metrics registry

`mcp-server/src/observability/metrics.ts` exposes a lightweight
`MetricsRegistry` with two metric kinds and an idempotent named
lookup (`registerCounter(name)` / `registerHistogram(name)`; repeat
calls return the existing instance).

| Name | Kind | Meaning |
| ---- | ---- | ------- |
| `mcp.requests.total` | counter | Per JSON-RPC request, incremented before dispatch. |
| `mcp.requests.errors` | counter | Per failed JSON-RPC response. |
| `mcp.requests.duration_ms` | histogram | Observed on every response. |
| `mcp.heartbeat.drops` | counter | Heartbeat monitor detected a gap > 10 s. |
| `mcp.reconnect.attempts` | counter | Per reconnect attempt. |
| `mcp.reconnect.backoff_ms` | histogram | Observed backoff duration per attempt. |
| `mcp.editor_plugin.undo_stack_size` | counter (inc/dec) | Undo stack depth delta. Declared but wiring deferred — `UndoRedoWrapper` has no stack-size signal. |
| `mcp.runtime_bridge.udp_packets.received` | counter | Per datagram entering the runtime packet parser. |
| `mcp.runtime_bridge.udp_packets.rejected` | counter | Per datagram rejected by the parser. |
| `mcp.healing.retries` | counter | Per `resource.apply_fix` attempt recorded by the self-healing retry counter. |

Histograms keep a rolling window of the most recent 1000 observations
and report `{count, sum, p50, p95, p99}` via `snapshot()`, using the
nearest-rank percentile rule (`index = ceil(p * n) - 1`).

### Workspace routing (multi-project)

Every JSON-RPC request carries an implicit or explicit workspace
context. The dispatcher's `resolveWorkspace` middleware translates
`(params.workspace_id, params.projectRoot)` into a single
`(Workspace, projectRoot)` tuple before forwarding to the tool
handler. The resolved `workspace_id` is set as a reserved JSONL
logger field (`mcp-server/src/observability/jsonl_logger.ts` and
`addons/forgekit_core/mcp/observability/jsonl_logger.gd`), so every
emitted log line carries `workspace_id` at top level alongside
`trace_id` / `span_id` / `method` / `duration_ms`.

Tip: grep the JSONL logs with `workspace_id=<id>` to get the full
audit trail for a single workspace across the editor / runtime / CLI
channels.

The `/health` endpoint also exposes the workspace summary:

```json
{
  "status": "ok",
  "checks": {"editor": "ok", "runtime": "ok", "cli": "ok"},
  "workspaces": {"count": 2, "active": "client-a"}
}
```

The `workspaces` field is only present when the server was started
with a ProjectRegistry dependency; pre-v0.9.0 health responses (no
registry wired) continue to emit the two-field shape.

## Health endpoint

Phase 6B adds a small HTTP server for operators and CI to query the
live state of the MCP process without speaking JSON-RPC. The server
binds the first free TCP port in the Health range (`6040-6049`) on
`127.0.0.1` and writes the chosen port into
`mcp_active_port.json` under the `"health"` key so the editor plugin
and runtime bridge can discover it alongside the other channels.

The implementation lives in `mcp-server/src/health_endpoint.ts`
(class `HealthEndpoint`). All four routes are read-only and require
no authentication; the server only binds loopback so exposing it
outside the local machine is an explicit user action.

### `GET /health`

```
200 OK
Content-Type: application/json

{
  "status": "ok" | "degraded" | "down",
  "checks": { "editor": "<status>", "runtime": "<status>", "cli": "<status>" }
}
```

Per-channel rules (evaluated by `channelStatusProvider`):

- `ok` — last heartbeat from that channel arrived inside the previous
  10 seconds.
- `degraded` — last heartbeat is older than 10 seconds but the
  channel was connected at least once during the current session.
- `down` — the channel never connected, or was explicitly stopped.

The top-level `status` rolls up the three checks: `down` if any is
`down`, `degraded` if any is `degraded`, otherwise `ok`.

### `GET /metrics`

```
200 OK
Content-Type: text/plain; version=0.0.4

# HELP mcp_requests_total mcp.requests.total
# TYPE mcp_requests_total counter
mcp_requests_total 1234
...
# HELP mcp_requests_duration_ms mcp.requests.duration_ms
# TYPE mcp_requests_duration_ms histogram
mcp_requests_duration_ms_count 5000
mcp_requests_duration_ms_sum 620000
mcp_requests_duration_ms{quantile="0.5"} 90
mcp_requests_duration_ms{quantile="0.95"} 240
mcp_requests_duration_ms{quantile="0.99"} 480
```

Name translation replaces every non-`[a-zA-Z0-9_]` character with
`_` so `mcp.requests.total` becomes `mcp_requests_total`; the
original ForgeKit name is kept in the `# HELP` line so scrapers can
surface the pre-sanitised identifier.

### `GET /version`

```
200 OK
Content-Type: application/json

{
  "server": "<npm version>",
  "core_detected": "<git tag or 'unknown'>",
  "api_version": "<same as server>"
}
```

`core_detected` is resolved from `git describe --tags --abbrev=0` at
the project root on every request. On failure (no git, no tags,
error from the resolver) the field falls back to `"unknown"`.

### `GET /trace/:trace_id`

```
200 OK
Content-Type: application/json

[
  { "ts": "2026-05-15T12:00:00.000Z", "trace_id": "abcd1234", ... },
  ...
]
```

Reads every `<logsDir>/<YYYY-MM-DD>.jsonl` file for the last 7 days,
keeps only lines whose `trace_id` matches the URL parameter, sorts
them ascending by `ts`, and caps the response at 100 entries.

### Routing and method constraints

- Only `GET` is accepted. Any other method returns
  `405 Method Not Allowed`.
- Unknown paths return `404 Not Found`.
- The paths above are matched exactly, except for `/trace/:trace_id`,
  which accepts any URL-encoded `trace_id` segment after `/trace/`.

### Active-port file atomicity

The endpoint updates `mcp_active_port.json` through a sibling
`.tmp` file plus a rename, so a concurrent reader observes either
the complete previous contents or the complete new contents —
never a truncated file. Sibling keys written by the other channels
(`editor`, `runtime`, `visualizer`) are read, merged, and rewritten
verbatim so starting the health endpoint never clobbers their
active-port entries. If the rename fails the temp file is cleaned
up and the original file is left byte-for-byte intact.

### Port-range exhaustion

If every port in the Health range `6040-6049` is already bound on
`127.0.0.1`, `HealthEndpoint.start()` rejects with a
`PORT_RANGE_EXHAUSTED` error. No HTTP server is left listening and
`mcp_active_port.json` is not modified; callers can retry after
freeing a port in the range.
