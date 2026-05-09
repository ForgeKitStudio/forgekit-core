---
skill: authoring-items
title: Authoring a new ItemResource
api_version: 0.7.0
updated: 2026-05-16
---

# Authoring a new ItemResource

Use this skill when the user wants to introduce a new in-game item — for
example, a crafting ingredient, a consumable, or a stackable trinket — and
persist it as an `ItemResource` `.tres` file under the project's item
directory.

The skill covers:

- Confirming that the target module (`forgekit_rpg` or another MIT module
  that ships an `items/` directory) is installed and enabled.
- Reading an existing `ItemResource` to copy its shape before writing.
- Saving the new `.tres` through `resource.save` so the write lands in an
  `EditorUndoRedoManager` action and a single `Ctrl+Z` reverts it.
- Re-running the item-related unit tests to confirm the new resource
  parses, validates, and does not regress existing tests.

## MCP tool call sequence

Execute these calls in order. Stop on the first error and report the
server response verbatim to the user.

1. **`project.list_modules`** — confirm the module that owns the
   target `items/` directory is installed and enabled. For the default
   path (`addons/forgekit_rpg/inventory/items/`) look for
   `{ id: "forgekit_rpg", enabled: true }` in the response. If the
   module is absent or inactive, stop and point the user at the
   `module_licensing.md` skill before continuing.
2. **`resource.inspect`** — load an existing `ItemResource` template
   (for example `addons/forgekit_rpg/inventory/items/iron_ore.tres`) to
   read its field list and default values. Use the `fields[]` array of
   the response to build the new resource body. This guarantees the
   new `.tres` matches the current `ItemResource` schema even if Core
   has added fields since the skill was written.
3. **`resource.save`** — write the new `.tres` file. Parameters:
   ```json
   {
     "path": "res://addons/forgekit_rpg/inventory/items/health_potion_small.tres",
     "resource": {
       "script": "res://addons/forgekit_core/resources/item_resource.gd",
       "id": "health_potion_small",
       "display_name": "Small Health Potion",
       "stack_size": 20,
       "icon": "res://addons/forgekit_rpg/inventory/icons/health_potion_small.png"
     }
   }
   ```
   The write routes through `McpUndoRedoWrapper` so the edit appears in
   the editor's undo stack as `MCP: resource.save health_potion_small`.
4. **`tests.run_unit`** — run the item-related unit suite (for example
   `tests/unit/test_item_resource.gd`). Confirm the new resource passes
   validation and that no other test regresses. The response carries a
   `TestReport` whose `failed_count` must be `0`.

## Expected agent response

After step 4, summarize to the user:

- The absolute `user://`-relative path that was written.
- The `id`, `display_name`, and `stack_size` of the new item.
- The single-line `TestReport` outcome (for example
  `12 passed, 0 failed`).

## Error handling

`resource.save` surfaces validation failures before writing to disk. The
two most common cases are:

- **Missing required field.** `ItemResource.validate()` returns a
  non-empty `Array[String]` and `resource.save` rejects the write with
  JSON-RPC error `-32602` (`Invalid params`). The response `data`
  carries the list of missing fields — report them verbatim and ask
  the user for the missing values before retrying.
- **Invalid `stack_size`.** Non-positive integers or non-integer values
  are rejected at the `ItemResource` level. The response `data.field`
  is `"stack_size"` and `data.received` echoes what was sent. Fix the
  input and call `resource.save` again.

If `resource.inspect` surfaces unrelated issues on the template
resource (for example stale references), stop and hand off to the
`self_healing_tres.md` skill rather than writing the new item against
a malformed template.

## Example user query

> "Add a new health potion item with id `health_potion_small`, stack
> size 20, and the icon at
> `res://addons/forgekit_rpg/inventory/icons/health_potion_small.png`."

Expected agent response:

1. Run `project.list_modules` and confirm `forgekit_rpg` is enabled.
2. Run `resource.inspect` on a representative existing item
   (`iron_ore.tres` is a safe default).
3. Run `resource.save` with the path and resource body above.
4. Run `tests.run_unit` scoped to the item tests.
5. Summarize the outcome.

## Related skills

- `module_licensing.md` — activate `forgekit_rpg` when
  `project.list_modules` reports it as not enabled.
- `self_healing_tres.md` — repair a malformed item template before
  reusing its shape for a new resource.
- `debugging_failing_tests.md` — triage `tests.run_unit` failures
  after authoring a new item.
