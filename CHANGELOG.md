# Changelog

All notable changes to the `forgekit-core` repository are documented in
this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
repository follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Release tags that predate this file are filled in retrospectively so
every published tag has a matching entry.

## [Unreleased]

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
- MCP server skeleton (`@forgekit/core-mcp`) with port scanner,
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

[Unreleased]: https://github.com/ForgeKitStudio/forgekit-core/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/ForgeKitStudio/forgekit-core/releases/tag/v0.7.0
[0.6.0]: https://github.com/ForgeKitStudio/forgekit-core/releases/tag/v0.6.0
[0.5.1]: https://github.com/ForgeKitStudio/forgekit-core/releases/tag/v0.5.1
[0.5.0]: https://github.com/ForgeKitStudio/forgekit-core/releases/tag/v0.5.0
[0.3.0]: https://github.com/ForgeKitStudio/forgekit-core/releases/tag/v0.3.0
