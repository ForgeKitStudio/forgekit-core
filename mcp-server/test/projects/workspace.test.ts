/**
 * Tests for the Workspace value type and its pure validation helpers.
 *
 * The Workspace value type is the immutable record the ProjectRegistry keeps
 * for every registered Godot project. The validation helpers are pure
 * functions used by the registry and the dispatcher middleware to reject
 * malformed inputs before any filesystem work is attempted.
 */

import { describe, expect, it } from 'vitest';

import {
  MAX_LABEL_LENGTH,
  MAX_WORKSPACES,
  WORKSPACE_ID_REGEX,
  validateLabel,
  validateWorkspaceId,
} from '../../src/projects/workspace.js';

describe('WORKSPACE_ID_REGEX', () => {
  it('matches lowercase alphanumeric ids starting with a letter', () => {
    expect(WORKSPACE_ID_REGEX.test('a')).toBe(true);
    expect(WORKSPACE_ID_REGEX.test('default')).toBe(true);
    expect(WORKSPACE_ID_REGEX.test('client-a')).toBe(true);
    expect(WORKSPACE_ID_REGEX.test('internal_demo')).toBe(true);
    expect(WORKSPACE_ID_REGEX.test('a0')).toBe(true);
  });

  it('rejects ids starting with a digit or a symbol', () => {
    expect(WORKSPACE_ID_REGEX.test('1project')).toBe(false);
    expect(WORKSPACE_ID_REGEX.test('-project')).toBe(false);
    expect(WORKSPACE_ID_REGEX.test('_project')).toBe(false);
  });

  it('rejects uppercase letters', () => {
    expect(WORKSPACE_ID_REGEX.test('Default')).toBe(false);
    expect(WORKSPACE_ID_REGEX.test('clientA')).toBe(false);
  });

  it('rejects ids longer than 64 characters', () => {
    const sixtyFour = 'a' + 'b'.repeat(63);
    const sixtyFive = 'a' + 'b'.repeat(64);
    expect(sixtyFour).toHaveLength(64);
    expect(sixtyFive).toHaveLength(65);
    expect(WORKSPACE_ID_REGEX.test(sixtyFour)).toBe(true);
    expect(WORKSPACE_ID_REGEX.test(sixtyFive)).toBe(false);
  });

  it('rejects empty strings', () => {
    expect(WORKSPACE_ID_REGEX.test('')).toBe(false);
  });
});

describe('MAX_WORKSPACES + MAX_LABEL_LENGTH constants', () => {
  it('exposes the documented limits', () => {
    expect(MAX_WORKSPACES).toBe(32);
    expect(MAX_LABEL_LENGTH).toBe(120);
  });
});

describe('validateWorkspaceId', () => {
  it('returns {valid: true} for legal ids', () => {
    expect(validateWorkspaceId('default')).toEqual({ valid: true });
    expect(validateWorkspaceId('client-a')).toEqual({ valid: true });
  });

  it('returns {valid: false, reason} for empty string', () => {
    const result = validateWorkspaceId('');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toMatch(/empty|length|pattern/i);
    }
  });

  it('returns {valid: false, reason} for id violating the regex', () => {
    const result = validateWorkspaceId('Not-Valid');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toMatch(/pattern|regex|lowercase|^/i);
    }
  });

  it('returns {valid: false} for non-string input', () => {
    // @ts-expect-error — exercising runtime type safety
    expect(validateWorkspaceId(123).valid).toBe(false);
    // @ts-expect-error — exercising runtime type safety
    expect(validateWorkspaceId(null).valid).toBe(false);
    // @ts-expect-error — exercising runtime type safety
    expect(validateWorkspaceId(undefined).valid).toBe(false);
  });
});

describe('validateLabel', () => {
  it('returns {valid: true} for a non-empty label', () => {
    expect(validateLabel('Client A — RPG game')).toEqual({ valid: true });
  });

  it('returns {valid: true} for undefined (label is optional)', () => {
    expect(validateLabel(undefined)).toEqual({ valid: true });
  });

  it('returns {valid: false, reason} for labels longer than MAX_LABEL_LENGTH', () => {
    const tooLong = 'x'.repeat(MAX_LABEL_LENGTH + 1);
    const result = validateLabel(tooLong);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toMatch(/length|max/i);
    }
  });

  it('returns {valid: false} for non-string labels', () => {
    // @ts-expect-error — exercising runtime type safety
    expect(validateLabel(42).valid).toBe(false);
    // @ts-expect-error — exercising runtime type safety
    expect(validateLabel({}).valid).toBe(false);
  });
});
