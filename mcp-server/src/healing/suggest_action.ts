/**
 * TypeScript mirror of the GDScript `McpHealingSuggester`.
 *
 * The rule set is kept in sync with
 * `addons/forgekit_core/mcp/editor_plugin/healing/suggest_action.gd`:
 *
 *   - `.tres` / `ext_resource`            → inspect_tres
 *   - `parse error` / `unexpected token`  → validate_gdscript
 *   - `timeout` / `timed out` / `flaky`   → rerun_test
 *   - anything else                       → manual_review
 *
 * Property 22 (retry escalation) lives in the GDScript copy only because
 * it depends on the per-session retry counter; the TS port here always
 * returns one of the four allowed actions based on the message content.
 */

export const ALLOWED_SUGGESTED_ACTIONS = [
  'inspect_tres',
  'validate_gdscript',
  'rerun_test',
  'manual_review',
] as const;

export type SuggestedAction = (typeof ALLOWED_SUGGESTED_ACTIONS)[number];

export interface TestReport {
  status: string;
  failure_message?: string;
  resource_path?: string;
}

export interface SuggestActionResult {
  suggested_action: SuggestedAction;
}

export function suggestAction(report: TestReport): SuggestActionResult {
  const message = (report.failure_message ?? '').toLowerCase();

  if (message.includes('.tres') || message.includes('ext_resource')) {
    return { suggested_action: 'inspect_tres' };
  }
  if (message.includes('parse error') || message.includes('unexpected token')) {
    return { suggested_action: 'validate_gdscript' };
  }
  if (
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('flaky')
  ) {
    return { suggested_action: 'rerun_test' };
  }

  return { suggested_action: 'manual_review' };
}
