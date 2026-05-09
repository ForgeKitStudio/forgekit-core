# Changelog

All notable changes to the `forgekit-core` repository are documented in
this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
repository follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Release tags that predate this file are filled in retrospectively so
every published tag has a matching entry.

## [Unreleased]

## [0.9.0] - 2026-05-09

### Added

- **Phase 7 — Multi-project support:**
  - **ProjectRegistry.** New `mcp-server/src/projects/` subsystem owns
    the server-process-wide registry of registered Godot projects.
    `register` / `unregister` / `get` / `list` / `getActive` /
    `setActive` / `size` / `serialize` expose the lifecycle; the
    state is mirrored to `$HOME/.forgekit/workspaces.json` via an
    atomic temp-file + rename (`FileSystemWorkspacesPersistence`),
    and `ProjectRegistry.fromDisk()` rehydrates the registry on
    startup.
  - **Per-workspace channels.** `WorkspaceChannelsRegistry`
    (`workspace_channels.ts`) holds the editor / runtime /
    visualizer / health ports each workspace has allocated, plus
    WebSocket and UDP connection placeholders. `allPortsInUse(channel)`
    returns the union across all workspaces so the scanner can
    exclude them in a single pass.
  - **Workspace value type.** `Workspace` interface with immutable
    `workspace_id`, `projectRoot`, `label?`, `registered_at` plus a
    mutable `active` flag. Validation helpers
    `validateWorkspaceId` / `validateLabel` enforce
    `WORKSPACE_ID_REGEX = /^[a-z][a-z0-9_-]{0,63}$/`,
    `MAX_WORKSPACES = 32`, and `MAX_LABEL_LENGTH = 120`.
  - **Dispatcher middleware.** `resolveWorkspace(registry, params)`
    (`projects/resolve_workspace.ts`) turns every incoming
    `(workspace_id, projectRoot)` tuple into a concrete
    `(Workspace, projectRoot)` pair. Four branches: explicit known
    / explicit unknown / implicit active / empty registry. Explicit
    `projectRoot` that diverges from the resolved workspace raises
    `WORKSPACE_ROOT_MISMATCH`.
  - **Auto-register default workspace.** On first startup, if the
    registry is empty and `process.cwd()` contains `project.godot`,
    the server registers a `default` workspace so pre-v0.9.0 clients
    keep working without changes (`auto_register.ts`).
  - **Five new MCP tools.** `project.list_workspaces`,
    `project.switch`, `project.add`, `project.remove`,
    `project.get_active` under `mcp-server/src/tools/project/`. All
    five are `scope: core, channel: editor, module: core-minimal` in
    `profiles.json`, meaning they are always available regardless of
    active profile (including `Minimal`).
  - **Eight new error codes.** `-32015` `WORKSPACE_NOT_FOUND`,
    `-32016` `WORKSPACE_ALREADY_REGISTERED`, `-32017`
    `PROJECT_ROOT_ALREADY_REGISTERED`, `-32018` `INVALID_PROJECT_ROOT`,
    `-32019` `WORKSPACE_LIMIT_EXCEEDED`, `-32020`
    `PORT_RANGE_EXHAUSTED`, `-32021` `NO_ACTIVE_WORKSPACE`,
    `-32022` `WORKSPACE_ROOT_MISMATCH`. Every class carries the
    `data.*` payload documented in `docs/mcp_api.md` Known error
    codes table.
  - **Property tests 49–51.**
    - **Property 49** (`property_registry_determinism.test.ts`,
      `numRuns: 100`, N ∈ [1..50]) — random operation sequences on
      the registry produce identical final state + observations when
      replayed on a fresh registry.
    - **Property 50** (`property_port_isolation.test.ts`,
      `numRuns: 100`) — K ∈ [1..8] sequential
      `scanFreePort(range, {excluded, channel})` calls each seeing
      all previous returns in `excluded` produce K pair-wise distinct
      ports; exhaustion raises `PortRangeExhaustedError` carrying the
      full in-use set.
    - **Property 51** (`property_registry_errors.test.ts`,
      `numRuns: 100` per error class) — every registry error class
      has `code ∈ [-32022, -32015]` and a `data` record matching the
      shape documented in Requirement 74.3; payload round-trips
      through `JSON.stringify` unchanged.
  - **SKILLS.** New `docs/SKILLS/managing_workspaces.md` covering
    the add / switch / remove / get_active flow, error handling,
    and an example agent response for the multi-project scenario.
  - **AI context files.** `CLAUDE.md` + `.cursorrules` gain a
    `## Workspaces` section anchored under the MCP server block.
    `.forgekit/context-map.json` maps
    `mcp-server/src/projects/**/*.ts` to that anchor so the
    Context Commits hook enforces updates.

