---
skill: debugging-failing-tests
title: Debugging a failing GUT or gameplay test
api_version: 0.7.0
updated: 2026-05-16
---

# Debugging a failing GUT or gameplay test

Use this skill when a crafting, inventory, combat, or other gameplay
test is failing and the user wants the agent to diagnose the root
cause and propose a minimal fix before handing off a concrete code or
`.tres` change.

The skill covers:

- Reproducing the failure under a fixed seed.
- Verifying that the runtime bridge and editor plugin are both
  reachable before the agent starts inspecting engine state.
- Pulling the editor error panel and the combined output log.
- Pulling the runtime log stream for the most recent test run.
- Asking the self-healing suggester for a canonical action label
  (`inspect_tres`, `validate_gdscript`, `rerun_test`, or
  `manual_review`) and then drilling into the matching inspector.

## MCP tool call sequence

Execute these calls in order. Stop on the first transport failure and
report the response verbatim to the user.

1. **`tests.run_gameplay`** — reproduce the failing test with the
   seed reported in the last `TestReport`. For the iron-ingot recipe
   the default invocation is:
   ```json
   {
     "test_name": "test_iron_ingot_recipe",
     "seed": 42
   }
   ```
   The response `TestReport.status` should come back as `"failed"`.
   The `failure_message` and `stack_trace` fields carry the first
   hints about what went wrong.
2. **`runtime.is_connected`** — confirm the `McpBridge` autoload is
   active before relying on runtime tools. A `connected: false`
   response means the game was not launched with `--mcp-bridge`;
   stop and ask the user to relaunch before continuing with the
   runtime-channel steps below.
3. **`editor.get_errors`** — pull the editor's "Errors" panel. GDScript
   parse errors and autoload boot failures appear here first, before
   they show up in any test output. A non-empty response usually
   points at a GDScript parse error (see the `suggested_action`
   table below).
4. **`editor.get_output_log`** — pull the combined stdout/stderr from
   the last editor session, filtered to the last 500 lines. Look for
   `push_error` emissions from `GameEvents.emit_validated` or
   `TresLoader` — they identify malformed `.tres` files referenced by
   the failing test.
5. **`runtime.get_logs`** — pull the runtime log stream for the
   failing test. Pass `{"max_lines": 200, "level": "warn"}` to keep
   the response focused on warnings and errors. Timing flakes almost
   always surface here as stray `push_warning` lines from the test
   fixture.
6. **`healing.suggest_action`** — submit the failing `TestReport` so
   the suggester can map the failure to a canonical action. The
   response is `{ action: <one of inspect_tres | validate_gdscript |
   rerun_test | manual_review>, reason: <string> }`.
7. **`healing.inspect_failure`** — call with the same `TestReport`
   and the `action` from step 6 to get a structured payload pointing
   at the exact `.tres` file, GDScript line, or timing window to
   investigate. The response includes a `suggested_fix` field when
   the failure looks mechanical; otherwise the field is empty and the
   agent should escalate.

## Expected agent response

After step 7, summarize to the user:

- The failing test name and the seed that reproduces it.
- The canonical `suggested_action` from the suggester.
- The file or line the inspector points at.
- A one-paragraph proposal for a fix, linked back to the specific
  failure class below.

## Common failure classes

The suggester maps every recognized failure to one of four canonical
actions. Three of them come up often in gameplay tests:

- **Malformed `.tres`** → `inspect_tres`. Examples: unknown field,
  wrong field type, dangling `ext_resource` reference after a recipe
  rename. Hand off to the `self_healing_tres.md` skill to apply a
  `resource.apply_fix` and re-run the test.
- **GDScript parse error** → `validate_gdscript`. Examples:
  mismatched brackets, typo in a method name, unknown autoload.
  `editor.get_errors` surfaces the line number. Fix the file through
  `gdscript.save_with_validation` — the tool refuses to save until
  the parse is clean, so a passing write is proof the original parse
  error was the cause.
- **Timing flake** → `rerun_test`. Examples: a physics tick beat a
  signal by one frame, a coroutine timed out. `runtime.get_logs`
  shows sporadic `push_warning` lines but no hard errors. Rerun the
  test once with the same seed; if it passes the second time the
  flake is confirmed and the fix belongs in the test fixture, not
  the production code.

The fourth action, `manual_review`, is emitted when the suggester has
no confident mapping or when the retry budget is exhausted. Stop and
report a short summary to the user instead of attempting more fixes.

## Error handling

- **`runtime.is_connected` returns `connected: false`.** The runtime
  channel is not available. Stop and ask the user to relaunch Godot
  with `--mcp-bridge` before retrying.
- **`tests.run_gameplay` returns `status: "errored"`** (not
  `"failed"`). The test fixture itself crashed — the suggester is
  unreliable in that case. Report the `failure_message` and stop.
- **`healing.inspect_failure` returns an empty `suggested_fix`.** The
  suggester cannot propose a mechanical fix. Escalate to the user
  with the raw `failure_message` and `stack_trace` instead of
  guessing.

## Example user query

> "The `iron_ingot` crafting test is failing, can you look into it?"

Expected agent response:

1. Run `tests.run_gameplay` with `test_name: "test_iron_ingot_recipe"`
   and the seed from the last `TestReport`. Report `failed`.
2. Run `runtime.is_connected` and confirm the bridge is up.
3. Pull `editor.get_errors` and `editor.get_output_log` to catch
   parse errors and `push_error` lines from the event bus.
4. Pull `runtime.get_logs` with `level: "warn"` to look for timing
   warnings.
5. Run `healing.suggest_action` with the failing `TestReport`.
6. Run `healing.inspect_failure` with the suggested action.
7. Summarize: test name, suggested action, file/line, proposed fix.

## Related skills

- `self_healing_tres.md` — apply a `resource.apply_fix` after the
  suggester returns `inspect_tres`.
- `authoring_items.md` — author a replacement `.tres` when the
  inspector reports a missing resource rather than a malformed one.
- `module_licensing.md` — confirm the RPG module is active before
  blaming the test fixture for a missing subsystem.
