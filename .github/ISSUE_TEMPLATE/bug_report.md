---
name: Bug report
about: Report a defect in ForgeKit Core or the MCP server
title: "[bug] <short summary>"
labels: ["bug", "triage"]
assignees: []
---

## Summary

A clear and concise description of the problem.

## Affected Component

- [ ] `addons/forgekit_core/` (Godot addon)
- [ ] `mcp-server/` (`@forgekitstudio/core-mcp` npm package)
- [ ] Git hooks (`commit-msg`, `pre-commit`)
- [ ] CI workflows (`.github/workflows/`)
- [ ] Documentation / SKILLS

## Environment

- ForgeKit Core version or commit SHA:
- `@forgekitstudio/core-mcp` version:
- Godot version:
- Operating system and version:
- MCP client (Claude Desktop, Cursor, Kiro, ...):

## Steps to Reproduce

1. ...
2. ...
3. ...

## Expected Behavior

Describe what you expected to happen.

## Actual Behavior

Describe what actually happened. Include any error codes (for example `CORE_BOUNDARY_VIOLATION`, `FILE_NOT_FOUND`).

## Logs and Test Reports

Paste the relevant portions of `user://mcp_logs/<component>/<date>.jsonl`, CI logs, or the JSON output of `tests.run_unit` / `tests.run_property`.

```
<paste log or test report here>
```

## Additional Context

Screenshots, links to related issues, or any other information that helps reproduce the problem.