### Changed

- **`scanFreePort(range, options?)`.** The `scanFreePort` helper in
  `mcp-server/src/port_scanner.ts` accepts an optional second argument
  `{excluded?: ReadonlyArray<number>, channel?: ChannelName}`.
  `excluded` lets multi-workspace callers pre-filter ports already
  taken by sibling workspaces. `channel`, when supplied, switches the
  exhaustion failure from the legacy `RangeExhaustedError` to the
  v0.9.0 `PortRangeExhaustedError` (`-32020`). Backwards-compatible:
  pre-v0.9.0 `scanFreePort(range)` callers still receive the legacy
  error when every port is kernel-occupied.
- **Health endpoint.** `HealthEndpointOptions` gains an optional
  `registry: ProjectRegistry` dependency. When supplied, `/health`
  responses include `workspaces: {count: number, active: string | null}`.
  When omitted, the field is absent so callers predating Phase 7
  continue to see the two-field shape.
- **JSONL logger.** `workspace_id` is added to `RESERVED_FIELDS` in
  both `mcp-server/src/observability/jsonl_logger.ts` and
  `addons/forgekit_core/mcp/observability/jsonl_logger.gd`. The
  dispatcher middleware sets `workspace_id` in log context for every
  request so editor / runtime / CLI logs can be correlated by
  workspace.
- **`docs/mcp_api.md`.** New `Project management (multi-project)`
  section documents the five `project.*` tools. The Known error codes
  table is extended with entries `-32015` through `-32022`. A new
  `Workspace routing (multi-project)` subsection under
  `Observability` documents the per-workspace log correlation and the
  `workspaces` field on `/health`.

### Notes

- Additive MINOR bump — full backwards compatibility with v0.8.x.
  Every existing tool signature continues to accept `projectRoot`,
  and the dispatcher auto-register falls back to the pre-v0.9.0
  single-project behaviour when the server is started inside a
  Godot project directory.
- No error code in the `-32004`..`-32014` range changes semantics.

### Changed

- **npm package renamed from `@forgekit/core-mcp` to
  `@forgekitstudio/core-mcp`** to align with the `ForgeKitStudio`
  GitHub organization and publisher account. Install and update
  commands become `npx -y @forgekitstudio/core-mcp` and
  `npx -y @forgekitstudio/core-mcp@latest`. The global binary name
  (`forgekit-mcp`) and every CLI flag are unchanged. The
  `UPDATE_AVAILABLE` line written to `editor.get_output_log` now
  advertises the new install command. Downstream users must reinstall
  the package under the new scope once it is published; the old
  `@forgekit/core-mcp` name will not receive further releases.

## [0.8.1] - 2026-05-09

### Fixed

- `npm-publish.yml` now installs headless Godot 4.6.2 (matching
  `ci.yml`) so the publish-gate vitest sanity run can execute the
  three property tests that shell out to the Godot binary (P14
  GDScript validator, P15 save-iff-valid, P30 input simulator). The
  gate failed with `spawn godot ENOENT` on every prior tag push
  (v0.6.0, v0.7.0, v0.8.0), blocking the npm publish even though the
  GitHub Release itself landed successfully. First tag that actually
  ships `@forgekitstudio/core-mcp` to the npm registry.

### Notes

- v0.8.0 GitHub Release (the Godot addon ZIP) remains the canonical
  v1.0-feature-parity release. v0.8.1 is a workflow-only patch; no
  code changes in `addons/forgekit_core/` or `mcp-server/src/`.
- Pairs with the same `forgekit-rpg v0.7.0`.

## [0.8.0] - 2026-05-09

### Added

