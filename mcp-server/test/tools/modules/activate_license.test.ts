/**
 * Tests for the `modules.activate_license` MCP tool.
 *
 * The real persistence lives in the GDScript `LicenseStore` running
 * inside Godot. The TS tool takes an injected `activator` function that
 * mirrors the GDScript result shape so the contract is verifiable in
 * isolation without standing up a Godot process.
 *
 *   activator(moduleId, licenseId, signature) => {
 *     activated: true,  record, path
 *   }
 *   activator(moduleId, licenseId, signature) => {
 *     activated: false, error: "license_verification_failed"
 *   }
 *
 * On verification failure the tool rejects with a JSON-RPC style error
 * (`code: -32006`, `message: "license_verification_failed"`).
 */

import { describe, expect, it, vi } from 'vitest';

import { ToolInputError } from '../../../src/tools/project/errors.js';
import {
  activateLicense,
  type LicenseActivator,
} from '../../../src/tools/modules/activate_license.js';
import {
  ACTIVATION_FAILED_CODE,
  ACTIVATION_FAILED_MESSAGE,
  LICENSE_VERIFICATION_FAILED_CODE,
  LICENSE_VERIFICATION_FAILED_MESSAGE,
  UnknownActivationError,
} from '../../../src/tools/modules/errors.js';

describe('activateLicense — happy path', () => {
  it('returns {activated: true, module_id, record, path} on success', async () => {
    const activator: LicenseActivator = vi.fn().mockResolvedValue({
      activated: true,
      record: {
        license_id: 'lic-123',
        activated_at: '2025-01-01T00:00:00',
        fingerprint: 'deadbeef',
      },
      path: 'user://licenses/forgekit_rpg.key',
    });

    const result = await activateLicense({
      moduleId: 'forgekit_rpg',
      licenseId: 'lic-123',
      signature: 'a'.repeat(64),
      activator,
    });

    expect(result).toEqual({
      activated: true,
      module_id: 'forgekit_rpg',
      record: {
        license_id: 'lic-123',
        activated_at: '2025-01-01T00:00:00',
        fingerprint: 'deadbeef',
      },
      path: 'user://licenses/forgekit_rpg.key',
    });
    expect(activator).toHaveBeenCalledWith(
      'forgekit_rpg',
      'lic-123',
      'a'.repeat(64),
    );
  });
});

describe('activateLicense — verification failure', () => {
  it('rejects with a JSON-RPC payload (code -32006, license_verification_failed)', async () => {
    const activator: LicenseActivator = vi.fn().mockResolvedValue({
      activated: false,
      error: 'license_verification_failed',
    });

    try {
      await activateLicense({
        moduleId: 'forgekit_rpg',
        licenseId: 'bad',
        signature: 'b'.repeat(64),
        activator,
      });
      throw new Error('expected activateLicense to reject');
    } catch (err: unknown) {
      const payload = err as {
        code: number;
        message: string;
        data?: { module_id: string };
      };
      expect(payload.code).toBe(LICENSE_VERIFICATION_FAILED_CODE);
      expect(payload.message).toBe(LICENSE_VERIFICATION_FAILED_MESSAGE);
      expect(payload.data?.module_id).toBe('forgekit_rpg');
    }
  });

  it('exports the expected error code and message constants', () => {
    expect(LICENSE_VERIFICATION_FAILED_CODE).toBe(-32006);
    expect(LICENSE_VERIFICATION_FAILED_MESSAGE).toBe(
      'license_verification_failed',
    );
  });
});

describe('activateLicense — unknown activation error', () => {
  it('rejects with UnknownActivationError (code -32007) for a non-canonical error string', async () => {
    const activator: LicenseActivator = vi.fn().mockResolvedValue({
      activated: false,
      error: 'hmac_context_start_failed',
    });

    try {
      await activateLicense({
        moduleId: 'forgekit_rpg',
        licenseId: 'lic-123',
        signature: 'c'.repeat(64),
        activator,
      });
      throw new Error('expected activateLicense to reject');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(UnknownActivationError);
      const payload = err as {
        name: string;
        code: number;
        message: string;
        data?: { module_id: string; original_error: string };
      };
      expect(payload.name).toBe('UnknownActivationError');
      expect(payload.code).toBe(ACTIVATION_FAILED_CODE);
      expect(payload.message).toBe(ACTIVATION_FAILED_MESSAGE);
      expect(payload.data?.module_id).toBe('forgekit_rpg');
      expect(payload.data?.original_error).toBe('hmac_context_start_failed');
    }
  });

  it('rejects with UnknownActivationError when the activator omits the error field', async () => {
    const activator: LicenseActivator = vi.fn().mockResolvedValue({
      activated: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    try {
      await activateLicense({
        moduleId: 'forgekit_rpg',
        licenseId: 'lic-123',
        signature: 'd'.repeat(64),
        activator,
      });
      throw new Error('expected activateLicense to reject');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(UnknownActivationError);
      const payload = err as {
        code: number;
        message: string;
        data?: { module_id: string; original_error: string };
      };
      expect(payload.code).toBe(ACTIVATION_FAILED_CODE);
      expect(payload.message).toBe(ACTIVATION_FAILED_MESSAGE);
      expect(payload.data?.module_id).toBe('forgekit_rpg');
      expect(payload.data?.original_error).toBe('');
    }
  });

  it('exports the expected UnknownActivationError code and message constants', () => {
    expect(ACTIVATION_FAILED_CODE).toBe(-32007);
    expect(ACTIVATION_FAILED_MESSAGE).toBe('ACTIVATION_FAILED');
  });
});

describe('activateLicense — validation', () => {
  const noopActivator: LicenseActivator = async () => ({
    activated: true,
    record: { license_id: '', activated_at: '', fingerprint: '' },
    path: '',
  });

  it('rejects an empty moduleId', async () => {
    await expect(
      activateLicense({
        moduleId: '',
        licenseId: 'lic-123',
        signature: 'a'.repeat(64),
        activator: noopActivator,
      }),
    ).rejects.toThrow(ToolInputError);
  });

  it('rejects an empty licenseId', async () => {
    await expect(
      activateLicense({
        moduleId: 'forgekit_rpg',
        licenseId: '',
        signature: 'a'.repeat(64),
        activator: noopActivator,
      }),
    ).rejects.toThrow(ToolInputError);
  });

  it('rejects an empty signature', async () => {
    await expect(
      activateLicense({
        moduleId: 'forgekit_rpg',
        licenseId: 'lic-123',
        signature: '',
        activator: noopActivator,
      }),
    ).rejects.toThrow(ToolInputError);
  });

  it('rejects when no activator is provided', async () => {
    await expect(
      activateLicense({
        moduleId: 'forgekit_rpg',
        licenseId: 'lic-123',
        signature: 'a'.repeat(64),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any),
    ).rejects.toThrow(ToolInputError);
  });
});
