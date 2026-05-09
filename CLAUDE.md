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
(`@forgekit/core-mcp`) for editor, CLI, and runtime integrations. The optional
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

Declaring a new global signal is a Core change (v0.5.0: nine signals declared, see reference below): it must be added to
`game_events.gd` together with an entry in the internal `_SIGNAL_SCHEMAS`
dictionary. Client code may not redeclare or shadow these signals.

As of v0.5.0 the bus declares nine signals in total; see the full reference below.

### Declared signals (9 total as of v0.5.0)

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

## Resources

`ItemResource` (`addons/forgekit_core/resources/item_resource.gd`) and
`RecipeResource` (`addons/forgekit_core/resources/recipe_resource.gd`) are
the canonical data containers. Both expose `validate() -> Array[String]` and
`to_dict` / `from_dict` for stable round-trips through the MCP surface.

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
be rolled back. This section is a placeholder that will be expanded as the
editor tool surface lands in later phases.

## MCP runtime bridge

Runtime-side tools (gameplay state inspection, hot-reload hooks) live under
`addons/forgekit_core/mcp/runtime_bridge/`. The `McpBridge` autoload is
registered in `project.godot` and exposes the runtime surface to the MCP
server over a local transport. Like the editor plugin, this tree is
read-only for agents and expands in later phases.

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

**`install-hooks` CLI path resolution**: `src/cli/install_hooks.ts` compiles
to `dist/src/cli/install_hooks.js` (note the `src/` segment — tsc preserves
the source tree layout when `rootDir` is the package root). The
`defaultResolveHookTargets` function walks two `..` segments up from that
compiled file to reach `dist/`, then appends `scripts/git-hooks/` to reach
the compiled hook scripts. Changing the tsconfig `rootDir` or moving the CLI
entry file requires updating the `..` count and the regression test in
`test/cli_install_hooks.test.ts` (the test runs the compiled binary against
a tmp git repo and asserts the shim points at an existing module).

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
