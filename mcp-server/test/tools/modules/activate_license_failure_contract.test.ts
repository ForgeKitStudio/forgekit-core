/**
 * End-to-end failure-contract check for `modules.activate_license`.
 *
 * This test instantiates a fake activator that mirrors the GDScript
 * `LicenseStore` return shape byte-for-byte when HMAC verification
 * fails:
 *
 *   { activated: false, error: "license_verification_failed" }
 *
 * It then drives the TS `modules.activate_license` tool and asserts
 * the thrown error exposes the exact JSON-RPC contract the relay
 * forwards verbatim across the GDScript / TypeScript boundary.
 */

import { describe, expect, it } from 'vitest';

import {
  activateLicense,
  type LicenseActivator,
  type LicenseActivatorResult,
} from '../../../src/tools/modules/activate_license.js';
import { LicenseVerificationFailedError } from '../../../src/tools/modules/errors.js';

/**
 * Byte-for-byte mirror of the GDScript `LicenseStore.activate` failure
 * payload (see `addons/forgekit_core/mcp/licensing/license_store.gd`,
 * constant `ERR_LICENSE_VERIFICATION_FAILED`).
 */
function gdscriptLikeFailingActivator(): LicenseActivator {
  return async (_moduleId, _licenseId, _signature): Promise<LicenseActivatorResult> => ({
    activated: false,
    error: 'license_verification_failed',
  });
}

describe('modules.activate_license — failure contract', () => {
  it('forwards the GDScript store failure shape as JSON-RPC code -32006 with the canonical message', async () => {
    const activator = gdscriptLikeFailingActivator();

    let thrown: unknown;
    try {
      await activateLicense({
        moduleId: 'forgekit_rpg',
        licenseId: 'forgekit_rpg-customer-12345',
        signature: '0'.repeat(64),
        activator,
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeDefined();
    expect(thrown).toBeInstanceOf(LicenseVerificationFailedError);

    const payload = thrown as {
      name: string;
      code: number;
      message: string;
      data?: { module_id: string };
    };

    expect(payload.name).toBe('LicenseVerificationFailedError');
    expect(payload.code).toBe(-32006);
    expect(payload.message).toBe('license_verification_failed');
    expect(payload.data?.module_id).toBe('forgekit_rpg');
  });
});
