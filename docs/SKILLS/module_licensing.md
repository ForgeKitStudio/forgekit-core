---
skill: module-licensing
title: Inspecting and activating ForgeKit module licenses
api_version: 0.7.0
updated: 2026-05-09
---

# Inspecting and activating ForgeKit module licenses

Use this skill when the user has purchased a paid ForgeKit module (for
example, `forgekit_rpg`), downloaded the ZIP from itch.io or Gumroad,
extracted it into `addons/forgekit_rpg/`, and now wants the agent to
verify compatibility with the installed ForgeKit Core version, activate
the license, and confirm that the module's tools are available.

The skill covers:

- Listing installed modules and their license status.
- Inspecting a module manifest (`module.manifest.tres`) to read
  `license_id`, `core_min_version`, and `source_repo`.
- Activating the license key and persisting the activation record.
- Verifying that module-scoped MCP tools are exposed in the active
  profile (typically `RPG-only`).

## Currently recognized modules

As of Core v0.7.0, the MCP server recognizes a single paid module
(`forgekit_rpg`) whose license unlocks fifteen subsystem tool categories
under one license key:

`combat`, `crafting`, `inventory`, `stats`, `effects`, `magic`,
`equipment`, `progression`, `enemies`, `loot`, `spawner`, `chests`,
`npc`, `dialog`, `vendor`.

The mapping from `license_id` to unlocked tool categories lives in
`mcp-server/src/licensing/startup.ts` (`MODULE_ID_TO_UNLOCKED`). Future
paid modules (for example, `forgekit_survivors`) will register
additional entries there.

## MCP tool call sequence

Execute these calls in order after the user has extracted the paid
module ZIP into their project's `addons/` folder.

1. **`modules.list`** — list every module discovered under
   `addons/forgekit_*/`. The response shows each module's `id`,
   `version`, current license state, and whether the module is enabled.
   The target module (`forgekit_rpg`) should appear with a license
   status of `"not_activated"` at this point.
2. **`modules.inspect_manifest`** — read the manifest of the target
   module. Parameters: `{ "module_id": "forgekit_rpg" }`. The response
   carries `{ id, version, core_min_version, license_id, source_repo }`.
   Use this to surface the purchase origin to the user (`source_repo`)
   and the minimum Core version needed (`core_min_version`).
3. **`modules.check_compatibility`** — confirm that the installed Core
   version satisfies `core_min_version`. Parameters: `{ "module_id":
   "forgekit_rpg" }`. Response shape: `{ compatible: bool, installed,
   required }`. If `compatible` is `false`, the server also emits a
   `CORE_VERSION_MISMATCH` structured log line identifying the gap; ask
   the user to upgrade Core (for example, pull the latest release from
   `ForgeKitStudio/forgekit-core`) before activating.
4. **`modules.activate_license`** — activate the license key and write
   the activation record. Parameters: `{ "module_id": "forgekit_rpg",
   "license_key": "<key>" }`. On success the server persists
   `{ license_id, activated_at, fingerprint }` to
   `user://licenses/<module_id>.key` and returns the same triple. On
   failure the server returns a JSON-RPC error with a code in the
   `INVALID_LICENSE_*` family (expired, fingerprint mismatch, unknown
   module id); surface the raw message to the user without reformatting.
5. **`modules.enable`** — enable the module so its tools become
   available to the active profile. Parameters: `{ "module_id":
   "forgekit_rpg" }`. This is a no-op when the module is already
   enabled; safe to call unconditionally after a successful activation.
6. **`project.list_modules`** — confirm the module is now listed as
   enabled with the expected `license_id`. Response includes the same
   fields as `modules.list` but filtered to enabled modules only.
7. **`project.info`** (optional) — re-read server state and confirm
   that `modules_count` increased. Useful when the user wants a
   one-call sanity check after activation.

## Expected profile effect

After step 5 (`modules.enable`), a server started with `--profile
RPG-only` will include every tool tagged with one of the fifteen RPG
subsystem categories in its advertised tool list. Before activation,
`--profile RPG-only` exposes only the `core-minimal` tool set.

The caller can verify the profile effect by listing tools through the
MCP client's standard tool discovery call and checking that
`enemies.spawn`, `crafting.execute`, `progression.grant_xp`, and the
other Phase 3–6 RPG tool categories appear in the response.

## Example user query

> "I just downloaded `forgekit_rpg` from itch.io and extracted it into
> `addons/forgekit_rpg/`. Activate my license key
> `XXXX-XXXX-XXXX-XXXX` and make sure the RPG tools are available."

Expected agent response:

1. Run `modules.list` to confirm the module is detected.
2. Run `modules.inspect_manifest` on `forgekit_rpg` and surface the
   version and `core_min_version`.
3. Run `modules.check_compatibility`. Stop and ask the user to upgrade
   Core if the response is `compatible: false`.
4. Run `modules.activate_license` with the key the user provided.
5. Run `modules.enable`, then `project.list_modules`, and summarize
   the now-available categories (`combat`, `crafting`, ..., `vendor`).

## Handling `CORE_VERSION_MISMATCH`

When `modules.check_compatibility` reports incompatibility, the server
also writes a structured log line with this shape:

```json
{
  "level": "warn",
  "component": "module_loader",
  "code": "CORE_VERSION_MISMATCH",
  "module_id": "forgekit_rpg",
  "required": "0.7.0",
  "installed": "0.6.0"
}
```

Report the required and installed versions back to the user verbatim,
and point them at the matching Core release on
`ForgeKitStudio/forgekit-core/releases`. Do not attempt to activate the
license until the Core upgrade lands — the activation will succeed,
but the module's tools will still refuse to load at runtime.

## Related skills

- `self_healing_tres.md` — diagnosing malformed `.tres` files the paid
  module ships.
- `debugging_failing_tests.md` — triaging GUT failures after a module
  upgrade.
