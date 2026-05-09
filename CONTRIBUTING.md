# Contributing to ForgeKit Core

Thank you for your interest in ForgeKit Core. This document describes the workflow, commit conventions, and branch strategy used across the `ForgeKitStudio/forgekit-core` and `ForgeKitStudio/forgekit-rpg` repositories.

All communication in this repository, including issues, pull requests, commit messages, branch names, and code comments, must be written in English. Internal specification and design notes kept outside the public repository may be written in other languages.

## Getting Started

1. Fork the repository (external contributors) or create a feature branch (maintainers).
2. Clone your fork or the main repository locally.
3. Open the project in Godot 4.3+ and verify that it launches without errors.
4. Install the MCP server dependencies: `cd mcp-server && npm ci`.
5. Install the git hooks: `npx @forgekitstudio/core-mcp install-hooks`.
6. Run the test suite once before making changes: `bash tools/cli_runner/run_tests.sh`.

## Branch Strategy

We use an AI-native branching model:

- `main` is protected. Pushes require a pull request, one approving review, and all required CI checks green. Force pushes and deletions are disabled.
- `feature/<topic>` is used for stable proposals that are intended for `main`. Example: `feature/event-bus-introspection`.
- `feature/ai-iteration/<id>` is used for experimental iterations by an LLM agent. Force pushes are allowed, reviews are not required, and branches older than 30 days are pruned automatically by a scheduled workflow.

Do not commit directly to `main`. Always open a pull request.

## Conventional Commits

