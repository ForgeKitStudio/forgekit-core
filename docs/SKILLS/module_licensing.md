---
skill: module-licensing
title: Inspecting and activating ForgeKit module licenses
api_version: 0.0.0
updated: 2026-05-05
---

# Inspecting and activating ForgeKit module licenses

> **Status:** Phase 0 placeholder. The concrete MCP tool sequence and examples
> are populated in Phase 6 of the ForgeKit implementation plan, once the
> `modules.*` tool family and the license activator are fully implemented.

## Scenario

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
  profile (e.g. `RPG-only`).

Full step-by-step guidance will be written in Phase 6.

## MCP tool call sequence

> **TODO (Phase 6):** Fill in the ordered list of MCP tool calls. The sequence
> is expected to include (subject to change):
>
> 1. `modules.list` — list installed modules and their current license and
>    enabled state.
> 2. `modules.inspect_manifest` — read the manifest of the target module
>    (`id`, `version`, `core_min_version`, `license_id`, `source_repo`).
> 3. `modules.check_compatibility` — confirm that `core_min_version` is
>    satisfied by the installed ForgeKit Core.
> 4. `modules.activate_license` — activate the license key and write the
>    activation record to `user://licenses/<module_id>.key`.
> 5. `modules.enable` — enable the module so that its tools become
>    available to the agent.
> 6. `project.list_modules` — confirm that the module is now listed as
>    enabled with the expected `license_id`.

Each step will document required parameters, expected response fields, and
the decision points an agent should evaluate before moving on (including
how to handle `CORE_VERSION_MISMATCH` warnings).

## Example user query

> **TODO (Phase 6):** Replace with a realistic user prompt once the tool
> sequence is finalised, for example:
>
> > "I just downloaded `forgekit_rpg` from itch.io and extracted it into
> > `addons/`. Activate my license key `XXXX-XXXX-XXXX-XXXX` and make
> > sure the RPG tools are available."
