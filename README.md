# ForgeKit Core

Modular AI-native starter kit for Godot 4.x. Ships an Event Bus, base
resources, a Model Context Protocol (MCP) runtime bridge, and a Node.js MCP
server so that LLM agents can author scenes, validate resources, and drive a
running game through a stable tool surface.

<!-- Badges are placeholders. Wire to real CI/NPM/AssetLib URLs after Phase 0. -->
![status](https://img.shields.io/badge/status-alpha-orange)
![godot](https://img.shields.io/badge/godot-4.3%2B-blue)
![license](https://img.shields.io/badge/license-MIT-green)
![mcp](https://img.shields.io/badge/mcp-ready-purple)

## Prerequisites

- [Godot](https://godotengine.org/) 4.3 or newer.
- [Node.js](https://nodejs.org/) 20 or newer (required by the
  `@forgekitstudio/core-mcp` package).
- `npm` 10 or newer (ships with Node.js 20).

## Compared to

ForgeKit Core is one of several MCP servers targeting the Godot
editor. The table below lists factual differences against the
communities' most active alternatives at the time of writing. Rows
mark "no" when the upstream project does not advertise the capability
in its README; see each project's documentation for the latest state.

| Capability              | ForgeKit Core             | [godot-mcp-pro](https://github.com/sparklecom/godot-mcp-pro) | [tomyud1/godot-mcp](https://github.com/tomyud1/godot-mcp) | [Coding-Solo/godot-mcp](https://github.com/Coding-Solo/godot-mcp) |
| ----------------------- | ------------------------- | ---------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------- |
| Tool count              | ~215 (Full profile)       | ~150                                                       | ~120                                                      | ~90                                                               |
| Editor channel          | yes (WebSocket, 6010-6019) | yes                                                        | yes                                                       | no                                                                |
| Runtime channel         | yes (UDP, 6020-6029)      | no                                                         | no                                                        | no                                                                |
| CLI channel             | yes (spawn `godot --headless`) | yes                                                    | yes                                                       | yes                                                               |
| UndoRedo integration    | yes (every editor mutation) | partial                                                  | no                                                        | no                                                                |
| Self-healing loop       | yes (`.tres` inspect + suggest + bounded retry) | no                                         | no                                                        | no                                                                |
| Modules / licensing     | yes (paid `forgekit_rpg` + HMAC license store) | no                                          | no                                                        | no                                                                |
| Observability           | structured JSONL logs + trace/span ids + Prometheus metrics + health endpoint | no | no                                                        | no                                                                |

The comparison is about architectural scope only — every project
listed above ships the fundamentals agents need for editor automation
and is worth evaluating alongside ForgeKit Core based on the team's
day-to-day workflow.

## Quickstart

This quickstart takes you from zero to the first `crafting.execute` call in
roughly five minutes, assuming you have already purchased and downloaded the
paid **ForgeKit RPG Module**.

1. Click **Use this template** on
   [ForgeKitStudio/forgekit-core](https://github.com/ForgeKitStudio/forgekit-core)
   to create your own GitHub repository.
2. Clone your new repository and open the folder in Godot 4.3 or newer.
3. Install the MCP server:
   ```sh
   cd mcp-server
   npm ci
   npm run build
   ```
4. Install the required git hooks (see
   [Required git hooks](#required-git-hooks) for what they do and why they
   are required):
   ```sh
   npx -y @forgekitstudio/core-mcp install-hooks
   ```
   The `-y` flag skips the interactive install prompt so the command can
   be run non-interactively in CI and setup scripts.
5. Purchase and download the **ForgeKit RPG Module** from
   [itch.io](https://forgekitstudio.itch.io/forgekit-rpg) or
   [Gumroad](https://forgekitstudio.gumroad.com/l/forgekit-rpg), then unzip
   the archive into `addons/forgekit_rpg/`.
6. Copy the config template and fill in your auth token:
   ```sh
   cp addons/forgekit_core/mcp/plugin_config.tres.template \
      addons/forgekit_core/mcp/plugin_config.tres
   # edit plugin_config.tres and set auth_token = "<a strong random string>"
   ```
7. In Godot, enable the plugin under **Project → Project Settings → Plugins →
   ForgeKit Core**.
8. Launch the MCP server in the `RPG-only` profile:
   ```sh
   npx -y @forgekitstudio/core-mcp --profile RPG-only
   ```
9. Activate the module license through your MCP client:
   ```
   modules.activate_license("forgekit_rpg", "<your-license-key>")
   ```
10. Call `crafting.execute("iron_ingot")` from the same MCP client and watch
    the item appear in the inventory.

## Updating

ForgeKit ships three independent update channels, one per product.

- **MCP Server (`@forgekitstudio/core-mcp`).** Run
  `npx -y @forgekitstudio/core-mcp@latest` to pull the newest version from
  npm. The editor plugin polls the GitHub releases endpoint once per
  hour; when a newer ForgeKit Core version is detected it appends a
  single line to `editor.get_output_log`:
  ```
  UPDATE_AVAILABLE: ForgeKit Core v<new> available (running v<current>).
  Run 'npx -y @forgekitstudio/core-mcp@latest' to upgrade.
  ```
  Clients that scrape the editor log stream (Kiro, Claude Code,
  Cursor, ...) surface the notice without any extra wiring. The
  one-hour rate limit is enforced through a small cache at
  `user://mcp_update_check.json`; delete that file if you want to
  force an immediate re-check. Network failures (offline, DNS error,
  non-200 response) are silent: the checker reports no update rather
  than surfacing a false positive, and the cache is only written on a
  successful fetch so the next call retries.
- **ForgeKit Core addon (`addons/forgekit_core/`).** Replace the
  directory with the newest release tarball, or pull the update
  through Godot's AssetLib "Update" action. The addon never rewrites
  itself in place.
- **ForgeKit RPG Module (`addons/forgekit_rpg/`).** Replace the
  module directory with the newest ZIP from
  [itch.io](https://forgekitstudio.itch.io/forgekit-rpg) or
  [Gumroad](https://forgekitstudio.gumroad.com/l/forgekit-rpg). After
  extracting, call `modules.check_compatibility(module_id=
  "forgekit_rpg")` — the tool compares the module's
  `core_min_version` against the installed Core version and returns
  `{compatible: false, required, installed}` when the module needs a
  newer Core than you have. `modules.check_compatibility` is the
  authoritative source of truth for module / Core version
  compatibility; agents MUST consult it before activating a module
  and SHOULD consult it after every update.

## Required git hooks

> **Required after cloning.** Before making any commits, run
> `npx @forgekitstudio/core-mcp install-hooks` from the repository root. The same
> rules are enforced by CI, so running the hooks locally catches failures
> before they block your pull request.

```sh
npx -y @forgekitstudio/core-mcp install-hooks
```

Run this command once, immediately after your first `git clone` (or after
creating a new repository from the template) and before your first commit.
The command writes two shim scripts into `.git/hooks/`:

- **`commit-msg`** — validates that every commit message follows the
  [Conventional Commits](https://www.conventionalcommits.org/) format
  `<type>(<scope>)?: <subject>`. Commits whose subject lines do not match
  are rejected with error code `-32013`
  (`CONVENTIONAL_COMMITS_FORMAT_VIOLATION`) and a short hint about the
  expected shape.
- **`pre-commit`** — enforces the **Context Commits** policy. When a commit
  touches code under `addons/forgekit_core/**`, `mcp-server/src/**`, or
  `addons/forgekit_rpg/**`, the hook checks that the corresponding context
  files (`CLAUDE.md`, `.cursorrules`) — as mapped in
  `.forgekit/context-map.json` — are staged in the same commit. Stale-context
  commits are rejected with error code `-32012` (`CONTEXT_FILE_STALE`).

### Why these hooks are required

CI runs the same validators (`tools/validate-language-policy.js`, the
commit-msg validator, and the context-commit check) on every pull request.
Without the local hooks a commit can look fine on your machine and then fail
in CI, forcing a rebase and re-push. Installing the hooks keeps the
fast-feedback loop on your laptop where it belongs.

### Skipping the pre-commit hook

If you genuinely need to bypass the pre-commit check — for example while
landing an emergency hotfix — pass `--no-verify`:

```sh
git commit --no-verify -m "fix(core): emergency patch"
```

The skip is recorded in `.git/hooks/context-commit-skips.log` as a JSON line
with `{ts, author, files, reason}` fields so reviewers can audit bypasses
during code review. Note that `--no-verify` also skips the local
`commit-msg` hook, but CI re-runs the Conventional Commits check on every
pull request, so a malformed subject will still be caught before merge.

## Project structure

```text
forgekit-core/
├── addons/
│   ├── forgekit_core/          # This addon — MIT. Event bus, resources, MCP bridge.
│   └── forgekit_rpg/           # Placeholder for the paid RPG module (purchase required).
├── mcp-server/                 # @forgekitstudio/core-mcp Node.js server (published to npm).
├── docs/                       # Architecture notes, MCP API reference, SKILLS pack.
├── tests/                      # GUT unit, property, integration, and static tests.
├── tools/                      # CLI helpers (run_tests.sh, check_imports.sh).
├── .github/                    # Issue templates, PR template, CI workflows.
├── CLAUDE.md                   # Context file for AI agents.
├── .cursorrules                # Context file for Cursor (mirror of CLAUDE.md).
├── NOTICE.md                   # Installed modules and their licenses.
└── project.godot               # Godot project with registered autoloads.
```

## Installing and running the MCP server

The MCP server ships as the npm package
[`@forgekitstudio/core-mcp`](https://www.npmjs.com/package/@forgekitstudio/core-mcp).
The recommended way to run it is through `npx`, which fetches the latest
published version on demand and exits cleanly after the server stops.

```sh
# Fetch and run the server non-interactively.
npx -y @forgekitstudio/core-mcp --profile Full

# Pin a specific version to avoid surprises during long sessions.
npx -y @forgekitstudio/core-mcp@0.1.0 --profile Lite
```

`-y` skips the `npx` interactive install prompt; use it whenever the
command runs inside CI, a container, or a script that cannot answer
prompts. For local development where you want to inspect the install
prompt, drop the `-y`.

Once installed globally or through `npx`, the executable is exposed as
`forgekit-mcp`. That binary accepts the same flags as the `npx` form
(for example `forgekit-mcp --profile RPG-only`); the examples in this
README use `npx -y @forgekitstudio/core-mcp` so they work without a global
install.

### Profiles

The MCP server exposes four tool profiles, selected with the `--profile`
flag. Counts are approximate and shift with each minor release.

| Profile    | Tool count | Intended clients                                             |
| ---------- | ---------- | ------------------------------------------------------------ |
| `Full`     | ~215       | Claude Code, Cline, VS Code Copilot, Cursor, Kiro            |
| `Lite`     | ~90        | Windsurf, JetBrains Junie, Gemini CLI (~100-tool limits)     |
| `Minimal`  | ~40        | OpenCode, local LLMs, Antigravity via stdio                  |
| `RPG-only` | ~29 + core | Users focused on the RPG module after activating its license |

## Ports

ForgeKit allocates ports in dedicated ranges and scans for the first free one
at startup. All services bind to `127.0.0.1` by default.

| Service                 | Range     | Protocol  |
| ----------------------- | --------- | --------- |
| Editor plugin WebSocket | 6010–6019 | WebSocket |
| Runtime bridge          | 6020–6029 | UDP       |
| Browser visualizer      | 6030–6039 | HTTP      |
| Health endpoint         | 6040–6049 | HTTP      |

The active port for each service is written to
`user://mcp_active_port.json` so that the MCP server can discover the exact
values at runtime. Updates to this file are crash-safe: each service writes
its entry through a sibling `.tmp` file plus a rename, so a reader always
observes either the complete previous contents or the complete new
contents, and entries written by other services are preserved even if the
write fails mid-flight.

### Port collisions

ForgeKit deliberately uses ranges outside the `6505–6509` block used by
other Godot MCP servers (`godot-mcp-pro`, `tomyud1/godot-mcp`) so that
both can coexist on the same machine. When a port is already taken, the
editor plugin, runtime bridge, visualizer, and health endpoint each
scan upward inside their dedicated range and bind to the first free slot.

What to do if startup still fails with "no free port":

1. **Find the listener.** On macOS or Linux:
   ```sh
   lsof -iTCP:6010-6019 -sTCP:LISTEN
   lsof -iUDP:6020-6029
   ```
   On Windows:
   ```powershell
   Get-NetTCPConnection -LocalPort 6010..6019 -State Listen
   Get-NetUDPEndpoint -LocalPort 6020..6029
   ```
   Stop whatever is bound to the range, or reconfigure it to a different
   port.
2. **Tell ForgeKit a different range.** Override the default range by
   editing `addons/forgekit_core/mcp/plugin_config.tres` (editor and
   visualizer) or `addons/forgekit_core/mcp/runtime_config.tres` (runtime
   bridge) and setting `bind_port` to a specific free port. The scan
   still runs, but it starts from the value you chose.
3. **Confirm the active port.** After startup, read
   `user://mcp_active_port.json` to see the port the server actually
   bound to — the MCP server reads the same file to find Godot, so the
   two stay in sync automatically.

If another agent is already running on the same machine with
`--profile Full`, launch a second copy with a different profile
(`--profile Minimal`, for example) so that the tool sets do not
conflict inside the shared MCP client.

## Event Bus

`GameEvents` is a project-wide autoload registered at
`addons/forgekit_core/event_bus/game_events.gd`. It declares a fixed set of
global signals so that subsystems (inventory, crafting, combat) stay loosely
coupled and testable.

### Declared signals

The bus declares seventeen signals in total.

Phase 0–3:

| Signal               | Payload                                                          |
| -------------------- | ---------------------------------------------------------------- |
| `damage_dealt`       | `source: Node, target: Node, damage: float, damage_type: StringName` |
| `crafting_completed` | `recipe_id: StringName, outputs: Array`                          |
| `item_added`         | `item_id: StringName, amount: int`                               |
| `item_removed`       | `item_id: StringName, amount: int`                               |

Phase 4B (consumed by the RPG module's effects, magic, and equipment subsystems):

| Signal                   | Payload                                                    |
| ------------------------ | ---------------------------------------------------------- |
| `status_effect_ticked`   | `owner: StringName, effect_id: StringName, tick_index: int` |
| `status_effect_expired`  | `owner: StringName, effect_id: StringName`                 |
| `spell_cast`             | `caster: StringName, spell_id: StringName, target: Node, status: StringName` |
| `item_equipped`          | `owner: StringName, slot: StringName, item_id: StringName` |
| `item_unequipped`        | `owner: StringName, slot: StringName, item_id: StringName` |

For `spell_cast`, `status` is the `CastResult.Status` name (`ok`,
`insufficient_mana`, `on_cooldown`, ...), so a single subscriber can react to
both successful and failed casts.

Phase 5 (XP and level-up progression):

| Signal        | Payload                                                      |
| ------------- | ------------------------------------------------------------ |
| `xp_gained`   | `owner: StringName, amount: float, source: StringName`       |
| `leveled_up`  | `owner: StringName, new_level: int, reward_tier: StringName` |

`xp_gained` fires once per `XPSystem.grant_xp(...)` call, before any
resulting level-up signals. `source` identifies the XP origin — `&"manual"`
for direct grants, `&"kill"` when driven by the `died` signal, `&"quest"`
for quest rewards — so subscribers can route XP popups to the right UI
channel. `leveled_up` fires once per level crossed; a single `grant_xp`
call that spans multiple levels produces N sequential signals, and
`reward_tier` echoes `LevelUpRewardResource.unlock_tier` (or `&""` when
the level-up applied no reward).

Phase 6 (world layer — death, loot, scene transitions, dialog, shops):

| Signal                        | Payload                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------- |
| `died`                        | `victim: StringName, killer: StringName`                                                          |
| `chest_opened`                | `chest_id: StringName, opener: StringName`                                                        |
| `scene_transition_requested`  | `from_scene: String, to_scene: String, target_spawn_point: StringName`                            |
| `dialog_started`              | `npc_id: StringName, dialog_tree_id: StringName`                                                  |
| `dialog_completed`            | `npc_id: StringName, dialog_tree_id: StringName, outcome: StringName`                             |
| `shop_transaction`            | `actor: StringName, vendor_id: StringName, transaction_type: StringName, item_id: StringName, amount: int, currency_delta: int` |

`died.killer` is `&""` for environmental, suicide, or poison-tick deaths.
`chest_opened` fires exactly once per chest instance even if the chest is
interacted with again afterwards. `scene_transition_requested` announces
intent only — the event bus does not change scenes itself; gameplay code
drives the actual `SceneTree.change_scene_to_file` and snaps the player
to `target_spawn_point`. `dialog_completed.outcome` is an optional
StringName tag the dialog author can attach to the terminal node (for
example `&"quest_accepted"`); it is `&""` when no outcome tag was set.
For `shop_transaction`, `transaction_type` is `&"buy"` or `&"sell"`, and
`currency_delta` is the net change in currency on `actor`'s side:
negative on buy (spent gold), positive on sell (received gold).

### Public API

- `list_signals() -> Array[String]` — returns the declared signal names in
  sorted ascending order. Used by MCP introspection and stable in golden
  tests.
- `emit_validated(signal_name: StringName, args: Array) -> bool` — emits a
  declared signal after type-checking its payload against the registered
  schema. Returns `true` on success; returns `false` and emits a single
  `push_error` when the signal is unknown, the argument count is wrong, or
  an argument type does not match the schema. The error message always
  includes the signal name and, for type mismatches, the expected type at
  the offending argument position.

Subscribing works through the standard Godot API:

```gdscript
GameEvents.crafting_completed.connect(_on_crafting_completed)

func _on_crafting_completed(recipe_id: StringName, outputs: Array) -> void:
    print("Crafted ", recipe_id, " -> ", outputs)
```

## Test reports

`TestReport` (`addons/forgekit_core/testing/test_report.gd`) is the canonical
JSON-serializable payload emitted by GUT, property, and gameplay runs. The
MCP server, the self-healing loop, and CI all consume the same shape.

### Shape

```text
TestReport { run_id, timestamp, total, passed, failed, tests[], suggested_action }
TestCase   { name, status, duration_ms, assertions[], failure_message, stack_trace }
Assertion  { description, passed, expected, actual }
```

`status` is one of `"passed"`, `"failed"`, or `"skipped"` (the producer
chooses the vocabulary). `expected` and `actual` accept any
JSON-serializable `Variant`.

### Public API

- `to_dict() -> Dictionary` / `to_json() -> String` — serialize the report
  and all nested cases / assertions.
- `static from_dict(data: Dictionary) -> TestReport` /
  `static from_json(text: String) -> TestReport` — reconstruct a report.
  Missing keys fall back to documented defaults; malformed JSON, non-
  `Dictionary` roots, and malformed entries in `tests[]` are skipped
  defensively so consumers can always inspect the result.
- `is_suggested_action_valid() -> bool` — returns `true` when
  `suggested_action` respects the bounded-value contract below.

### `suggested_action` contract

`ALLOWED_SUGGESTED_ACTIONS` is a `PackedStringArray` with exactly four
entries:

| Value               | When producers set it                                    |
| ------------------- | -------------------------------------------------------- |
| `inspect_tres`      | A `.tres` resource looks malformed or out of date.       |
| `validate_gdscript` | A script-level failure (parse error, invalid signature). |
| `rerun_test`        | The failure looks flaky and a retry is recommended.      |
| `manual_review`     | No automated recovery path; a human should investigate.  |

`suggested_action` may be left empty when `failed == 0`. When `failed > 0`,
it MUST be one of the four values above; `is_suggested_action_valid()`
enforces both halves of this rule.

### MCP server (de)serialization

On the MCP server side, `test_report.serialize` and `test_report.parse`
are backed by `serializeTestReport` and `parseTestReport` in
`@forgekitstudio/core-mcp`. They use the same JSON shape as the GDScript
producer, but the server parser is **strict**: any malformed input
(non-string payload, invalid JSON, wrong root type, missing or mistyped
field, non-object entry in `tests[]` or `assertions[]`) raises
`TestReportParseError` with code `TEST_REPORT_PARSE_ERROR`. The error
message identifies the offending field by path (for example
`tests[2].assertions[0].expected is missing.`). This contrasts with the
GDScript loader, which skips malformed entries defensively because it
runs inside the engine and must not crash the self-healing loop; on the
server boundary we surface explicit errors so that JSON-RPC clients can
react.

### Round-trip guarantee

For every valid `TestReport` `r`, both
`TestReport.from_json(r.to_json())` in GDScript and
`parseTestReport(serializeTestReport(r).json)` in the MCP server
reproduce every field on `r`, including Unicode strings (emoji, CJK,
combining marks, and astral-plane code points) inside `failure_message`,
`stack_trace`, `TestCase.name`, and `Assertion` descriptions. Numeric
counters (`total`, `passed`, `failed`, `TestCase.duration_ms`) round-trip
as `int`.

## Project settings

The MCP server exposes `project.get_settings` as the canonical way to
inspect a project's `project.godot` from an agent. The tool reads directly
from disk on every call, so the response always reflects the authoritative
on-disk state rather than the editor's in-memory copy. After an
`update_settings` write completes, the next `get_settings` call observes
the new value.

### Parameters

| Field         | Type   | Required | Notes                                                          |
| ------------- | ------ | -------- | -------------------------------------------------------------- |
| `projectRoot` | string | yes      | Absolute path to the directory containing `project.godot`.     |
| `section`     | string | no       | Section header without brackets (e.g. `application`). No `/`. |

### Response

- Without `section`: `{ "settings": { "<section>/<key>": "<raw value>", ... } }`
- With `section`: `{ "settings": { "<key>": "<raw value>", ... } }` — only
  keys inside the requested section, with the section prefix stripped.
  Unknown sections resolve to `{ "settings": {} }`.

Values are returned verbatim — exactly the text to the right of `=` in
`project.godot`. Godot literals such as `PackedStringArray("4.3", "Forward
Plus")` or quoted strings like `"ForgeKit Core Template"` are not coerced;
the caller owns interpretation.

### Errors

- `ToolInputError` — `projectRoot` is missing or empty, or `section`
  contains `/` or is otherwise malformed.
- `ProjectIoError` — `project.godot` cannot be read (missing file,
  permissions, etc.). The message includes the attempted path and the
  underlying reason.

### Atomic writes

Writes issued through `project.update_settings` are crash-safe: the server
serializes the merged INI tree into a sibling temp file, `fsync`s it, and
atomically renames it over `project.godot`. A concurrent reader — including
a follow-up `project.get_settings` call — therefore observes either the
complete previous contents or the complete new contents, never a truncated
file, even if the server is killed mid-write. This is what lets
`project.update_settings` merge a single key without risking the known
"overwrites `events`" class of bugs seen in naive implementations.

## Module boundary checks

`project.check_imports` statically enforces the separation between
`forgekit_core` and `forgekit_rpg`. The tool walks every `.gd` file under
`addons/forgekit_core/**` and `addons/forgekit_rpg/**`, extracts every
`preload("res://...")`, `load("res://...")`, and `extends "res://..."`
target, and reports any file that crosses a module boundary. CI and the
`tools/cli_runner/check_imports.sh` helper call the same implementation.

### Parameters

| Field         | Type   | Required | Notes                                                      |
| ------------- | ------ | -------- | ---------------------------------------------------------- |
| `projectRoot` | string | yes      | Absolute path to the directory containing `project.godot`. |

### Response

```text
{ "violations": [ { "file": "<project-relative path>", "imports": ["res://..."], "reason": "<english explanation>" }, ... ] }
```

Files that respect the boundary rules are omitted entirely; an empty
`violations` array means the project is clean. Each violation aggregates
every offending target from a single file, deduplicated in first-seen
order, so consumers act on files rather than individual lines.

### Rules enforced

- **Core → elsewhere is forbidden.** A file under `addons/forgekit_core/`
  may only reference other `addons/forgekit_core/` paths. Any
  `res://addons/forgekit_<other>/...` target is flagged.
- **RPG subsystems talk through `public_api.gd`.** A file under
  `addons/forgekit_rpg/<subsystem>/` may reference its own subsystem,
  `addons/forgekit_core/...`, or `addons/forgekit_rpg/public_api.gd`. Any
  other `addons/forgekit_rpg/...` target (a different subsystem) or any
  `addons/forgekit_<other-module>/...` target is flagged.
- **Non-`forgekit_*` targets are ignored.** References to scenes, assets,
  or third-party addons outside the `forgekit_*` namespace are not part of
  the boundary contract.

### Errors

- `ToolInputError` — `projectRoot` is missing, not a string, or empty.

## Support and community

- **Bug reports and feature requests.** File an issue on the
  [`ForgeKitStudio/forgekit-core` issue tracker](https://github.com/ForgeKitStudio/forgekit-core/issues).
  Use the "Bug report" or "Feature request" template under
  `.github/ISSUE_TEMPLATE/` — both ask for the information needed to
  reproduce the problem.
- **Discussion forum.** Open-ended questions, design proposals, and
  show-and-tell posts belong in
  [GitHub Discussions](https://github.com/ForgeKitStudio/forgekit-core/discussions)
  rather than the issue tracker.
- **Security issues.** Do not file them publicly. Follow the private
  disclosure process in [`SECURITY.md`](./SECURITY.md).
- **Paid RPG module.** Use the support channel listed on the
  [itch.io](https://forgekitstudio.itch.io/forgekit-rpg) or
  [Gumroad](https://forgekitstudio.gumroad.com/l/forgekit-rpg) product
  page for license and download issues; module code bugs still go to the
  public issue tracker.

## License

ForgeKit Core is distributed under the [MIT License](./LICENSE). The
`forgekit_rpg` module shipped under `addons/forgekit_rpg/` is sold
separately under a commercial EULA. See [`NOTICE.md`](./NOTICE.md) for the
current list of installed modules and their licenses.

## Links

- [Contributing guide](./CONTRIBUTING.md) — branching, Conventional Commits,
  pull request checklist.
- [Code of Conduct](./CODE_OF_CONDUCT.md) — expectations for participation.
- [Security policy](./SECURITY.md) — how to report vulnerabilities privately.
