# ForgeKit SKILLS Pack

This directory contains scenario-based guides ("skills") for LLM clients that
integrate with ForgeKit through the Model Context Protocol (MCP). Each skill
describes a single, concrete workflow — for example, authoring a new item,
debugging a failing crafting test, or healing a corrupted `.tres` resource —
along with the exact sequence of MCP tool calls an agent should perform to
complete it.

Skills are intended to be installed into the skill directory of your IDE or LLM
client (Kiro, Claude Code, Cursor, Antigravity, etc.). When installed, the
agent receives short, high-signal instructions alongside its MCP tool surface,
which reduces guesswork and makes tool sequencing more reliable.

## Contents

| File | Scenario |
|------|----------|
| [`authoring_items.md`](./authoring_items.md) | Create a new `ItemResource` and wire it into an inventory. |
| [`debugging_failing_tests.md`](./debugging_failing_tests.md) | Investigate a failing GUT / property test and propose a fix. |
| [`self_healing_tres.md`](./self_healing_tres.md) | Detect and repair corrupted or outdated `.tres` resources. |
| [`module_licensing.md`](./module_licensing.md) | Inspect, activate, and verify module licenses (e.g. `forgekit_rpg`). |

Additional skills may be added in later phases. Contributions that follow the
format described below are welcome through pull requests to
[`ForgeKitStudio/forgekit-core`](https://github.com/ForgeKitStudio/forgekit-core).

## Skill file format

Every skill file in this directory MUST contain the following sections:

1. **Front matter** — a fenced block at the top of the file with the skill
   metadata, including the `api_version` field (see "Versioning" below).
2. **Scenario** — a short paragraph describing the task the skill solves and
   when an agent should invoke it.
3. **MCP tool call sequence** — an ordered list of MCP tool invocations
   (e.g. `project.list_modules`, `resource.inspect`, `resource.apply_fix`),
   with the parameters each call expects and the fields to read from the
   response before moving on.
4. **Example user query** — a natural-language prompt a human might send to
   the LLM client to trigger the skill.

The front matter format is:

```yaml
---
skill: <kebab-case-id>
title: <short title>
api_version: <semver matching @forgekitstudio/core-mcp>
updated: <YYYY-MM-DD>
---
```

## Versioning

Skills are versioned together with the `@forgekitstudio/core-mcp` package and the
`addons/forgekit_core/` addon. The `api_version` field in each skill file
MUST match the major and minor version of the MCP server the skill targets.
When a new ForgeKit Core version is released, every skill file is reviewed
and its `api_version` is bumped in the same release pull request.

- `api_version: 0.0.0` — Phase 0 placeholder. Contents are skeletons only.
- `api_version: 0.1.x` — Phase 1 ForgeKit Core MVP (Event Bus, base resources,
  initial MCP tool surface). Skills are populated with tool sequences.
- `api_version: 0.7.x` — Phase 6B populated skill surface. Targets the
  editor-plugin tools (`resource.inspect`, `resource.save`,
  `project.list_modules`, `tests.run_unit`), runtime-channel diagnostics
  (`runtime.is_connected`, `runtime.get_logs`), self-healing
  (`healing.suggest_action`, `healing.inspect_failure`,
  `healing.get_retry_count`, `healing.reset_retry_count`,
  `resource.apply_fix`), and `modules.*` licensing.
- Later versions follow semantic versioning. A breaking change in any MCP
  tool contract referenced by a skill requires a major version bump in both
  the MCP server and the affected skill.

## Installation

To install the skills into your LLM client, copy the files from this directory
into the client's skill directory, or run:

```sh
npx @forgekitstudio/core-mcp install-skills
```

The `install-skills` command is introduced alongside the MCP server in a later
phase; until then, copy the files manually.

## Status

As of Phase 6B all four skill files are populated with full scenario
content targeting `api_version: 0.7.x`:

| File | Status |
|------|--------|
| `authoring_items.md` | Populated. |
| `debugging_failing_tests.md` | Populated. |
| `self_healing_tres.md` | Populated. |
| `module_licensing.md` | Populated. |
