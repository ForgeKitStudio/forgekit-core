/**
 * Implementation of the `modules.activate_license` MCP tool.
 *
 * The real persistence lives in the GDScript `LicenseStore` running
 * inside Godot (writes land under `user://licenses/`). The TS tool
 * takes a pluggable `activator` function whose signature and result
 * shape mirror the GDScript store, so the dispatcher can swap in a
 * Godot bridge without the tool caring.
 *
 * Result shapes (from the activator):
 *   {activated: true,  record, path}
 *   {activated: false, error: "license_verification_failed"}
 *
 * On failure the tool rejects with a JSON-RPC error payload (code
 * -32006, message "license_verification_failed", data.module_id).
 */

import { ToolInputError } from '../project/errors.js';
import {
  LICENSE_VERIFICATION_FAILED_MESSAGE,
  LicenseVerificationFailedError,
  UnknownActivationError,
} from './errors.js';

export interface LicenseRecord {
  license_id: string;
  activated_at: string;
  fingerprint: string;
}

export type LicenseActivatorSuccess = {
  activated: true;
  record: LicenseRecord;
  path: string;
};

export type LicenseActivatorFailure = {
  activated: false;
  error: string;
};

export type LicenseActivatorResult =
  | LicenseActivatorSuccess
  | LicenseActivatorFailure;

export type LicenseActivator = (
  moduleId: string,
  licenseId: string,
  signature: string,
) => Promise<LicenseActivatorResult>;

export interface ActivateLicenseParams {
  moduleId: string;
  licenseId: string;
  signature: string;
  activator: LicenseActivator;
}

export interface ActivateLicenseResult {
  activated: true;
  module_id: string;
  record: LicenseRecord;
  path: string;
}

export async function activateLicense(
  params: ActivateLicenseParams,
): Promise<ActivateLicenseResult> {
  if (typeof params.moduleId !== 'string' || params.moduleId.trim() === '') {
    throw new ToolInputError(
      `"moduleId" must be a non-empty string (got ${JSON.stringify(params.moduleId)}).`,
    );
  }
  if (typeof params.licenseId !== 'string' || params.licenseId.trim() === '') {
    throw new ToolInputError(
      `"licenseId" must be a non-empty string (got ${JSON.stringify(params.licenseId)}).`,
    );
  }
  if (typeof params.signature !== 'string' || params.signature.trim() === '') {
    throw new ToolInputError(
      `"signature" must be a non-empty string (got ${JSON.stringify(params.signature)}).`,
    );
  }
  if (typeof params.activator !== 'function') {
    throw new ToolInputError(
      '"activator" must be provided (callable that returns the LicenseStore result).',
    );
  }

  const result = await params.activator(
    params.moduleId,
    params.licenseId,
    params.signature,
  );

  if (result.activated === true) {
    return {
      activated: true,
      module_id: params.moduleId,
      record: result.record,
      path: result.path,
    };
  }

  // The GDScript store uses a single canonical token for HMAC failure;
  // anything else is surfaced under a distinct code so the two paths
  // never get bundled together by a relay layer.
  const originalError =
    typeof result.error === 'string' ? result.error : '';
  if (originalError === LICENSE_VERIFICATION_FAILED_MESSAGE) {
    throw new LicenseVerificationFailedError(params.moduleId);
  }
  throw new UnknownActivationError(params.moduleId, originalError);
}