- **Phase 6B — SKILLS pack completion + observability foundation:**
  - **SKILLS pack (Phase 6.15).** Populated the three remaining
    scenario files (`authoring_items.md`,
    `debugging_failing_tests.md`, `self_healing_tres.md`) to the
    same quality as `module_licensing.md`. Every skill now carries
    `api_version: 0.7.0`, a scenario description, an ordered MCP
    tool call sequence, error-handling guidance, and an example
    user query.
  - **Structured logs (Phase 6.16).** New `JsonlLogger` on both
    sides:
    - Godot: `addons/forgekit_core/mcp/observability/jsonl_logger.gd`
      (`class_name McpJsonlLogger`) writing to
      `user://mcp_logs/<component>/<YYYY-MM-DD>.jsonl`. Configurable
      via the `FORGEKIT_MCP_LOG_LEVEL` env var.
    - Server: `mcp-server/src/observability/jsonl_logger.ts`
      writing to `$HOME/.forgekit/logs/<YYYY-MM-DD>.jsonl`.
      Configurable via the `--mcp-log-level` CLI flag already
      parsed by `parseCliArgs`.
    - Shared line shape:
      `{ts, level, component, trace_id?, span_id?, method?, duration_ms?, data?}`
      so a single trace id can be grep'd across streams.
    - Files rotate by UTC date; each line is appended atomically
      with no cross-line buffering.
  - **Trace id + span id (Phase 6.17).**
    - `mcp-server/src/observability/trace.ts` exports
      `generateTraceId()` (8-char lowercase hex),
      `generateSpanId()` (4-char lowercase hex), and
      `newTraceContext()` returning `{trace_id, span_id}`.
    - `McpJsonRpcDispatcher` (editor channel) reads
      `_forgekit_trace` from incoming requests, mints a fresh pair
      when absent, and surfaces the pair through
      `get_last_trace_context()`.
    - `McpBridge` (runtime channel) exposes
      `observe_packet(request)` / `get_last_trace_context()`; the
      UDP server calls the former per accepted packet, reading the
      top-level `trace` field.
  - **Metrics registry (Phase 6.18).**
    - `mcp-server/src/observability/metrics.ts` adds `Counter`,
      `Histogram` (rolling window of 1000 observations with
      nearest-rank `p50/p95/p99`), and a `MetricsRegistry` with
      idempotent `registerCounter(name)` /
      `registerHistogram(name)`.
    - Canonical metric names declared as exported constants:
      `mcp.requests.total`, `mcp.requests.errors`,
      `mcp.requests.duration_ms`, `mcp.heartbeat.drops`,
      `mcp.reconnect.attempts`, `mcp.reconnect.backoff_ms`,
      `mcp.editor_plugin.undo_stack_size`,
      `mcp.runtime_bridge.udp_packets.received`,
      `mcp.runtime_bridge.udp_packets.rejected`,
      `mcp.healing.retries`.
    - `registerCanonicalMetrics(registry)` installs the full set.
    - Dispatcher integration: `McpJsonRpcDispatcher.set_metrics_sink(Callable)`
      surfaces `mcp.requests.total` on every dispatch and
      `mcp.requests.errors` on JSON-RPC error responses. Sinks may
      translate these calls into any downstream metric registry.
  - **Deferred:** `mcp.editor_plugin.undo_stack_size` is declared
    but not automatically emitted — the editor `UndoRedoWrapper`
    has no stack-size signal to subscribe to. Wiring will land in a
    future pass when the wrapper exposes the needed observable.
  - **Health endpoint HTTP server (Phase 6.19).**
    `mcp-server/src/health_endpoint.ts` (class `HealthEndpoint`)
    binds the first free port in `6040-6049` on `127.0.0.1` and
    merges the chosen port into `mcp_active_port.json` under the
    `"health"` key. Four read-only routes:
    - `GET /health` — `{status, checks: {editor, runtime, cli}}`
      with the `ok`/`degraded`/`down` roll-up.
    - `GET /metrics` — Prometheus text format rendering the
      canonical counter + histogram surface.
    - `GET /version` — `{server, core_detected, api_version}`; the
      `core_detected` field resolves from
      `git describe --tags --abbrev=0` and falls back to `"unknown"`.
    - `GET /trace/:trace_id` — the last 100 JSONL entries (across
      the last 7 UTC days) matching the supplied `trace_id`, sorted
      by `ts` ascending.
  - **Update channels (Phase 6.22).**
    - `addons/forgekit_core/mcp/editor_plugin/update_checker.gd`
      (`class_name McpUpdateChecker`) polls the GitHub releases
      endpoint for `ForgeKitStudio/forgekit-core` at most once per
      hour and appends a single
      `UPDATE_AVAILABLE: ForgeKit Core v<new> available (running
      v<current>). Run 'npx -y @forgekitstudio/core-mcp@latest' to
      upgrade.` line to `editor.get_output_log` when a newer Core
      version is detected. The HTTP client is injected so the
      checker runs headlessly under tests and silently no-ops on
      network failure. Rate-limit cache lives at
      `user://mcp_update_check.json`.
    - `mcp-server/src/tools/runtime_bridge/handshake.ts` exposes
      `readLatestVersionFromCache(path)` so the runtime bridge can
      populate the `server.latest_version` field of the
      `runtime.handshake` response from the same cache. Returns
      `null` when no newer version is known.
    - `modules.check_compatibility` result shape extended with
      `required` and `installed` aliases for `core_min_version` /
      `core_version` so callers following the requirements-document
      language (`{compatible: false, required, installed}`) can
      read the same fact without reshaping the result client-side.
      Existing `core_min_version` / `core_version` fields are
      preserved.
    - `README.md` now carries an **Updating** section documenting
      `npx -y @forgekitstudio/core-mcp@latest`, the `UPDATE_AVAILABLE`
      signal, and `modules.check_compatibility` as the
      authoritative tool for module / Core compatibility checks.