All commit messages must follow the [Conventional Commits](https://www.conventionalcommits.org/) specification. The header (first non-empty line) must match:

```
<type>(<scope>)?!?: <subject>
```

- `type` is required and must be one of the eleven values listed below.
- `scope` is optional. When present it is wrapped in parentheses and must not contain whitespace or nested parentheses. Use lowercase, hyphenated identifiers.
- `!` is an optional breaking-change marker placed immediately before the colon.
- `:` must be followed by exactly one space and then the subject.
- `subject` is a short imperative summary. It must be non-empty and must not end with a period.

### Allowed Types

| Type       | When to use |
|------------|-------------|
| `feat`     | A new user-facing feature or capability. Triggers a minor SemVer bump. |
| `fix`      | A bug fix in existing behavior. Triggers a patch SemVer bump. |
| `docs`     | Documentation-only changes (README, CHANGELOG, docs/, inline doc comments). |
| `style`    | Formatting, whitespace, or code-style adjustments that do not change behavior. |
| `refactor` | Code changes that neither add a feature nor fix a bug (rename, extract, restructure). |
| `perf`     | Performance improvements without behavioral changes. |
| `test`     | Adding or updating tests, including property-based tests and fixtures. |
| `build`    | Changes to the build system, packaging, or external dependencies (`package.json`, `tsconfig`, Godot export presets). |
| `ci`       | Changes to CI configuration, GitHub Actions workflows, or CI helper scripts. |
| `chore`    | Routine maintenance that does not fit the categories above (dependency bumps, tooling housekeeping). |
| `revert`   | Reverts a previous commit. The subject should reference the reverted commit hash or subject. |

### Breaking Changes

Append `!` immediately before the colon to signal a breaking change in the public API:

- `feat(mcp)!: rename node.set_property to node.update_property`
- `refactor(core)!: drop Godot 4.2 support`

A breaking change must also be documented in `CHANGELOG.md` and bump the major SemVer component on the next release.

### Valid Examples

- `feat(event-bus): add list_signals introspection`
- `fix(mcp): prevent crash when runtime port is taken`
- `docs(skills): document self-healing workflow`
- `refactor(resources): extract ItemResource validation into helper`
- `perf(validator): cache parsed AST between validate calls`
- `test(event-bus): add property test for payload type rejection`
- `build: pin vitest to 1.6.0`
- `ci(hooks): run commit-msg test suite on every PR`
- `chore(ci): bump GitHub Actions runners to ubuntu-24.04`
- `revert: feat(event-bus): add list_signals introspection`
- `feat(mcp)!: remove deprecated scene.reload tool`

### Invalid Examples

| Rejected header | Reason |
|-----------------|--------|
| `added event bus introspection` | Missing `type` and `: ` separator. |
| `Feat(event-bus): add list_signals` | `type` is case-sensitive and must be lowercase. |
| `feature(event-bus): add list_signals` | `feature` is not one of the allowed types. |
| `feat(Event Bus): add list_signals` | `scope` must not contain spaces. |
| `feat((event-bus)): add list_signals` | `scope` must not contain nested parentheses. |
| `feat(event-bus):add list_signals` | Missing the single space after the colon. |
| `feat(event-bus): ` | `subject` is empty. |
| `feat(event-bus): add list_signals introspection.` | `subject` must not end with a period. |
| `feat(event-bus) : add list_signals` | Stray space before the colon. |

Commit messages that do not match this format are rejected by the `commit-msg` hook with error code `-32013 CONVENTIONAL_COMMITS_FORMAT_VIOLATION`. The error payload includes the list of `allowed_types`, the `expected_format`, and the `received` header so the author can correct it.

### Bypassed Headers

The validator intentionally accepts auto-generated commit classes that are not produced by hand:

- `Merge ...` — merge commits created by `git merge`.
- `fixup! ...` — commits created by `git commit --fixup`.
- `squash! ...` — commits created by `git commit --squash`.

These headers pass validation because they are rewritten during a subsequent rebase, where the final message is subject to the same rules.

## Context Commits

The files `CLAUDE.md` and `.cursorrules` are the contract that LLM agents rely on across sessions. When the description of a subsystem drifts from its source code, subsequent AI iterations plan against outdated rules and introduce regressions. To keep the contract in sync, every commit that modifies a tracked code path must also update the matching anchor section of both context files **in the same commit**. We call such a commit a *Context Commit*.

### Tracked Path Patterns

The path-to-anchor mapping is declared in `.forgekit/context-map.json`. A commit is subject to the Context Commit rule when any staged file matches one of these patterns:

| Path pattern                                         | Anchors that must be updated                              |
|------------------------------------------------------|-----------------------------------------------------------|
| `addons/forgekit_core/event_bus/**/*.gd`             | `CLAUDE.md#event-bus`, `.cursorrules#event-bus`           |
| `addons/forgekit_core/resources/**/*.gd`             | `CLAUDE.md#resources`, `.cursorrules#resources`           |
| `addons/forgekit_core/manifest/**/*.gd`              | `CLAUDE.md#manifest`, `.cursorrules#manifest`             |
| `addons/forgekit_core/mcp/editor_plugin/**/*.gd`     | `CLAUDE.md#mcp-editor-plugin`, `.cursorrules#mcp-editor-plugin` |
| `addons/forgekit_core/mcp/runtime_bridge/**/*.gd`    | `CLAUDE.md#mcp-runtime-bridge`, `.cursorrules#mcp-runtime-bridge` |
| `addons/forgekit_core/mcp/licensing/**/*.gd`         | `CLAUDE.md#mcp-licensing`, `.cursorrules#mcp-licensing`   |
| `addons/forgekit_core/boundary/**/*.gd`              | `CLAUDE.md#core-boundary`, `.cursorrules#core-boundary`   |
| `mcp-server/src/**/*.ts`                             | `CLAUDE.md#mcp-server`, `.cursorrules#mcp-server`         |
| `mcp-server/scripts/git-hooks/**/*.ts`               | `CLAUDE.md#git-hooks`, `.cursorrules#git-hooks`           |
| `addons/forgekit_rpg/**/*.gd`                        | `CLAUDE.md#forgekit-rpg`, `.cursorrules#forgekit-rpg`     |

If you add a new subsystem or move files to a new directory, update `.forgekit/context-map.json` in the same commit that introduces the code, and add the corresponding anchor headings to `CLAUDE.md` and `.cursorrules`.

### Discovering Which Anchors to Update

1. Stage your code changes with `git add`.
2. Run `git diff --cached --name-only` to list staged files.
3. For each staged file, find the first matching `pattern` entry in `.forgekit/context-map.json`. The `anchors` array lists the markdown headings that must also appear in the commit diff.
4. Open `CLAUDE.md` and `.cursorrules`, navigate to each anchor heading, and update the text to reflect the new behavior, public API, or constraints introduced by your code change.
5. Stage the updated context files with `git add CLAUDE.md .cursorrules` and commit.

Anchor headings use GitHub-style slugs: `# Event Bus` becomes `#event-bus`, `# MCP Editor Plugin` becomes `#mcp-editor-plugin`. The `pre-commit` hook verifies that the diff of each required context file touches lines under the matching heading.

### What to Write in the Context Update

Keep the entry focused on contracts that the next AI session needs to know:

- Public API surface (class names, function signatures, signal names).
- Invariants enforced by the code (e.g., "`ItemResource.stack_size >= 1`").
- Cross-subsystem dependencies (e.g., "`Crafting_Manager` emits `GameEvents.crafting_completed`").
- Error codes that tools may return.

Do **not** duplicate implementation details that are visible in the source. The goal is a high-level map, not a second copy of the code.

### Example Workflow

You add a new method `GameEvents.list_signals() -> Array[String]` to `addons/forgekit_core/event_bus/game_events.gd`:

1. Stage the code: `git add addons/forgekit_core/event_bus/game_events.gd`.
2. Look up the pattern `addons/forgekit_core/event_bus/**/*.gd` in `.forgekit/context-map.json`. Anchors: `CLAUDE.md#event-bus` and `.cursorrules#event-bus`.
3. Under the `# Event Bus` heading in both files, add a line: `- Introspection: call GameEvents.list_signals() to enumerate declared global signals.`
4. Stage both context files: `git add CLAUDE.md .cursorrules`.
5. Commit: `git commit -m "feat(event-bus): add list_signals introspection"`.

The `pre-commit` hook sees that `game_events.gd` is tracked, confirms that both anchor sections are present in the diff, and accepts the commit.

### Error Reporting

If the hook detects a staged code file whose required anchor section is missing from the diff, the commit is rejected with JSON-RPC error `-32012 CONTEXT_FILE_STALE`. The payload lists the offending files and the specific anchors that were not updated:

```json
{
  "code": -32012,
  "message": "CONTEXT_FILE_STALE",
  "data": {
    "files": ["addons/forgekit_core/event_bus/game_events.gd"],
    "missing_anchors": [
      "CLAUDE.md#event-bus",
      ".cursorrules#event-bus"
    ]
  }
}
```

Update the listed anchors, re-stage, and commit again.

### Bypassing the Hook

In emergencies (hotfix, hook malfunction, cherry-pick of a legacy commit), you may bypass the check with `git commit --no-verify`. The skip is appended to `.git/hooks/context-commit-skips.log` with fields `{ts, author, files, reason}`. The log is reviewed during release preparation; every skip should be followed by a context-only follow-up commit that restores the sync. Do not use `--no-verify` as a routine workflow.

## Pull Request Process

1. Open a pull request targeting `main`.
2. Fill in every section of the pull request template:
   - **Test Report**: paste the JSON output of `tests.run_unit` and `tests.run_property` (minimum 100 iterations per property).
   - **Gameplay Scenarios**: paste the JSON output of `tests.run_gameplay`.
   - **Affected MCP Tools**: list any MCP tools whose contract changed, formatted as `<category>.<tool>`.
   - **Breaking Changes**: link to the relevant CHANGELOG entry and the `api.version` bump.
3. Ensure every required status check passes: `ci / tests-unit`, `ci / tests-property`, `ci / tests-gameplay`, `ci / check-imports`, `ci / language-policy`, `ci / check-pr-template`.
4. Request review from a maintainer. Address feedback by pushing additional commits rather than force-pushing, unless the branch is `feature/ai-iteration/*`.
5. A maintainer merges the pull request using squash merge or rebase, preserving the Conventional Commit message.

## Releases

Releases are produced automatically by `.github/workflows/release.yml` and `.github/workflows/npm-publish.yml` when a tag matching `v*` is pushed to `main`. Tags must be valid SemVer (`vX.Y.Z`) and must match the `version` field in `mcp-server/package.json`.

## Reporting Issues

Use the issue templates under `.github/ISSUE_TEMPLATE/`. For security vulnerabilities, follow the private disclosure process described in `SECURITY.md`.

## License

By contributing to this repository, you agree that your contributions will be licensed under the MIT License that covers the project.
