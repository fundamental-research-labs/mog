import {
  type DomainCapabilityPolicyManifest,
  type VersionDomainCapabilityKey,
} from '@mog-sdk/contracts/versioning';

import { REQUIRED_FIRST_SLICE_MATRIX_ROW_IDS } from './domain-support-manifest-validator-constants';
import { validateDomainPolicyId, validateRegistryMatch } from './domain-support-policy-registry';
import type {
  DomainSupportManifestDiagnostic,
  DomainSupportManifestValidationOptions,
} from './domain-support-manifest-validator-types';
import {
  validateCapabilityStates,
  validateRequiredCapabilityState,
} from './domain-support-manifest-validator-phases-capability-states';
import {
  validateDetectorCoverage,
  validateRequiredCoverage,
} from './domain-support-manifest-validator-phases-coverage';
import {
  isVersionDomainCapabilityState,
  isVersionDomainClass,
} from './domain-support-manifest-validator-phases-guards';
import { validatePolicyFields } from './domain-support-manifest-validator-phases-policy-fields';

export interface DomainRowsValidationContext {
  readonly requiredCapabilityKeys: readonly VersionDomainCapabilityKey[];
  readonly enforceDurableOperationPolicy: boolean;
  readonly registryRows: ReadonlyMap<string, DomainCapabilityPolicyManifest> | null;
}

export interface DomainRowsValidationResult {
  readonly presentMatrixRowIds: readonly string[];
  readonly presentDomainIds: ReadonlySet<string>;
}

export function validateManifestDomainRows(
  domains: unknown,
  options: DomainSupportManifestValidationOptions,
  context: DomainRowsValidationContext,
  diagnostics: DomainSupportManifestDiagnostic[],
): DomainRowsValidationResult {
  const presentMatrixRowIds: string[] = [];
  const presentDomainIds = new Set<string>();
  if (!Array.isArray(domains)) {
    diagnostics.push({
      code: 'domains-missing',
      message: 'Manifest domains must be an array.',
    });
    return { presentMatrixRowIds, presentDomainIds };
  }

  const capabilityEnforcedMatrixRows = requiredCapabilityMatrixRows(options);
  const capabilityEnforcedDomains = requiredCapabilityDomainIds(options);
  const seenMatrixRows = new Set<string>();
  const seenDomainPolicies = new Set<string>();
  const seenDomains = new Set<string>();
  for (let index = 0; index < domains.length; index += 1) {
    const row = domains[index] as Partial<DomainCapabilityPolicyManifest> | unknown;
    if (row === null || typeof row !== 'object') {
      diagnostics.push({
        code: 'domain-malformed',
        message: `Domain row at index ${index} is not an object.`,
      });
      continue;
    }
    const typed = row as Partial<DomainCapabilityPolicyManifest>;
    const domainPolicyId = validateDomainPolicyId(
      typed.matrixRowId,
      typed.domainId,
      typed.domainPolicyId,
      diagnostics,
    );
    if (domainPolicyId) {
      if (seenDomainPolicies.has(domainPolicyId)) {
        diagnostics.push({
          code: 'duplicate-domain-policy',
          message: `Domain policy id "${domainPolicyId}" appears more than once.`,
          ...(typeof typed.matrixRowId === 'string' && typed.matrixRowId !== ''
            ? { matrixRowId: typed.matrixRowId }
            : {}),
          ...(typeof typed.domainId === 'string' && typed.domainId !== ''
            ? { domainId: typed.domainId }
            : {}),
          policyField: 'domainPolicyId',
          policyValue: domainPolicyId,
        });
      } else {
        seenDomainPolicies.add(domainPolicyId);
      }
      validateRegistryMatch(domainPolicyId, typed, context.registryRows, diagnostics);
    }
    const matrixRowId = typed.matrixRowId;
    const domainId = typed.domainId;
    if (typeof matrixRowId !== 'string' || matrixRowId === '') {
      diagnostics.push({
        code: 'matrix-row-id-missing',
        message: `Domain row at index ${index} has a missing or empty matrixRowId.`,
        ...(typeof domainId === 'string' && domainId !== '' ? { domainId } : {}),
      });
      continue;
    }
    if (typeof domainId !== 'string' || domainId === '') {
      diagnostics.push({
        code: 'domain-malformed',
        message: `Domain row at index ${index} has a missing or empty domainId.`,
        matrixRowId,
      });
      continue;
    }
    if (seenMatrixRows.has(matrixRowId)) {
      diagnostics.push({
        code: 'duplicate-matrix-row',
        message: `Matrix row "${matrixRowId}" appears more than once.`,
        matrixRowId,
        domainId,
      });
      continue;
    }
    seenMatrixRows.add(matrixRowId);
    seenDomains.add(domainId);
    presentMatrixRowIds.push(matrixRowId);
    presentDomainIds.add(domainId);

    const domainClass = typed.domainClass;
    if (!isVersionDomainClass(domainClass)) {
      diagnostics.push({
        code: 'unknown-domain-class',
        message: `Matrix row "${matrixRowId}" for domain "${domainId}" references unknown domainClass "${String(typed.domainClass)}".`,
        matrixRowId,
        domainId,
      });
    }
    validatePolicyFields(
      matrixRowId,
      domainId,
      typed,
      context.enforceDurableOperationPolicy,
      diagnostics,
    );
    validateCapabilityStates(matrixRowId, domainId, typed.capabilityStates, diagnostics);
    if (
      isVersionDomainClass(domainClass) &&
      (capabilityEnforcedMatrixRows.has(matrixRowId) || capabilityEnforcedDomains.has(domainId))
    ) {
      validateRequiredCapabilityState(
        matrixRowId,
        domainId,
        domainClass,
        typed.capabilityStates,
        context.requiredCapabilityKeys,
        options.allowOpaquePreserved === true,
        diagnostics,
      );
    }
    if (
      typed.capabilityState !== undefined &&
      !isVersionDomainCapabilityState(typed.capabilityState)
    ) {
      diagnostics.push({
        code: 'unknown-capability-state',
        message: `Matrix row "${matrixRowId}" for domain "${domainId}" references an unknown legacy capabilityState.`,
        matrixRowId,
        domainId,
        policyField: 'capabilityState',
      });
    }
  }

  validateRequiredCoverage(seenMatrixRows, seenDomains, options, diagnostics);
  validateDetectorCoverage(seenMatrixRows, seenDomains, options, diagnostics);

  return { presentMatrixRowIds, presentDomainIds };
}

function requiredCapabilityMatrixRows(
  options: DomainSupportManifestValidationOptions,
): ReadonlySet<string> {
  const rows = new Set(options.requiredMatrixRowIds ?? REQUIRED_FIRST_SLICE_MATRIX_ROW_IDS);
  for (const detector of options.detectorRows ?? []) {
    if (detector.present && detector.matrixRowId) rows.add(detector.matrixRowId);
  }
  return rows;
}

function requiredCapabilityDomainIds(
  options: DomainSupportManifestValidationOptions,
): ReadonlySet<string> {
  const domains = new Set(options.requiredDomainIds ?? []);
  for (const detector of options.detectorRows ?? []) {
    if (detector.present && !detector.matrixRowId) domains.add(detector.domainId);
  }
  return domains;
}