### Added (Phase 6A — previous sub-delivery)

- **Phase 6A — 67 new MCP tools across 14 categories filling the v1.0
  Full parity gap with competing Godot MCP servers:**
  - **Animation** (6 editor-channel tools): `animation.list`, `animation.play`,
    `animation.stop`, `animation.add_track`, `animation.insert_keyframe`,
    `animation.remove_track`. Three mutating tools UndoRedo-wrapped.
  - **TileMap** (6 editor-channel tools): `tilemap.set_cell`,
    `tilemap.get_cell`, `tilemap.fill_rect`, `tilemap.clear_layer`,
    `tilemap.import_from_json`, `tilemap.export_to_json`. Five mutating
    tools UndoRedo-wrapped.
  - **Theme / UI** (6 editor-channel tools): `theme.create`,
    `theme.set_default_font`, `theme.set_color`, `theme.set_stylebox`,
    `ui.build_control_tree`, `ui.apply_layout_preset`. All UndoRedo-wrapped.
  - **Shader** (6 editor-channel tools): `shader.create`, `shader.validate`,
    `shader.save_with_validation`, `shader.set_uniform`,
    `shader.list_uniforms`, `shader.convert_visual_to_text`. Four mutating
    tools UndoRedo-wrapped.
  - **Physics** (6 tools, 3 editor + 3 runtime): editor-channel
    `physics.set_gravity`, `physics.get_collision_layer_names`,
    `physics.configure_layer` (atomic `project.godot` writes via
    `McpProjectSettingsAtomicWriter`); runtime-channel `physics.raycast`,
    `physics.shape_cast`, `physics.query_point`.
  - **3D Scene** (6 editor-channel tools): `scene3d.add_mesh_instance`,
    `scene3d.add_light`, `scene3d.add_camera`, `scene3d.set_environment`,
    `scene3d.bake_lightmap`, `scene3d.import_gltf`. Five mutating tools
    UndoRedo-wrapped.
  - **Particle** (5 editor-channel tools): `particle.create_gpu`,
    `particle.create_cpu`, `particle.set_emission_shape`,
    `particle.preview_in_editor`, `particle.convert_cpu_to_gpu`. Four
    mutating tools UndoRedo-wrapped.
  - **Navigation** (6 tools, 4 editor + 2 runtime): editor-channel
    `navigation.bake_mesh`, `navigation.add_agent`, `navigation.set_avoidance`,
    `navigation.configure_layers`; runtime-channel `navigation.find_path`,
    `navigation.debug_draw`.
  - **Audio** (6 tools, 4 editor + 2 runtime): editor-channel
    `audio.list_buses`, `audio.set_bus_volume_db`, `audio.add_bus_effect`,
    `audio.import_sound`; runtime-channel `audio.play_stream`,
    `audio.stop_stream`.
  - **AnimationTree** (4 editor-channel tools): `animation_tree.create`,
    `animation_tree.set_parameter`, `animation_tree.get_parameters`,
    `animation_tree.set_active`. Three mutating tools UndoRedo-wrapped.
  - **State Machine** (3 tools, 1 editor + 2 runtime): editor-channel
    `state_machine.list_states`; runtime-channel `state_machine.travel`,
    `state_machine.get_current`.
  - **Blend Tree** (1 editor-channel tool): `blend_tree.configure_node`.
    UndoRedo-wrapped.
  - **Export** (3 CLI-channel tools): `export.list_presets`,
    `export.run_preset`, `export.validate_preset`. The run tool spawns
    `godot --headless --export-release` (or `--export-debug`) through
    the shared `SpawnGodot` helper.
  - **Android Deploy** (3 CLI-channel tools): `android.list_devices`,
    `android.install_apk`, `android.run_logcat`. Wraps the `adb` binary
    resolved from `ADB_BIN` at call time.
