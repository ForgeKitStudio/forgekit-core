extends RefCounted
## McpHealingInspector — classifies a failure report (Dictionary) or raw
## failure message (String) into a {root_cause, candidates[]} envelope.
## Each candidate is `{category, suggestion, confidence}`; confidence is
## a float in [0.0, 1.0] derived from how strongly the pattern matches.
##
## Patterns covered:
##   - missing_ext_resource       ext_resource not found, .tres load failed
##   - gdscript_parse_error       "Parse error", "unexpected token"
##   - timeout                    "timed out", "timeout"
##   - stack_trace                "at line", "res://..."
##
## Unknown failures still carry an "investigate" candidate so the agent
## gets some guidance rather than an empty array.


class_name McpHealingInspector


func inspect(report_or_message: Variant) -> Dictionary:
	var message: String = _extract_message(report_or_message).to_lower()
	var candidates: Array = []
	var root_cause: String = "unknown"

	if message.contains("ext_resource") or (message.contains(".tres") and message.contains("not found")):
		root_cause = "missing_ext_resource"
		candidates.append({
			"category": "missing_ext_resource",
			"suggestion": "Run resource.inspect(path) to identify the missing ext_resource and call resource.apply_fix with the repaired reference.",
			"confidence": 0.85,
		})
	elif message.contains("parse error") or message.contains("unexpected token"):
		root_cause = "gdscript_parse_error"
		candidates.append({
			"category": "gdscript_parse_error",
			"suggestion": "Run gdscript.validate on the file and correct the syntax error at the reported line before retrying.",
			"confidence": 0.9,
		})
	elif message.contains("timed out") or message.contains("timeout"):
		root_cause = "timeout"
		candidates.append({
			"category": "timeout",
			"suggestion": "Rerun the test; if the failure persists, increase the timeout or identify the slow operation.",
			"confidence": 0.6,
		})
	elif message.contains("at line") or message.contains("res://"):
		root_cause = "stack_trace"
		candidates.append({
			"category": "stack_trace",
			"suggestion": "Inspect the reported line for the failing call and trace back to the root cause.",
			"confidence": 0.5,
		})

	if candidates.is_empty():
		candidates.append({
			"category": "investigate",
			"suggestion": "No known failure pattern matched; inspect the test output manually.",
			"confidence": 0.2,
		})

	return {
		"root_cause": root_cause,
		"candidates": candidates,
	}


static func _extract_message(value: Variant) -> String:
	if value is String:
		return String(value)
	if value is Dictionary:
		var dict: Dictionary = value as Dictionary
		if dict.has("failure_message"):
			return String(dict.get("failure_message", ""))
		if dict.has("message"):
			return String(dict.get("message", ""))
	return ""
