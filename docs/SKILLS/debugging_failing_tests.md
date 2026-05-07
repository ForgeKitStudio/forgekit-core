---
skill: debugging-failing-tests
title: Debugging a failing GUT or property test
api_version: 0.0.0
updated: 2026-05-05
---

# Debugging a failing GUT or property test

> **Status:** Phase 0 placeholder. The concrete MCP tool sequence and examples
> are populated in Phase 6 of the ForgeKit implementation plan, once the
> GUT test runner, property test harness, and `test_report` tooling are
> available end-to-end.

## Scenario

Use this skill when a unit test (GUT) or property test returns a `failed`
status in a `TestReport`, and the user wants the agent to diagnose the root
cause and propose a fix.

The skill covers:

- Parsing a `TestReport` JSON payload and extracting `failure_message`,
  `stack_trace`, and (for property tests) the shrunk `counterexample`.
- Re-running the failing test with a fixed seed to reproduce the failure.
- Inspecting the implicated resource, scene, or script.
- Proposing a minimal fix and running the test again to confirm it passes.

Full step-by-step guidance will be written in Phase 6.

## MCP tool call sequence

> **TODO (Phase 6):** Fill in the ordered list of MCP tool calls. The sequence
> is expected to include (subject to change):
>
> 1. `test_report.parse` — load the failing `TestReport` from the previous
>    run.
> 2. `tests.run_unit` or `tests.run_property` — re-run the failing case with
>    the reported `seed` to reproduce the failure locally.
> 3. `resource.inspect` or `search.code` — examine the file or resource
>    flagged by `failure_message` and `stack_trace`.
> 4. `gdscript.validate` — validate any proposed script change before
>    saving it.
> 5. `resource.apply_fix` or `gdscript.save_with_validation` — apply the
>    minimal fix through the undo-redo wrapper.
> 6. `tests.run_unit` / `tests.run_property` — confirm the test now passes
>    and that no other test regresses.

Each step will document required parameters, expected response fields, and
the decision points an agent should evaluate before moving on.

## Example user query

> **TODO (Phase 6):** Replace with a realistic user prompt once the tool
> sequence is finalised, for example:
>
> > "The `test_crafting_invariants` property test is failing with a
> > counterexample — figure out what's wrong and fix it."