- **67 new entries** in `mcp-server/profiles.json` covering the 14
  categories above (all `scope: core`, `module: core`; channel mix:
  48 editor, 10 runtime, 9 cli).
- **Adapter files** under
  `addons/forgekit_core/mcp/editor_plugin/tools/`:
  `animation_tools.gd`, `tilemap_tools.gd`, `theme_ui_tools.gd`,
  `shader_tools.gd`, `physics_tools.gd`, `scene3d_tools.gd`,
  `particle_tools.gd`, `navigation_tools.gd`, `audio_tools.gd`,
  `animation_tree_tools.gd`, `state_machine_tools.gd`,
  `blend_tree_tools.gd`.
- **Runtime adapter files** under
  `addons/forgekit_core/mcp/runtime_bridge/tools/`:
  `physics_runtime_tools.gd`, `navigation_runtime_tools.gd`,
  `audio_runtime_tools.gd`, `state_machine_runtime_tools.gd`.
- **CLI-channel TypeScript modules** under `mcp-server/src/tools/`:
  `export/list_presets.ts`, `export/run_preset.ts`,
  `export/validate_preset.ts`, `export/presets_parser.ts`,
  `export/errors.ts`, `android/list_devices.ts`, `android/install_apk.ts`,
  `android/run_logcat.ts`, `android/spawn_adb.ts`.
- **`plugin_lifecycle.gd`** extended with twelve new factory Callables
  (one per editor-channel Phase 6A category) wired through a shared
  registration loop. Backwards-compatible: lifecycles pre-dating
  Phase 6A continue to work without the new factories.
- **`docs/mcp_api.md`** — 14 new sections covering the Phase 6A tool
  surface with params, results, and channel routing notes.
- **Visualizer category (5 new MCP tools)**: `visualizer.start`,
  `visualizer.stop`, `visualizer.render_scene_tree`,
  `visualizer.render_module_graph`, `visualizer.render_event_bus`. The
  browser visualizer's HTTP server now also serves `/api/module_graph`
  and `/api/event_bus` endpoints alongside the existing
  `/api/scene_tree`, and the HTML view exposes three tabs with a
  colour-coded force-directed layout (scene=blue, module=green, event
  bus=amber).
- **Asset Generation category (4 new MCP tools)**:
  `assetgen.sprite_from_svg`, `assetgen.atlas_pack`,
  `assetgen.noise_texture`, `assetgen.icon_set`. Every write is routed
  through `McpUndoRedoWrapper` so a single Ctrl+Z reverts the mutation.
  Backends: `McpSvgRasterizer`, `McpTexturePacker`, `McpNoiseGenerator`,
  `McpIconSetGenerator` under `addons/forgekit_core/mcp/editor_plugin/asset_generator/`.
- **Self-Healing category (5 new MCP tools)**: `healing.suggest_action`,
  `healing.inspect_failure`, `healing.get_retry_count`,
  `healing.reset_retry_count`, `healing.apply_and_retest`. Per-session
  retry counter with a hard limit of 3; on exhaustion the suggester
  escalates to `manual_review` regardless of failure-message rules.
  Emits a `retry_exhausted` signal at the limit and can push a
  `mcp.healing.retries` counter into an injected metrics sink.
- **14 new entries** in `mcp-server/profiles.json` for the three tool
  categories above (all `scope: core`, `channel: editor`, `module: core`).
