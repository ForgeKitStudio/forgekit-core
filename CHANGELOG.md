# Changelog

All notable changes to the `forgekit-core` repository are documented in
this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
repository follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Release tags that predate this file are filled in retrospectively so
every published tag has a matching entry.

## [Unreleased]

### Added

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
