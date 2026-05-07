---
skill: self-healing-tres
title: Self-healing a corrupted or outdated .tres resource
api_version: 0.0.0
updated: 2026-05-05
---

# Self-healing a corrupted or outdated `.tres` resource

> **Status:** Phase 0 placeholder. The concrete MCP tool sequence and examples
> are populated in Phase 6 of the ForgeKit implementation plan, once
> `resource.inspect` / `resource.apply_fix` and the atomic writer are fully
> wired up.

## Scenario

Use this skill when a `.tres` resource (such as an `ItemResource`,
`RecipeResource`, or scene asset) fails to load because it contains an
unknown field, a field with the wrong type, or a reference that no longer
resolves, and the user wants the agent to propose and apply a minimal
repair.

The skill covers:

- Detecting the corrupted or outdated resource via `resource.inspect`.
- Reading the structured issue list and `suggested_fix` returned by the
  inspector.
- Applying the fix atomically so that the change is reversible through
  Godot's undo-redo.
- Re-running the relevant tests to confirm the repair.

Full step-by-step guidance will be written in Phase 6.

## MCP tool call sequence

> **TODO (Phase 6):** Fill in the ordered list of MCP tool calls. The sequence
> is expected to include (subject to change):
>
> 1. `resource.inspect` — load the `.tres` file and read its `issues[]`
>    list and `suggested_fix` field.
> 2. `transaction.begin` — open a transaction so that multiple repair
>    steps collapse into a single undoable action.
> 3. `resource.apply_fix` — apply the suggested repair atomically.
> 4. `resource.inspect` — re-inspect to confirm that `issues[]` is empty.
> 5. `transaction.commit` — commit the transaction.
> 6. `tests.run_unit` — run any tests that depend on the repaired
>    resource.

Each step will document required parameters, expected response fields, and
the decision points an agent should evaluate before moving on (including
when to call `transaction.rollback` instead of `transaction.commit`).

## Example user query

> **TODO (Phase 6):** Replace with a realistic user prompt once the tool
> sequence is finalised, for example:
>
> > "The `iron_ingot.tres` recipe won't load after the last update — can
> > you figure out what's broken and repair it?"