- **4 new property tests**:
  - **Property 22** (`tests/property/test_healing_retry_limit.gd`,
    GDScript / CoreFuzz, 100 iterations) — self-healing escalates to
    `manual_review` after 3 failed repair attempts.
  - **Property 23** (`mcp-server/test/property_suggested_action_set.test.ts`,
    fast-check, `numRuns: 100`) — every `suggested_action` lies in
    `{"inspect_tres", "validate_gdscript", "rerun_test", "manual_review"}`.
  - **Property 24** (`mcp-server/test/property_resource_inspect.test.ts`,
    fast-check, `numRuns: 100`) — `inspectTres(...)` surfaces injected
    mutations and emits a `suggested_fix` for missing-reference cases.
  - **Property 25** (`mcp-server/test/property_apply_fix_undo.test.ts`,
    fast-check, `numRuns: 100`) — `apply_fix` followed by the editor
    UndoRedo undo restores the original file byte-for-byte.
- **`mcp-server/src/healing/suggest_action.ts`** — TypeScript port of
  the GDScript suggester rule set.
- **`mcp-server/src/healing/resource_inspect.ts`** — pure-TypeScript
  `.tres` inspector / fixer used by Properties 24 and 25.
- **`docs/mcp_api.md`** — Visualizer, Asset Generation, and
  Self-Healing sections documenting the 14 new tools.

### Changed

- **`plugin_lifecycle.gd`** now accepts optional factories for the
  dispatcher, visualizer HTTP server, and three tool adapters. Older
  callers that only wire `server_factory` remain valid.
- **`http_server.gd`** for the visualizer exposes
  `set_module_provider()` and `set_event_bus_provider()` callbacks.
- **`ui/index.html`** replaces the single scene-tree view with a
  three-tab layout backed by view-specific endpoints and styling.

## [0.7.0] - 2026-05-09

### Added

- Six new `GameEvents` signals consumed by the forgekit_rpg world
  layer (phase 6):
  - `died(victim: StringName, killer: StringName)` — unblocks the
    Phase 5 guarded-no-op XPSystem auto-subscribe. `killer` is
    `&""` for environmental, suicide, or poison-tick deaths.
  - `chest_opened(chest_id: StringName, opener: StringName)` — fires
    exactly once per `TreasureChest` instance.
  - `scene_transition_requested(from_scene: String, to_scene: String,
    target_spawn_point: StringName)` — a `Door` or `Portal` asks
    gameplay code to change scenes.
  - `dialog_started(npc_id: StringName, dialog_tree_id: StringName)`
    and `dialog_completed(npc_id: StringName, dialog_tree_id:
    StringName, outcome: StringName)` — `DialogRunner` lifecycle.
  - `shop_transaction(actor: StringName, vendor_id: StringName,
    transaction_type: StringName, item_id: StringName, amount: int,
    currency_delta: int)` — every `Vendor` buy or sell.
- `_matches_type` helper gains `String` support for the
  `scene_transition_requested` payload.
- `list_signals()` now returns 17 entries (was 11 in v0.6.0).
- `ToolModule` union in `mcp-server/src/profiles.ts` extended with
  seven phase 6 categories: `enemies`, `loot`, `spawner`, `chests`,
  `npc`, `dialog`, `vendor`.
- `MODULE_ID_TO_UNLOCKED[forgekit_rpg]` extended from 8 to 15
  categories; a single valid `forgekit_rpg.key` record now unlocks
  the fifteen RPG subsystems.
- 31 new tool entries added to `profiles.json` covering the seven new
  categories.

### Notes

- Additive MINOR bump. No existing signal, schema, or API removed or
  retyped.
