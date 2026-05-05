# Contributing to ForgeKit Core

Thank you for your interest in ForgeKit Core. This document describes the workflow, commit conventions, and branch strategy used across the `ForgeKitStudio/forgekit-core` and `ForgeKitStudio/forgekit-rpg` repositories.

All communication in this repository, including issues, pull requests, commit messages, branch names, and code comments, must be written in English. Internal specification and design notes kept outside the public repository may be written in other languages.

## Getting Started

1. Fork the repository (external contributors) or create a feature branch (maintainers).
2. Clone your fork or the main repository locally.
3. Open the project in Godot 4.3+ and verify that it launches without errors.
4. Install the MCP server dependencies: `cd mcp-server && npm ci`.
5. Install the git hooks: `npx @forgekit/core-mcp install-hooks`.
6. Run the test suite once before making changes: `bash tools/cli_runner/run_tests.sh`.

## Branch Strategy

We use an AI-native branching model:

- `main` is protected. Pushes require a pull request, one approving review, and all required CI checks green. Force pushes and deletions are disabled.
- `feature/<topic>` is used for stable proposals that are intended for `main`. Example: `feature/event-bus-introspection`.
- `feature/ai-iteration/<id>` is used for experimental iterations by an LLM agent. Force pushes are allowed, reviews are not required, and branches older than 30 days are pruned automatically by a scheduled workflow.

Do not commit directly to `main`. Always open a pull request.

## Conventional Commits

All commit messages must follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>)?: <subject>
```

- `type` must be one of: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- `scope` is optional, lowercase, no spaces. Typical scopes: `core`, `mcp`, `event-bus`, `resources`, `ci`, `hooks`.
- `subject` is a short imperative summary without a trailing period.

Examples:

- `feat(event-bus): add list_signals introspection`
- `fix(mcp): prevent crash when runtime port is taken`
- `docs(skills): document self-healing workflow`
- `chore(ci): bump GitHub Actions runners to ubuntu-24.04`

Commit messages that do not match this format are rejected by the `commit-msg` hook with error code `-32013 CONVENTIONAL_COMMITS_FORMAT_VIOLATION`.

## Context Commits

When a commit modifies files in `addons/forgekit_core/**/*.gd`, `mcp-server/src/**/*.ts`, or `addons/forgekit_rpg/**/*.gd`, and the file has a corresponding entry in `.forgekit/context-map.json`, the matching section of `CLAUDE.md` and `.cursorrules` must be updated in the same commit.

The `pre-commit` hook enforces this rule and rejects commits that leave context files stale with error code `-32012 CONTEXT_FILE_STALE`. To bypass the hook in emergencies, use `git commit --no-verify`; the skip is logged to `.git/hooks/context-commit-skips.log`.

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
