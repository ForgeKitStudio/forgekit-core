/**
 * Feature: forgekit, Property 24: resource.inspect detects injected issues
 *
 * Start from a valid `.tres` fixture, inject a mutation (missing
 * `ext_resource`, missing required field, wrong field type), assert
 * `inspectTres(path).issues[]` includes an entry whose `kind` matches
 * the injected mutation. For missing-reference cases a `suggested_fix`
 * is also emitted. 100 iterations via fast-check.
 *
 * The inspector under `src/healing/resource_inspect.ts` mirrors the
 * Godot-side `EditorResourceBackend.inspect_resource` contract.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  inspectTres,
  InspectOptions,
  ResourceIssueKind,
} from '../src/healing/resource_inspect.js';

const NUM_RUNS = 100 as const;

// --------------------------------------------------------------------------
// Fixture construction — build a valid `.tres` body so every mutation
// starts from a known-good baseline.
// --------------------------------------------------------------------------

function buildValidTres(extId: string, displayName: string, stackSize: number): string {
  return [
    `[gd_resource type="ItemResource" load_steps=2 format=3]`,
    ``,
    `[ext_resource type="Texture2D" id="${extId}" path="res://icons/placeholder.png"]`,
    ``,
    `[resource]`,
    `script = ExtResource("${extId}")`,
    `id = &"iron_ore"`,
    `display_name = "${displayName}"`,
    `stack_size = ${stackSize}`,
    ``,
  ].join('\n');
}

// --------------------------------------------------------------------------
// Mutation generators.
// --------------------------------------------------------------------------

type Mutation = {
  kind: ResourceIssueKind;
  apply: (source: string) => string;
  options?: InspectOptions;
};

const mutationArb: fc.Arbitrary<Mutation> = fc.oneof(
  fc.record({
    kind: fc.constant('missing_ext_resource' as const),
    apply: fc.constant((source: string) =>
      source.replace(/\[ext_resource[^\]]*\]\s*\n/, ''),
    ),
  }),
  fc.record({
    kind: fc.constant('missing_required_field' as const),
    apply: fc.constant((source: string) => source.replace(/^display_name\s*=.*\n?/m, '')),
    options: fc.constant({ requiredFields: ['display_name'] }),
  }),
  fc.record({
    kind: fc.constant('wrong_field_type' as const),
    apply: fc.constant((source: string) =>
      source.replace(/^stack_size\s*=.*$/m, `stack_size = "not-an-int"`),
    ),
    options: fc.constant({ fieldTypes: { stack_size: 'int' } as const }),
  }),
);

const fixtureArb = fc.record({
  extId: fc
    .string({ minLength: 4, maxLength: 12 })
    .filter((s) => /^[A-Za-z0-9_]+$/.test(s)),
  displayName: fc.unicodeString({ minLength: 1, maxLength: 16 }).filter((s) => !s.includes('"')),
  stackSize: fc.integer({ min: 1, max: 999 }),
});

describe('Property 24: resource.inspect detects injected issues', () => {
  it('every injected mutation surfaces as a matching issue', () => {
    fc.assert(
      fc.property(fixtureArb, mutationArb, (fixture, mutation) => {
        const original = buildValidTres(fixture.extId, fixture.displayName, fixture.stackSize);
        const mutated = mutation.apply(original);
        const result = inspectTres(mutated, mutation.options);

        const kinds = result.issues.map((i) => i.kind);
        expect(kinds).toContain(mutation.kind);

        if (mutation.kind === 'missing_ext_resource') {
          expect(result.suggested_fix).toBeDefined();
          expect(result.suggested_fix?.kind).toBe('add_ext_resource');
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