- Pairs with [`forgekit-rpg` v0.7.0](https://github.com/ForgeKitStudio/forgekit-rpg/releases/tag/v0.7.0)
  which ships the subsystem implementations behind the new tool
  entries.

## [0.6.0] - 2026-05-05

### Added

- Two new `GameEvents` signals for phase 5 progression:
  - `xp_gained(owner: StringName, amount: float, source: StringName)`
    — fires once per `XPSystem.grant_xp(...)` call, before any
    resulting level-up signals.
  - `leveled_up(owner: StringName, new_level: int, reward_tier:
    StringName)` — fires once per level crossed.
- `progression` added to the `ToolModule` union and to the
  `RPG-only` profile unlock set (now 8 RPG subsystems).
- 8 new `progression.*` tool entries registered in `profiles.json`
  (`grant_xp`, `get_state`, `allocate_stat_point`, `reset`,
  `list_curves`, `get_curve`, `list_rewards`, `get_reward`).

## [0.5.1] - 2026-05-02

### Added

- `EquipableItemResource` resource class under
  `addons/forgekit_core/resources/` for the phase 4B equipment
  subsystem. Extends `ItemResource` with `slot`, `stat_modifiers`,
  `status_effects_on_equip`, and `requirements` fields.

### Notes

- Landed as a separate minor bump over v0.5.0 because the
  `GameEvents` signals shipped first and claimed the v0.5.0 tag; the
  resource class could not land under the same tag without breaking
  the release note history.

## [0.5.0] - 2026-05-01

### Added

- Five new `GameEvents` signals for phase 4B (magic, effects,
  equipment):
  - `status_effect_ticked`, `status_effect_expired`,
  - `spell_cast`,
  - `item_equipped`, `item_unequipped`.
- `effects`, `magic`, `equipment` added to the `ToolModule` union
  and to the `RPG-only` profile unlock set (now 7 RPG subsystems).
- Tool entries for the phase 4B categories registered in
  `profiles.json`.

## [0.3.0] - 2026-04-15

### Added

- Runtime MCP bridge (`addons/forgekit_core/mcp/runtime_bridge/`) with
  UDP transport, packet parser, auth token verification, and the
  initial set of runtime tool adapters (inventory, crafting, scene
  control, profiling, input simulation).
- Initial RPG subsystem registry: `combat`, `crafting`, `inventory`,
  `stats` unlocked by a valid `forgekit_rpg` license.
- Published retrospectively as a GitHub Release after discovering that
  `integration-with-core` CI jobs needed the release artifact for the
  RPG module's compatibility check (see follow-up FU-0.3).

## [0.2.0] - 2026-04-01

### Added

- MCP editor plugin over WebSocket with port scanner, heartbeat,
  auto-reconnect, JSON-RPC 2.0 dispatcher, and the initial editor tool
  surface (scene, node, script, resource, editor, input, analysis,
  batch/refactor).
- `UndoRedoWrapper` wrapping every mutating editor tool in an
  `EditorUndoRedoManager` action.
- `ProjectSettingsAtomicWriter` performing atomic read-modify-write
  through temp-file plus rename for `project.godot`.

## [0.1.0] - 2026-03-15

### Added

- ForgeKit Core MVP. Base resources (`ItemResource`, `RecipeResource`),
  `TresLoader`, `GameEvents` autoload with type-validated `emit_validated`,
  `Core_Boundary`, `ModuleManifest` + `ModuleLoader`,
  `GDScriptValidator`, `TestReport`.
- MCP server skeleton (`@forgekitstudio/core-mcp`) with port scanner,
  profile registry (`Full`, `Lite`, `Minimal`, `RPG-only`),
  `stdio_bridge`, `type_parser`.
- Core MCP tool surface: `project.*`, `tests.*`, `gdscript.validate`,
  `test_report.*`.
- Property tests covering round-trip invariants, event bus propagation,
  core/rpg import boundary, and validator behaviour.

## [0.0.1] - 2026-03-01

### Added

- Template repository skeleton: autoloaded `GameEvents` and `McpBridge`
  stubs, placeholder `addons/forgekit_core/` tree, configuration
  templates (`plugin_config.tres.template`, `runtime_config.tres.template`),
  `CLAUDE.md` and `.cursorrules` placeholders, `docs/SKILLS/` placeholders,
  `.github/workflows/ci.yml` with GUT / property / gameplay / check-imports
  / language-policy / check-pr-template jobs, release and npm publish
  workflows, git hook installer (`commit-msg`, `pre-commit`) covering
  Conventional Commits and Context Commits enforcement.

[Unreleased]: https://github.com/ForgeKitStudio/forgekit-core/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/ForgeKitStudio/forgekit-core/releases/tag/v0.9.0
[0.8.1]: https://github.com/ForgeKitStudio/forgekit-core/releases/tag/v0.8.1
[0.8.0]: https://github.com/ForgeKitStudio/forgekit-core/releases/tag/v0.8.0
[0.7.0]: https://github.com/ForgeKitStudio/forgekit-core/releases/tag/v0.7.0
[0.6.0]: https://github.com/ForgeKitStudio/forgekit-core/releases/tag/v0.6.0
[0.5.1]: https://github.com/ForgeKitStudio/forgekit-core/releases/tag/v0.5.1
[0.5.0]: https://github.com/ForgeKitStudio/forgekit-core/releases/tag/v0.5.0
[0.3.0]: https://github.com/ForgeKitStudio/forgekit-core/releases/tag/v0.3.0
