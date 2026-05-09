/**
 * Pure TypeScript implementation of the `.tres` inspector contract used
 * by the Self-Healing property tests (Property 24, Property 25).
 *
 * The production inspector lives on the Godot side inside
 * `EditorResourceBackend.inspect_resource` / `apply_fix`. That backend
 * parses the `.tres` text format (Godot 4.x uses a `[ext_resource]` +
 * `[node]` header followed by a `[resource]` body section). The TS copy
 * here captures the subset of checks the property tests need:
 *
 *   - `missing_ext_resource` — any `ExtResource("<uid>")` reference in
 *     the body whose `[ext_resource ... id="<uid>"]` header is missing.
 *   - `missing_required_field` — the `[resource]` body lacks one of
 *     the required field names supplied by the caller.
 *   - `wrong_field_type` — a field's serialized value does not match
 *     the expected scalar type ("String", "int", "float").
 *
 * `applyFix(original, fix)` rewrites a `.tres` blob given a simple fix
 * descriptor. The GDScript copy routes the same fix through the editor
 * UndoRedo wrapper so a single Ctrl+Z reverts the write; for the TS
 * harness we just record the original bytes and restore them on undo.
 */

export type ResourceIssueKind =
  | 'missing_ext_resource'
  | 'missing_required_field'
  | 'wrong_field_type';

export interface ResourceIssue {
  kind: ResourceIssueKind;
  field?: string;
  ext_resource_id?: string;
  expected_type?: string;
  actual_value?: string;
}

export interface InspectOptions {
  requiredFields?: string[];
  fieldTypes?: Record<string, 'String' | 'int' | 'float'>;
}

export interface InspectResult {
  issues: ResourceIssue[];
  suggested_fix?: ResourceFix;
}

export type ResourceFix =
  | { kind: 'set_field'; field: string; value: string }
  | { kind: 'add_ext_resource'; id: string; type: string; path: string }
  | { kind: 'remove_field'; field: string };

const EXT_RESOURCE_HEADER_RE = /\[ext_resource[^\]]*\bid="([^"]+)"/g;
const EXT_RESOURCE_REF_RE = /ExtResource\s*\(\s*"([^"]+)"\s*\)/g;
const RESOURCE_SECTION_RE = /\[resource\][\s\S]*$/;

export function inspectTres(source: string, options: InspectOptions = {}): InspectResult {
  const issues: ResourceIssue[] = [];

  // 1. Missing ext_resource — every ExtResource("uid") reference must
  //    have a matching `[ext_resource ... id="uid"]` header.
  const declaredIds = new Set<string>();
  let headerMatch: RegExpExecArray | null;
  EXT_RESOURCE_HEADER_RE.lastIndex = 0;
  while ((headerMatch = EXT_RESOURCE_HEADER_RE.exec(source)) !== null) {
    declaredIds.add(headerMatch[1]);
  }
  EXT_RESOURCE_REF_RE.lastIndex = 0;
  let refMatch: RegExpExecArray | null;
  const missing = new Set<string>();
  while ((refMatch = EXT_RESOURCE_REF_RE.exec(source)) !== null) {
    const uid = refMatch[1];
    if (!declaredIds.has(uid)) {
      missing.add(uid);
    }
  }
  for (const id of missing) {
    issues.push({ kind: 'missing_ext_resource', ext_resource_id: id });
  }

  // 2. Body field checks — look inside `[resource] ... end-of-file`.
  const bodyMatch = RESOURCE_SECTION_RE.exec(source);
  const body = bodyMatch ? bodyMatch[0] : '';
  const required = options.requiredFields ?? [];
  const fieldTypes = options.fieldTypes ?? {};
  const parsedFields = parseResourceFields(body);

  for (const field of required) {
    if (!(field in parsedFields)) {
      issues.push({ kind: 'missing_required_field', field });
    }
  }

  for (const [field, expected] of Object.entries(fieldTypes)) {
    const raw = parsedFields[field];
    if (raw === undefined) continue;
    if (!matchesType(raw, expected)) {
      issues.push({
        kind: 'wrong_field_type',
        field,
        expected_type: expected,
        actual_value: raw,
      });
    }
  }

  let suggested_fix: ResourceFix | undefined;
  for (const issue of issues) {
    if (issue.kind === 'missing_ext_resource' && issue.ext_resource_id) {
      suggested_fix = {
        kind: 'add_ext_resource',
        id: issue.ext_resource_id,
        type: 'Resource',
        path: `res://missing_${issue.ext_resource_id}.tres`,
      };
      break;
    }
  }

  return { issues, suggested_fix };
}

export function applyFix(source: string, fix: ResourceFix): string {
  switch (fix.kind) {
    case 'set_field':
      return upsertField(source, fix.field, fix.value);
    case 'add_ext_resource':
      return prependExtResource(source, fix);
    case 'remove_field':
      return removeField(source, fix.field);
    default:
      return source;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseResourceFields(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  // Strip the leading `[resource]` header if present.
  const bodyLines = body.replace(/^\[resource\]\s*\n?/, '').split(/\r?\n/);
  for (const line of bodyLines) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2].trim();
  }
  return out;
}

function matchesType(raw: string, expected: 'String' | 'int' | 'float'): boolean {
  switch (expected) {
    case 'String':
      return raw.startsWith('"') && raw.endsWith('"');
    case 'int':
      return /^-?\d+$/.test(raw);
    case 'float':
      return /^-?\d+(\.\d+)?$/.test(raw);
  }
}

function upsertField(source: string, field: string, value: string): string {
  const lineRe = new RegExp(`^${escapeRegex(field)}\\s*=\\s*.*$`, 'm');
  if (lineRe.test(source)) {
    return source.replace(lineRe, `${field} = ${value}`);
  }
  // Append to the resource section.
  if (RESOURCE_SECTION_RE.test(source)) {
    return source.replace(/\s*$/, `\n${field} = ${value}\n`);
  }
  return `${source}\n[resource]\n${field} = ${value}\n`;
}

function prependExtResource(source: string, fix: { id: string; type: string; path: string }): string {
  const header = `[ext_resource type="${fix.type}" id="${fix.id}" path="${fix.path}"]\n`;
  // Insert before the first `[resource]` or `[node]` section; fall back
  // to prepending.
  const sectionRe = /\[(resource|node)/;
  const idx = source.search(sectionRe);
  if (idx === -1) return header + source;
  return source.slice(0, idx) + header + source.slice(idx);
}

function removeField(source: string, field: string): string {
  const lineRe = new RegExp(`^${escapeRegex(field)}\\s*=\\s*.*(\\r?\\n)?`, 'm');
  return source.replace(lineRe, '');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
