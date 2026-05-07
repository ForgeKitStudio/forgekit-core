<!--
Thanks for contributing to ForgeKit Core. All four sections below are required
and will be validated by the `check-pr-template` CI job. Pull requests that leave
any section empty or omit required content will fail with error
`PR_TEMPLATE_INCOMPLETE` and cannot be merged.

AI agents: populate each JSON block programmatically via the MCP tools
`test_report.parse` and `test_report.serialize(report, { pretty: true })`.
Human contributors: run the tests locally, copy the resulting JSON artifact
from `artifacts/` or the CI run summary, and paste it inside the fenced code
blocks below.
-->

## Summary

<!-- One-paragraph description of the change and its motivation. -->

## Test Report

<!--
Paste the JSON output of `test_report.serialize(report, { pretty: true })`
combining results from `tests.run_unit` and `tests.run_property`. The property
portion MUST report at least 100 iterations per property. If a property test
failed, include the `counterexample` field verbatim.
-->

```json
{
  "run_id": "",
  "timestamp": "",
  "total": 0,
  "passed": 0,
  "failed": 0,
  "tests": []
}
```

## Gameplay Scenarios

<!--
Paste the JSON output of `test_report.serialize` for every `tests.run_gameplay`
scenario relevant to this change (for example crafting, combat, inventory).
Use one fenced block per scenario or a single array if multiple scenarios were
executed in the same run.
-->

```json
{
  "run_id": "",
  "timestamp": "",
  "scenarios": []
}
```

## Affected MCP Tools

<!--
List every MCP tool whose input or output contract changed in this pull
request, one per line in the form `<category>.<tool>` (for example
`scene.open`, `crafting.execute`, `inventory.add_item`). Write `none` if no
tool contracts were touched.
-->

- `none`

## Breaking Changes

<!--
If this change is backwards-incompatible, link the matching entry in
`CHANGELOG.md` and state the new `api.version` (SemVer: MAJOR bump for breaking
changes, MINOR for additions, PATCH for fixes). If the change is fully
backwards-compatible, write `none`.
-->

- CHANGELOG entry: `none`
- `api.version` bump: `none`

## Checklist

- [ ] `tests.run_unit` executed and results pasted above
- [ ] `tests.run_property` executed with >= 100 iterations per property
- [ ] `tests.run_gameplay` executed for every affected scenario
- [ ] `CLAUDE.md` and `.cursorrules` updated when code in `addons/forgekit_core/`, `mcp-server/src/`, or `addons/forgekit_rpg/` changed
- [ ] Commit messages follow Conventional Commits (`<type>(<scope>): <subject>`)
- [ ] CI is green on this branch
