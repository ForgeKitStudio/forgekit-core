---
skill: authoring-items
title: Authoring a new ItemResource
api_version: 0.0.0
updated: 2026-05-05
---

# Authoring a new ItemResource

> **Status:** Phase 0 placeholder. The concrete MCP tool sequence and examples
> are populated in Phase 6 of the ForgeKit implementation plan, once the
> editor plugin, runtime bridge, and resource tooling are available.

## Scenario

Use this skill when the user wants to introduce a new in-game item — for
example, a crafting ingredient, a consumable, or an equipment piece — and
wire it into an existing inventory and, optionally, a crafting recipe.

The skill covers:

- Creating a new `ItemResource` `.tres` file under the project's item
  directory.
- Populating `id`, `display_name`, `icon`, and `stack_size` fields.
- Validating the resource and confirming that the project still loads
  without errors.

Full step-by-step guidance will be written in Phase 6.

## MCP tool call sequence

> **TODO (Phase 6):** Fill in the ordered list of MCP tool calls. The sequence
> is expected to include (subject to change):
>
> 1. `project.info` — confirm the active Godot project and API version.
> 2. `project.list_modules` — confirm that the target module (e.g.
>    `forgekit_rpg`) is installed and enabled.
> 3. `resource.load` — inspect an existing `ItemResource` to copy its shape.
> 4. `resource.save` — write the new `.tres` file through the atomic writer
>    and undo-redo wrapper.
> 5. `resource.inspect` — verify the new resource parses cleanly.
> 6. `tests.run_unit` — run the item-related unit tests and confirm they
>    still pass.

Each step will document required parameters, expected response fields, and
the decision points an agent should evaluate before moving on.

## Example user query

> **TODO (Phase 6):** Replace with a realistic user prompt once the tool
> sequence is finalised, for example:
>
> > "Add a new crafting ingredient called `iron_ore` with stack size 99 and
> > wire it into the existing smelting recipes."
