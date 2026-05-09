# AI Agent Context

This file describes project rules for AI coding agents (Claude Code, Cursor,
Kiro, Cline, Copilot, Antigravity, Windsurf, and any MCP-aware client) working
inside this project. It is a **client-side** context file — the project is
based on the ForgeKit Core template, so the rules below govern how agents may
interact with code the client owns versus third-party addons provided by
ForgeKit.

## Project overview

This project is based on the [ForgeKit Core](https://github.com/ForgeKitStudio/forgekit-core)
template repository, a modular AI-native starter kit for Godot 4.x. ForgeKit
Core ships as an addon under `addons/forgekit_core/` and exposes an MCP server
(`@forgekitstudio/core-mcp`) for editor, CLI, and runtime integrations. The optional
paid **ForgeKit RPG Module** lives under `addons/forgekit_rpg/` and bundles
Combat, Crafting, Inventory, and Stats subsystems behind a single license. The
rest of the repository (scenes, gameplay scripts, custom resources) is owned
by you, the client.

## Core Boundary

Two directories are read-only for AI agents. Any write below them is rejected
by the MCP server with JSON-RPC error code `CORE_BOUNDARY_VIOLATION`.

- `addons/forgekit_core/**` — the ForgeKit Core addon. Upgrade by replacing
  the directory with a newer release, never by editing files in place.
- `addons/gut/**` — the Godot Unit Test framework (installed via AssetLib).
  Treat as vendored third-party code.

The enforcement lives in `addons/forgekit_core/boundary/core_boundary.gd`
(`CoreBoundary.is_read_only`, `CoreBoundary.matches_deny_pattern`,
`CoreBoundary.violation_for`). When a write is rejected, the MCP server
returns `{ "code": "CORE_BOUNDARY_VIOLATION", "path": <path>, "matched_rule":
<rule> }` so the caller can identify which rule fired. If you need behavior
that does not exist in `forgekit_core`, open an issue upstream at
`https://github.com/ForgeKitStudio/forgekit-core/issues` instead of patching
the addon locally.

## Event Bus

The `GameEvents` autoload at `res://addons/forgekit_core/event_bus/game_events.gd`
is the single cross-system signal hub. Subscribers connect with
`GameEvents.connect(&"item_added", <callable>)`; publishers call
`GameEvents.emit_validated(&"item_added", [item_id, amount])`, which
type-checks the payload against a declared schema and surfaces mismatches
through `push_error` instead of letting them propagate silently.

Declaring a new global signal is a Core change (v0.7.0: seventeen signals declared, see reference below): it must be added to
`game_events.gd` together with an entry in the internal `_SIGNAL_SCHEMAS`
dictionary. Client code may not redeclare or shadow these signals.

As of v0.7.0 the bus declares seventeen signals in total; see the full reference below.

### Declared signals (17 total as of v0.7.0)

Phase 0–3:

- `damage_dealt(source: Node, target: Node, damage: float, damage_type: StringName)` — combat hit resolves against a valid target.
- `crafting_completed(recipe_id: StringName, outputs: Array)` — a crafting operation finishes successfully.
- `item_added(item_id: StringName, amount: int)` — an item enters an inventory.
- `item_removed(item_id: StringName, amount: int)` — an item leaves an inventory.

Phase 4B additions (consumed by the RPG module's effects / magic / equipment subsystems):

- `status_effect_ticked(owner: StringName, effect_id: StringName, tick_index: int)` — a registered StatusEffect completes a tick (for example poison dealing damage).
- `status_effect_expired(owner: StringName, effect_id: StringName)` — a StatusEffect's remaining_duration reached zero and the effect was auto-removed.
- `spell_cast(caster: StringName, spell_id: StringName, target: Node, status: StringName)` — a spell cast completes; the `status` is the `CastResult.Status` name (`ok`, `insufficient_mana`, `on_cooldown`, ...).
- `item_equipped(owner: StringName, slot: StringName, item_id: StringName)` — an `EquipableItemResource` is successfully slotted.
- `item_unequipped(owner: StringName, slot: StringName, item_id: StringName)` — an item is removed from a slot.

Phase 5 additions (consumed by the RPG module's progression subsystem):

- `xp_gained(owner: StringName, amount: float, source: StringName)` — fires once per `XPSystem.grant_xp(...)` call, before any level-up signals. `source` identifies the XP origin: `&"manual"` (direct grant), `&"kill"` (driven by `died` in phase 6), `&"quest"` (phase 8).
- `leveled_up(owner: StringName, new_level: int, reward_tier: StringName)` — fires once per level crossed. `reward_tier` echoes `LevelUpRewardResource.unlock_tier` (or `&""` when the level-up applied no reward) so UI can group events into warrior / mage / boss panels.

Phase 6 additions (consumed by the RPG module's enemies / world / npc / vendor subsystems):

- `died(victim: StringName, killer: StringName)` — an entity's HP reached zero. `killer` is `&""` for environmental, suicide, or poison-tick deaths. The XPSystem subscribes to this signal to auto-grant XP to the killer.
- `chest_opened(chest_id: StringName, opener: StringName)` — a `TreasureChest` was interacted with and its loot has been rolled. Fires exactly once per chest instance.
- `scene_transition_requested(from_scene: String, to_scene: String, target_spawn_point: StringName)` — a `Door` or `Portal` asks gameplay code to change scenes. The event bus announces intent only; gameplay code performs the actual transition.
- `dialog_started(npc_id: StringName, dialog_tree_id: StringName)` — a `DialogRunner` began a conversation.
- `dialog_completed(npc_id: StringName, dialog_tree_id: StringName, outcome: StringName)` — a `DialogRunner` ended a conversation. `outcome` is the optional StringName tag on the terminal node (for example `&"quest_accepted"`), or `&""` when untagged.
- `shop_transaction(actor: StringName, vendor_id: StringName, transaction_type: StringName, item_id: StringName, amount: int, currency_delta: int)` — a `Vendor.buy` or `Vendor.sell` completed. `transaction_type` is `&"buy"` or `&"sell"`; `currency_delta` is negative on buy, positive on sell.

## Resources

`ItemResource` (`addons/forgekit_core/resources/item_resource.gd`) and
`RecipeResource` (`addons/forgekit_core/resources/recipe_resource.gd`) are
the canonical data containers. Both expose `validate() -> Array[String]` and
`to_dict` / `from_dict` for stable round-trips through the MCP surface.

`EquipableItemResource` (`addons/forgekit_core/resources/equipable_item_resource.gd`)
extends `ItemResource` with the `slot`, `stat_modifiers`,
`status_effects_on_equip`, and `requirements` fields that the RPG
module's `EquipmentSystem` consumes. Authoring lives under
`addons/forgekit_rpg/inventory/items/`; the class itself is Core-owned so
future MIT modules can depend on the same shape.

Authoring `.tres` files is a client-side activity and happens under
`addons/forgekit_rpg/**/items/` or `addons/forgekit_rpg/**/recipes/`. Use
`TresLoader` (`addons/forgekit_core/resources/tres_loader.gd`) to validate
`.tres` content at load time — it reports unknown fields and type
mismatches as structured diagnostics.

## Manifest

`ModuleManifest` (`addons/forgekit_core/manifest/module_manifest.gd`)
describes a module's identity, version, license, and homepage. `ModuleLoader`
(`addons/forgekit_core/manifest/module_loader.gd`) walks installed modules
and surfaces their manifests to the MCP server so tools can be enabled or
disabled per module.

Clients do not hand-edit `module.manifest.tres` for paid modules. The
`Module_Installer` component of the MCP server rewrites that file (and the
matching row in `NOTICE.md`) when a module is unzipped into `addons/`.

## MCP editor plugin

The editor-side tools live under
`addons/forgekit_core/mcp/editor_plugin/`. They are read-only for agents.
All scene / node mutations performed by these tools flow through the
`UndoRedoWrapper` so editor history stays consistent and operations can
be rolled back.

Phase 5 adds three subtrees alongside the existing `tools/` directory:

- `visualizer/` — HTTP server that serves the three-view browser
  visualizer (scene tree, module graph, event bus) on the first free
  port in `6030-6039`.
- `asset_generator/` — `McpSvgRasterizer`, `McpTexturePacker`,
  `McpNoiseGenerator`, `McpIconSetGenerator` backing the four
  `assetgen.*` MCP tools. Every write routes through
  `McpUndoRedoWrapper` so a single Ctrl+Z reverts the file.
- `healing/` — `McpRetryCounter`, `McpHealingSuggester`,
  `McpHealingInspector`, `McpHealingTools` backing the five
  `healing.*` MCP tools. Limits retries to 3 per resource per session;
  escalates to `manual_review` on exhaustion (Property 22).

Phase 6A adds twelve editor-channel categories as thin adapter files
under `tools/`: `animation_tools.gd`, `tilemap_tools.gd`,
`theme_ui_tools.gd`, `shader_tools.gd`, `physics_tools.gd`,
`scene3d_tools.gd`, `particle_tools.gd`, `navigation_tools.gd`,
`audio_tools.gd`, `animation_tree_tools.gd`, `state_machine_tools.gd`,
`blend_tree_tools.gd`. Every mutating tool routes through
`McpUndoRedoWrapper`; the three tools that touch `project.godot`
(`physics.set_gravity`, `physics.configure_layer`,
`navigation.configure_layers`) go through
`McpProjectSettingsAtomicWriter` for atomic
read → parse → modify → write-temp → fsync → rename writes.

The adapters are wired in through `plugin_lifecycle.gd` via optional
factory Callables so headless tests can inject fakes.

Phase 6B extends `McpJsonRpcDispatcher` with two observability
concerns. The dispatcher now reads a `_forgekit_trace` envelope from
each incoming request (transport-supplied `{trace_id, span_id}` pair)
and mints a fresh 8-char / 4-char lowercase hex pair when the
envelope is absent. The latest pair is readable through
`get_last_trace_context()` so the WebSocket server can forward the
same `trace_id` to `McpJsonlLogger.log(...)`. The dispatcher also
exposes `set_metrics_sink(Callable)`: when registered, the sink
receives one `mcp.requests.total` increment per dispatch and an
additional `mcp.requests.errors` increment when the response is a
JSON-RPC error envelope.

Phase 6B also adds `McpUpdateChecker` at
`addons/forgekit_core/mcp/editor_plugin/update_checker.gd`. The
checker polls
`https://api.github.com/repos/ForgeKitStudio/forgekit-core/releases/latest`
at most once per hour (rate-limit cache lives under
`user://mcp_update_check.json`), compares the returned `tag_name`
to the running Core version, and formats a single
`UPDATE_AVAILABLE: ForgeKit Core v<new> available (running v<current>).
Run 'npx -y @forgekitstudio/core-mcp@latest' to upgrade.` line for
`editor.get_output_log`. The HTTP client is injected so the checker
runs headlessly under tests and silently no-ops on network failure.

## MCP runtime bridge

Runtime-side tools (gameplay state inspection, hot-reload hooks) live under
`addons/forgekit_core/mcp/runtime_bridge/`. The `McpBridge` autoload is
registered in `project.godot` and exposes the runtime surface to the MCP
server over a local transport. Like the editor plugin, this tree is
read-only for agents and expands in later phases.

Phase 6A adds four runtime-channel adapter files under
`runtime_bridge/tools/`: `physics_runtime_tools.gd` (raycast, shape_cast,
query_point against the active `PhysicsDirectSpaceState`),
`navigation_runtime_tools.gd` (find_path, debug_draw via
`NavigationServer`), `audio_runtime_tools.gd` (play_stream, stop_stream
against `AudioStreamPlayer`), and `state_machine_runtime_tools.gd`
(travel, get_current on
`AnimationNodeStateMachinePlayback`). These tools only respond when the
game was launched with the `--mcp-bridge` CLI flag.

Phase 6B extends `McpBridge` with trace propagation. The UDP server
calls `McpBridge.observe_packet(request)` once per accepted packet;
when the parsed JSON-RPC envelope carries a `trace` field with
`{trace_id, span_id}` (both 8-char / 4-char lowercase hex), the
bridge echoes the pair through `get_last_trace_context()`, so
downstream log lines emitted by `McpJsonlLogger.log(...)` carry the
same identifier that appears on the editor and server channels.
Missing or malformed envelopes are replaced with a freshly minted
pair so every packet stays correlatable.

## MCP licensing

License activation for paid modules is handled by
`addons/forgekit_core/mcp/licensing/`. Successful activations write a key
file to `user://licenses/<module_id>.key`. Client code must not read,
rewrite, or delete files in that directory — license state is MCP-owned
and tampering triggers a re-activation loop on the next editor start.

## MCP server

The Node/TypeScript MCP server lives at `mcp-server/src/**/*.ts`. It exposes
profile flags (`--profile editor`, `--profile runtime`, `--profile ci`) to
select which tool subset is active for a given client. Changes to the server
tree must come with a matching update to this section so the Context Commits
hook accepts the commit. Per-tool documentation and transport details live
in `docs/mcp_api.md`.

As of the `Unreleased` block in `CHANGELOG.md`, the `core`-scoped surface
includes three editor-channel categories added by Phase 5:

- **Visualizer** — `visualizer.start`, `visualizer.stop`,
  `visualizer.render_scene_tree`, `visualizer.render_module_graph`,
  `visualizer.render_event_bus`. Backed by the HTTP server at
  `addons/forgekit_core/mcp/editor_plugin/visualizer/http_server.gd`.
- **Asset Generation** — `assetgen.sprite_from_svg`,
  `assetgen.atlas_pack`, `assetgen.noise_texture`, `assetgen.icon_set`.
  Every write is funnelled through `McpUndoRedoWrapper`.
- **Self-Healing** — `healing.suggest_action`, `healing.inspect_failure`,
  `healing.get_retry_count`, `healing.reset_retry_count`,
  `healing.apply_and_retest`. Shares the `ALLOWED_SUGGESTED_ACTIONS`
  set (`inspect_tres`, `validate_gdscript`, `rerun_test`,
  `manual_review`) between the GDScript implementation and the
  TypeScript port under `mcp-server/src/healing/suggest_action.ts`.

Phase 6A adds two CLI-channel categories that live entirely on the
server side under `mcp-server/src/tools/`:

- **Export** — `export.list_presets`, `export.run_preset`,
  `export.validate_preset`. The run tool spawns
  `godot --headless --export-release` (or `--export-debug`) through the
  shared `SpawnGodot` helper at `src/tools/testing/spawn_godot.ts`. All
  three tools read `export_presets.cfg` through a narrow INI parser at
  `src/tools/export/presets_parser.ts`.
- **Android Deploy** — `android.list_devices`, `android.install_apk`,
  `android.run_logcat`. Wraps the `adb` binary resolved from `ADB_BIN`
  at call time through `src/tools/android/spawn_adb.ts`.

Phase 6A also adds twelve editor-channel categories implemented as
GDScript adapters under `addons/forgekit_core/mcp/editor_plugin/tools/`
(see the **MCP editor plugin** section above) and four runtime-channel
adapters under `addons/forgekit_core/mcp/runtime_bridge/tools/`. The
server-side profile filter picks them up from `profiles.json` so no
server-side code changes are required to expose the new Godot-side
tools.

The `ToolModule` union in `mcp-server/src/profiles.ts` enumerates every
module id recognized by the profile filter. As of v0.7.0 it covers
`core-minimal`, `core`, and the fifteen RPG subsystem modules (`combat`,
`crafting`, `inventory`, `stats`, `effects`, `magic`, `equipment`,
`progression`, `enemies`, `loot`, `spawner`, `chests`, `npc`, `dialog`,
`vendor`). A single valid `forgekit_rpg.key` record unlocks all fifteen
RPG modules (see `MODULE_ID_TO_UNLOCKED` in
`mcp-server/src/licensing/startup.ts`).

**`install-hooks` CLI path resolution**: `src/cli/install_hooks.ts` compiles
to `dist/src/cli/install_hooks.js` (note the `src/` segment — tsc preserves
the source tree layout when `rootDir` is the package root). The
`defaultResolveHookTargets` function walks two `..` segments up from that
compiled file to reach `dist/`, then appends `scripts/git-hooks/` to reach
the compiled hook scripts. Changing the tsconfig `rootDir` or moving the CLI
entry file requires updating the `..` count and the regression test in
`test/cli_install_hooks.test.ts` (the test runs the compiled binary against
a tmp git repo and asserts the shim points at an existing module).

**Release-pipeline helper port**: `mcp-server/src/verify_manifest_tag.ts`
mirrors the pure helpers from `forgekit-rpg/tools/verify-manifest-tag.js`
(the release-pipeline `MANIFEST_TAG_NOT_FOUND` gate) so the Core property
test `test/property_tag_compatibility.test.ts` can exercise
`isValidCoreMinVersion` and `buildTagRefUrl` without a cross-repository
import. Keep the two copies byte-for-byte aligned — the `forgekit-rpg`
shell script is the canonical runtime and this file is the canonical
test subject.

## Observability

The MCP server exposes structured logs, a trace id that follows every
JSON-RPC request end-to-end, and an in-memory metrics registry.

- **JSON Lines log stream.** `mcp-server/src/observability/jsonl_logger.ts`
  (class `JsonlLogger`) writes one line per event under
  `$HOME/.forgekit/logs/<YYYY-MM-DD>.jsonl`. The line shape is shared
  with the Godot side (`addons/forgekit_core/mcp/observability/jsonl_logger.gd`):
  `{ts, level, component, trace_id?, span_id?, method?, duration_ms?, data?}`.
  The minimum level is controlled by the `--mcp-log-level` CLI flag
  (parsed by `parseCliArgs` in `src/index.ts`); lines below the
  threshold are dropped. Files rotate by UTC date; no size-based
  rotation in this phase.
- **Trace ids.** `mcp-server/src/observability/trace.ts` exports
  `generateTraceId()` (8-char lowercase hex), `generateSpanId()`
  (4-char lowercase hex), and `newTraceContext()` which returns a
  fresh `{trace_id, span_id}` pair. The JSON-RPC dispatcher reads a
  `_forgekit_trace` envelope from incoming WebSocket frames; the UDP
  runtime bridge reads a top-level `trace` field. When either is
  absent the server mints a fresh pair so every request is
  correlatable across both streams.
- **Metrics registry.** `mcp-server/src/observability/metrics.ts`
  (class `MetricsRegistry`) offers an idempotent named registry of
  `Counter` and `Histogram` instances. The canonical names declared
  as exported constants match the ones tracked by the health endpoint
  and the Godot side:
  `mcp.requests.total`, `mcp.requests.errors`,
  `mcp.requests.duration_ms`, `mcp.heartbeat.drops`,
  `mcp.reconnect.attempts`, `mcp.reconnect.backoff_ms`,
  `mcp.editor_plugin.undo_stack_size`,
  `mcp.runtime_bridge.udp_packets.received`,
  `mcp.runtime_bridge.udp_packets.rejected`,
  `mcp.healing.retries`. `registerCanonicalMetrics(registry)` registers
  the full set in one call. Histograms keep a rolling window of the
  most recent 1000 samples and report `count`, `sum`, `p50`, `p95`,
  `p99` via `snapshot()` using the nearest-rank percentile rule.
  The `mcp.editor_plugin.undo_stack_size` gauge is declared but
  not yet wired — the `UndoRedoWrapper` has no stack-size signal to
  subscribe to, so the delta emission is deferred to a future pass.
- **Health endpoint.** `mcp-server/src/health_endpoint.ts` (class
  `HealthEndpoint`) binds the first free port in `6040-6049` on
  `127.0.0.1` and merges the chosen port into `mcp_active_port.json`
  under the `"health"` key. Four read-only routes:
    - `GET /health` — `{status, checks: {editor, runtime, cli}}`.
    - `GET /metrics` — Prometheus text rendering of the canonical
      counter + histogram surface. Metric names with dots are
      translated to underscores (`mcp.requests.total` →
      `mcp_requests_total`).
    - `GET /version` — `{server, core_detected, api_version}`;
      `core_detected` resolves from `git describe --tags
      --abbrev=0` at the project root and falls back to `"unknown"`.
    - `GET /trace/:trace_id` — the last 100 JSONL entries matching
      `trace_id`, scanning the last 7 days of log files and sorted
      by `ts` ascending.
- **Update channel.** `mcp-server/src/tools/runtime_bridge/handshake.ts`
  exposes `readLatestVersionFromCache(path)`, which reads the
  `mcp_update_check.json` cache written by the editor-plugin's
  `McpUpdateChecker` and returns the latest version string when an
  update is available (or `null` otherwise). The runtime bridge uses
  this to populate the `server.latest_version` field of the
  `runtime.handshake` response. See the **Updating** section of
  `README.md` for the end-user-facing upgrade command.

## Workspaces

The MCP server is multi-project since v0.9.0. A single server process owns a
`ProjectRegistry` (in-memory singleton under
`mcp-server/src/projects/registry.ts`) mirroring to
`$HOME/.forgekit/workspaces.json`, plus a per-workspace `WorkspaceChannels`
record (`workspace_channels.ts`) that holds the editor / runtime /
visualizer / health ports allocated to that workspace. Port isolation is
enforced by `scanFreePort(range, {excluded, channel})` — every caller
aggregates `WorkspaceChannelsRegistry.allPortsInUse(channel)` into the
`excluded` array so workspace B cannot be handed a port already held by
workspace A.

Five MCP tools manage workspace lifecycle (all `scope=core`, `channel=editor`,
`module=core-minimal`, so they are always available):

- `project.list_workspaces()` — `{workspaces, active_workspace_id, limit: 32}`.
- `project.add({workspace_id, projectRoot, label?, make_active?})` — register
  a new workspace and optionally switch to it.
- `project.remove({workspace_id})` — unregister; auto-promotes the newest
  remaining workspace when the active one is removed.
- `project.switch({workspace_id})` — change the default target for tool
  calls that omit `workspace_id`.
- `project.get_active()` — read the currently active workspace.

Routing: the dispatcher (`projects/resolve_workspace.ts`) turns every
incoming request into a `(Workspace, projectRoot)` pair before forwarding
to the tool handler. An explicit `params.workspace_id` wins, otherwise the
active workspace is used. An explicit `params.projectRoot` that does not
match the resolved workspace returns `WORKSPACE_ROOT_MISMATCH` (`-32022`).
An empty registry with no `workspace_id` returns `NO_ACTIVE_WORKSPACE`
(`-32021`).

Auto-register default: on startup, if no `workspaces.json` exists and
`process.cwd()` contains a `project.godot`, the server registers a single
workspace named `"default"` with that cwd. This preserves the pre-v0.9.0
calling convention end-to-end — clients that only pass `projectRoot` keep
working without change.

Multi-project error codes (`-32015` to `-32022`, JSON-RPC error envelopes
carry `data.workspace_id` / `data.projectRoot` per error class) are
documented in `docs/mcp_api.md`.

## Git hooks

Git hooks are installed from `mcp-server/scripts/git-hooks/`:

- `commit-msg` — Conventional Commits validator. Rejects messages that do
  not match `<type>(<scope>): <subject>` and demands English subjects for
  public repos.
- `pre-commit` — Context Commits enforcer. Reads
  `.forgekit/context-map.json`, finds the anchors matching the staged code
  paths, and rejects the commit if the matching section of `CLAUDE.md` or
  `.cursorrules` was not updated in the same commit. Violations surface as
  JSON-RPC error `-32012` / `CONTEXT_FILE_STALE`.

## ForgeKit RPG

Once `addons/forgekit_rpg/` is installed, agents may:

- Author and edit `.tres` resources under
  `addons/forgekit_rpg/**/items/` and `addons/forgekit_rpg/**/recipes/`.
- Read and call the public API exposed by
  `addons/forgekit_rpg/public_api.gd`.
- Generate new scenes under the project's `scenes/` folder that consume
  that public API.

Script files under `addons/forgekit_rpg/*/` (the subsystem folders:
`combat/`, `crafting/`, `inventory/`, `stats/`) are read-only unless a
task explicitly instructs otherwise, and cross-subsystem imports must go
through `public_api.gd` — direct imports between subsystems fail static
import checks.

## Allowed operations in `addons/forgekit_rpg/`

Once the paid ForgeKit RPG Module is installed, agents may perform the
following operations inside that tree:

- Create and modify `.tres` resources under:
  - `addons/forgekit_rpg/crafting/recipes/`
  - `addons/forgekit_rpg/inventory/items/`
  - Any `*/recipes/` or `*/items/` subdirectory of an RPG subsystem.
- Generate new scenes under `scenes/` in the project root that consume the
  module's public API.
- Call the public API exposed by `addons/forgekit_rpg/public_api.gd`.
- Perform cross-subsystem imports only through `public_api.gd`. Direct imports
  from one subsystem (`combat/`, `crafting/`, `inventory/`, `stats/`) into
  another are forbidden and will fail static import checks.

Script files under `addons/forgekit_rpg/*/` are read-only unless a task
explicitly instructs otherwise.

## MCP tool sequences

Short recipes for common tasks. Execute steps in order.

### Adding a new item

1. `project.list_modules` — confirm `forgekit_rpg` is active.
2. `resource.inspect` on an existing `ItemResource` template to copy the
   field schema.
3. `resource.save` to write the new `.tres` under
   `addons/forgekit_rpg/inventory/items/<id>.tres`.
4. `tests.run_unit` to verify the resource loads and passes validation.

### Debugging a failing crafting test

1. `tests.run_gameplay` to reproduce the failure.
2. Read `Test_Report.failure_message` from the JSON report.
3. `resource.inspect` on the `.tres` files referenced in the failure trace.
4. `resource.apply_fix` with the suggested correction.
5. Re-run `tests.run_gameplay` and confirm green.

### Activating the RPG module license

1. `modules.list` to confirm `forgekit_rpg` is detected but inactive.
2. `modules.activate_license("forgekit_rpg", "<key>")` with the key you
   received from itch.io or Gumroad.
3. Restart the MCP server, or call `project.reload`, so the server rebuilds
   its tool list with the RPG subsystems unlocked.

## Git workflow reminder

- All commits follow Conventional Commits
  (`<type>(<scope>): <subject>`, English). The `commit-msg` hook rejects
  non-conforming messages.
- Code changes that touch files mapped in `.forgekit/context-map.json` must
  update the matching section of `CLAUDE.md` / `.cursorrules` in the same
  commit (Context Commits). The `pre-commit` hook enforces this.
- Use `feature/ai-iteration/<id>` branches for experimental iterations.
  Force pushes are allowed on these branches and they are pruned after 30
  days. Promote stable work to `feature/<topic>` before opening a PR against
  `main`.
