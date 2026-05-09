---
skill: self-healing-tres
title: Self-healing a malformed .tres resource
api_version: 0.7.0
updated: 2026-05-16
---

# Self-healing a malformed `.tres` resource

Use this skill when a `.tres` resource (such as an `ItemResource`,
`RecipeResource`, `EquipableItemResource`, or a gameplay scene's
inline sub-resource) fails to load or fails validation, and the user
wants the agent to repair it automatically under a bounded retry
budget before escalating to a manual review.

The skill covers:

- Detecting the malformed resource via `resource.inspect` and reading
  the structured issue list plus `suggested_fix` field.
- Applying the fix atomically through `resource.apply_fix` so the
  write routes through `McpUndoRedoWrapper` and appears in Godot's
  undo stack as a single `Ctrl+Z` entry.
- Verifying the repair with a narrowly scoped property test run.
- Tracking the per-resource retry counter and escalating to
  `manual_review` once the hard limit of three attempts is hit.

## MCP tool call sequence

Execute these calls in order. Each attempt through steps 1-3 counts
as one retry; if step 4 reports `retries >= 3` without a green test
run, hand off to the user instead of looping again.

1. **`resource.inspect`** — load the `.tres` file and surface its
   issue list. Parameters: `{ "path": "res://.../item.tres" }`. The
   response shape is
   `{ valid: bool, issues: [{field, kind, message}], suggested_fix }`.
   A non-empty `issues[]` array with a non-empty `suggested_fix`
   means the file is a candidate for automatic repair.
2. **`resource.apply_fix`** — apply the suggester's fix atomically.
   Parameters: `{ "path": "res://.../item.tres", "fix": <copy of the
   suggested_fix from step 1> }`. The write goes through
   `McpProjectSettingsAtomicWriter` (temp-file + rename) and the
   change is labeled `MCP: resource.apply_fix <basename>` in the
   editor's undo stack. A successful response carries the new file
   content's fingerprint so callers can verify the write landed on
   disk as expected.
3. **`tests.run_property`** — re-run the property suite that covers
   the repaired resource. For `ItemResource` the default entry is
   `test_item_resource_roundtrip`. A green run proves the fix did not
   break the round-trip invariant. A red run means the suggester's
   fix was wrong — loop back to step 1 and let the inspector pick a
   different fix, or escalate to step 5 if the retry counter says
   "enough."
4. **`healing.get_retry_count`** — read the current retry counter
   for the target resource path. Parameters:
   `{ "resource_path": "res://.../item.tres" }`. The response is
   `{ count: int, limit: 3 }`. The counter is session-scoped: it
   starts at zero when the MCP session boots and increments once per
   `resource.apply_fix` call on the same path.
5. **`healing.reset_retry_count`** — clear the counter once the
   property test comes back green. Parameters:
   `{ "resource_path": "res://.../item.tres" }`. Skipping this step
   leaks retries: the next time the same file breaks, the agent
   starts closer to the `manual_review` escalation threshold than
   necessary.

## Retry budget and escalation

The retry counter enforces a hard limit of **three** attempts per
resource per session. On the fourth `resource.apply_fix` call the
backing `McpRetryCounter` emits `retry_exhausted`, and
`healing.suggest_action` starts returning `manual_review` even when
the underlying failure still looks mechanical. This keeps the agent
from looping indefinitely when the suggester has a blind spot.

Concretely, the loop is:

```
attempt 0: inspect → apply_fix → run_property → get_retry_count (count=1)
attempt 1: inspect → apply_fix → run_property → get_retry_count (count=2)
attempt 2: inspect → apply_fix → run_property → get_retry_count (count=3)
attempt 3: inspect → suggest_action now returns "manual_review"
           → stop looping; report to the user
```

When the property test turns green, call `healing.reset_retry_count`
and report success. When the agent hits `count >= 3` without a green
run, stop and summarize the remaining issues to the user; the
`debugging_failing_tests.md` skill covers the manual path from there.

## Error handling

- **`resource.inspect` returns `valid: true`.** The file is already
  well-formed; nothing to repair. Report to the user that no action
  is needed.
- **`resource.inspect` returns `valid: false` with an empty
  `suggested_fix`.** The inspector recognized the failure but does
  not have a mechanical repair. Stop and escalate to the user — the
  fix is a design decision, not an automation.
- **`resource.apply_fix` rejects with `-32004`
  (`NON_UNDOABLE_OPERATION`).** The underlying mutation happened
  outside `EditorUndoRedoManager`. The write still landed on disk;
  warn the user that the edit cannot be reverted with a single
  `Ctrl+Z` and proceed to step 3.
- **`tests.run_property` returns `status: "failed"` three times in a
  row.** The retry counter is now `3`; stop the loop and escalate.

## Example user query

> "An item `.tres` file is corrupt after I pasted some AI-generated
> content in — can you repair it? The file is
> `res://addons/forgekit_rpg/inventory/items/iron_ingot.tres`."

Expected agent response:

1. Run `resource.inspect` on the target file; inspect the first
   entry of `issues[]` and the `suggested_fix`.
2. Run `resource.apply_fix` with the suggested fix.
3. Run `tests.run_property` scoped to the round-trip property.
4. Run `healing.get_retry_count` and confirm the counter is still
   under 3.
5. If the property is green, run `healing.reset_retry_count` and
   summarize the repair. If not, loop back to step 1 up to three
   times total before escalating.

## Related skills

- `debugging_failing_tests.md` — diagnose why the property test is
  still red after the third repair attempt, or when the suggester
  escalates to `manual_review`.
- `authoring_items.md` — author a replacement resource from scratch
  if the file is unrecoverable.
- `module_licensing.md` — confirm the module that owns the resource
  is still active; a disabled module can look like a malformed
  `.tres` to the inspector.
