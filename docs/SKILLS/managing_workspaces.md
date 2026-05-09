---
skill: managing-workspaces
title: Managing multiple Godot projects from one MCP server
api_version: 0.9.0
updated: 2026-05-09
---

# Managing multiple Godot projects from one MCP server

Use this skill when the user runs a single `@forgekit/core-mcp`
process against more than one Godot project. Phase 7 introduces a
`ProjectRegistry` plus five `project.*` tools so a single server
instance can hold several workspaces at once, with per-workspace
port isolation and per-workspace license directories. This skill
covers listing workspaces, registering a second one, switching
between them, and confirming the active target before mutating work.

## When to run this skill

- The user opens a second Godot project while the server is still
  running the first one.
- The user complains that tool calls are hitting the wrong project.
- CI spawns one MCP server for several client repositories.
- The user asks "which project is active?" or "can you switch to
  `client-a`?".

## MCP tool call sequence

1. `project.list_workspaces` — enumerate current workspaces and
   surface `active_workspace_id`. If the registry is empty and the
   server was started inside a Godot project directory, the
   auto-register on startup will have put a `default` workspace in
   there; if the list is still empty after that, move on to step 2.

2. `project.add` (optional) — register the new project. Supply an
   absolute `projectRoot` that points at a directory containing
   `project.godot`. Pick a human-readable `label`. Set
   `make_active: true` if the next tool calls should target this new
   workspace.

3. `project.switch` — change the active workspace when the caller
   wants to switch the default for subsequent tool calls without
   passing `workspace_id` on every request.

4. Issue the actual work (for example `scene.open`, `resource.save`,
   `tests.run_unit`). Tool calls either pass an explicit
   `workspace_id`, or rely on the active workspace as the default.

5. `project.switch` back to the original workspace when finished so
   later tool calls by other agents do not accidentally land in the
   wrong project.

## Expected agent response shape

Always acknowledge the active workspace before mutating, for example:

> Active workspace is `client-a` (`/Users/dev/projects/client-a`).
> Running `scene.open` for the `Main.tscn` resource there now.

When switching:

> Switching from `client-a` to `client-b`. Will run `tests.run_unit`
> against `/Users/dev/projects/client-b`.

## Error handling

| JSON-RPC code | Symbol                              | When to surface a retry vs escalate                                                                                                                                                    |
| ------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-32015`      | `WORKSPACE_NOT_FOUND`               | User typoed `workspace_id`. Re-run `project.list_workspaces` to show the real list before retrying.                                                                                 |
| `-32016`      | `WORKSPACE_ALREADY_REGISTERED`      | Re-registration with divergent fields. Ask the user whether to remove the old record first (`project.remove`) or supply the original fields.                                         |
| `-32017`      | `PROJECT_ROOT_ALREADY_REGISTERED`   | The `projectRoot` already belongs to a different `workspace_id`. Suggest using the existing id instead of creating a duplicate.                                                      |
| `-32018`      | `INVALID_PROJECT_ROOT`              | `data.reason` tells you whether the path is not absolute, not a directory, or missing `project.godot`. Ask the user to confirm the path or to initialize the project with Godot first. |
| `-32019`      | `WORKSPACE_LIMIT_EXCEEDED`          | 32 workspaces already registered. Ask the user to `project.remove` an obsolete one before adding a new one.                                                                          |
| `-32020`      | `PORT_RANGE_EXHAUSTED`              | Every editor / runtime / visualizer / health port is taken. Escalate: surface `data.channel` + `data.in_use` and ask the user to stop an unused Godot instance.                       |
| `-32021`      | `NO_ACTIVE_WORKSPACE`               | Registry is empty and the call omitted `workspace_id`. Run `project.add` first, or retry with an explicit `workspace_id`.                                                            |
| `-32022`      | `WORKSPACE_ROOT_MISMATCH`           | Client passed both `workspace_id` and `projectRoot` and they diverge. Drop one or the other — prefer `workspace_id` for multi-project flows.                                         |

## Example user query

> I'm running the MCP server from my home directory, but I want to
> open `Main.tscn` in my client-a project and then switch to
> client-b. Help me set that up.

Agent response:

1. Call `project.list_workspaces` — the list is empty (the server's
   cwd is not a Godot project).
2. Call `project.add` with `workspace_id="client-a"`,
   `projectRoot="/Users/dev/projects/client-a"`,
   `make_active=true`.
3. Call `scene.open` with `path="res://Main.tscn"`.
4. Call `project.add` with `workspace_id="client-b"`,
   `projectRoot="/Users/dev/projects/client-b"`.
5. Call `project.switch` with `workspace_id="client-b"`.
6. Continue the client-b work.
7. When done, `project.switch` back to `client-a` or
   `project.remove` the workspaces that are finished.

## Related skills

- `authoring_items.md` — once a workspace is active, authoring
  flows the usual way through `resource.save`.
- `debugging_failing_tests.md` — `tests.run_gameplay` honours the
  active workspace when the caller omits `workspace_id`.
- `module_licensing.md` — each workspace has its own
  `user://licenses/` mirror, so activating `forgekit_rpg` in
  `client-a` does not leak profile unlocks into `client-b`.
