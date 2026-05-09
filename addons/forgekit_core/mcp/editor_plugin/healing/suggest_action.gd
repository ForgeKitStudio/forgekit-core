extends RefCounted
## McpHealingSuggester — heuristic map from a failed `TestReport` to a
## `suggested_action` drawn from ALLOWED_SUGGESTED_ACTIONS.
##
## Rule set (first match wins):
##   - `.tres`                                   → inspect_tres
##   - `parse error` / `unexpected token`        → validate_gdscript
##   - `timeout` / `flaky`                       → rerun_test
##   - anything else                             → manual_review
##
## Property 22 — when the injected `McpRetryCounter` reports the failing
## resource has exhausted its retry budget, the suggester unconditionally
## returns `manual_review`, overriding every other rule.
##
## The TypeScript port under `mcp-server/src/healing/suggest_action.ts`
## mirrors this exact rule set so the two implementations never drift.


class_name McpHealingSuggester


const ALLOWED_SUGGESTED_ACTIONS: Array = [
	"inspect_tres",
	"validate_gdscript",
	"rerun_test",
	"manual_review",
]


var _retry_counter: Object = null


func set_retry_counter(counter: Object) -> void:
	_retry_counter = counter


## Examine `report` and return `{suggested_action}` where
## `suggested_action` is an element of ALLOWED_SUGGESTED_ACTIONS.
func suggest(report: Dictionary) -> Dictionary:
	var resource_path: String = String(report.get("resource_path", ""))
	var failure_message: String = String(report.get("failure_message", "")).to_lower()

	# Property 22 — the retry cap takes precedence over every rule so a
	# runaway apply/retest loop always escalates to manual_review.
	if _retry_counter != null and not resource_path.is_empty():
		if _retry_counter.is_exhausted(resource_path):
			return {"suggested_action": "manual_review"}

	if failure_message.contains(".tres") or failure_message.contains("ext_resource"):
		return {"suggested_action": "inspect_tres"}
	if failure_message.contains("parse error") or failure_message.contains("unexpected token"):
		return {"suggested_action": "validate_gdscript"}
	if failure_message.contains("timeout") or failure_message.contains("timed out") or failure_message.contains("flaky"):
		return {"suggested_action": "rerun_test"}

	return {"suggested_action": "manual_review"}
