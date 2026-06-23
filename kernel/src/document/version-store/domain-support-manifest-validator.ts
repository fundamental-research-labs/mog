// VC-06A: Fail-closed validator for the DomainSupportManifest.
//
// Durable version-control operations (commit/checkout/merge/export/import) must NOT
// proceed on a manifest that is missing, stale, or structurally incomplete. The
// validator encodes that as a pure function whose defaults are fail-closed: any
// missing/unknown/stale input produces `{ ok: false, diagnostics }` rather than
// silently degrading. Callers gate durable writes on `ok === true`.
//
// This validator module family is intentionally not wired into the live write
// path; VC-06 / VC-04 own that integration. It exists so the fail-closed
// contract can be specified and tested ahead of Batch B promotion.

import type { DomainSupportManifest } from '@mog-sdk/contracts/versioning';

import { policyRegistryRows } from './domain-support-policy-registry';
import {
  requiredCapabilityKeysForOptions,
  validateManifestDomainRows,
  validateManifestMetadata,
} from './domain-support-manifest-validator-phases';
import type {
  DomainSupportManifestDiagnostic,
  DomainSupportManifestValidationOptions,
  DomainSupportManifestValidationResult,
} from './domain-support-manifest-validator-types';

export {
  REQUIRED_CAPABILITY_KEYS_BY_OPERATION,
  REQUIRED_FIRST_SLICE_DOMAIN_IDS,
  REQUIRED_FIRST_SLICE_MATRIX_ROW_IDS,
  SUPPORTED_DOMAIN_SUPPORT_MANIFEST_SCHEMA_VERSIONS,
} from './domain-support-manifest-validator-constants';
export type {
  DomainSupportDetectorRow,
  DomainSupportManifestDiagnostic,
  DomainSupportManifestDiagnosticCode,
  DomainSupportManifestValidationFailure,
  DomainSupportManifestValidationOk,
  DomainSupportManifestValidationOperation,
  DomainSupportManifestValidationOptions,
  DomainSupportManifestValidationResult,
} from './domain-support-manifest-validator-types';

/**
 * Pure, fail-closed validation of a DomainSupportManifest.
 *
 * Returns `{ ok: true }` only for a well-formed, fresh, complete manifest.
 * Otherwise returns `{ ok: false, diagnostics }`. The function never throws on
 * a structurally invalid manifest — malformed input is reported as a
 * diagnostic — so callers can treat any non-`ok` result as a hard block.
 */
export function validateDomainSupportManifest(
  manifest: DomainSupportManifest | unknown,
  options: DomainSupportManifestValidationOptions = {},
): DomainSupportManifestValidationResult {
  const diagnostics: DomainSupportManifestDiagnostic[] = [];
  const requiredCapabilityKeys = requiredCapabilityKeysForOptions(options);
  const enforceDurableOperationPolicy =
    options.operation !== undefined || requiredCapabilityKeys.length > 0;
  const registryRows = policyRegistryRows(options.domainPolicyRegistry, diagnostics);

  // --- structural shape ---------------------------------------------------
  if (manifest === null || typeof manifest !== 'object') {
    return {
      ok: false,
      diagnostics: [{ code: 'manifest-malformed', message: 'Manifest is not an object.' }],
    };
  }

  const candidate = manifest as Partial<DomainSupportManifest>;

  validateManifestMetadata(candidate, options, diagnostics);
  const { presentMatrixRowIds, presentDomainIds } = validateManifestDomainRows(
    candidate.domains,
    options,
    {
      requiredCapabilityKeys,
      enforceDurableOperationPolicy,
      registryRows,
    },
    diagnostics,
  );

  if (diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }
  return { ok: true, presentMatrixRowIds, presentDomainIds: [...presentDomainIds] };
}

/**
 * Typed error for callers that prefer throw-based control flow. Carries the
 * structured diagnostics so the boundary can still log/redact them.
 */
export class DomainSupportManifestError extends Error {
  readonly diagnostics: readonly DomainSupportManifestDiagnostic[];

  constructor(diagnostics: readonly DomainSupportManifestDiagnostic[]) {
    const codes = diagnostics.map((d) => d.code).join(', ');
    super(`DomainSupportManifest failed validation (fail-closed): ${codes}`);
    this.name = 'DomainSupportManifestError';
    this.diagnostics = diagnostics;
  }
}

/**
 * Fail-closed assertion wrapper. Returns the validated manifest's present
 * domain ids on success, throws DomainSupportManifestError otherwise. Use this
 * at a durable-operation boundary that must not proceed on a bad manifest.
 */
export function assertDomainSupportManifest(
  manifest: DomainSupportManifest | unknown,
  options: DomainSupportManifestValidationOptions = {},
): readonly string[] {
  const result = validateDomainSupportManifest(manifest, options);
  if (!result.ok) {
    throw new DomainSupportManifestError(result.diagnostics);
  }
  return result.presentMatrixRowIds;
}
