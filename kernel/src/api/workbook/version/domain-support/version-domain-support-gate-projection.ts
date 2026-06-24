import type { VersionStoreDiagnostic } from '@mog-sdk/contracts/api';
import {
  PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY,
  type VersionDomainCapabilityKey,
} from '@mog-sdk/contracts/versioning';

import type {
  DomainSupportDetectorRow,
  DomainSupportManifestValidationOptions,
} from '../../../../document/version-store/domain-support-manifest-validator';
import {
  isMaterializableMergeDomainReference,
  unsupportedDetectedMergeDomainDiagnostic,
} from '../merge/version-merge-materializer-support';
import { mergeDomainSupportDetectorRows } from './version-domain-support-gate-domain-rows';
import type {
  VersionDomainSupportManifestGateOperation,
  VersionDomainSupportOperationCapabilityMatrixRow,
} from './version-domain-support-gate-types';

type ProjectDomainSupportManifestValidationOptionsInput = {
  readonly operation: VersionDomainSupportManifestGateOperation;
  readonly operationMatrixRow: VersionDomainSupportOperationCapabilityMatrixRow;
  readonly gateOptions: DomainSupportManifestValidationOptions | undefined;
  readonly detectedRows: readonly DomainSupportDetectorRow[];
};

export function projectDomainSupportManifestValidationOptions({
  operation,
  operationMatrixRow,
  gateOptions,
  detectedRows,
}: ProjectDomainSupportManifestValidationOptionsInput): DomainSupportManifestValidationOptions {
  const {
    domainPolicyRegistry: _ignoredCallerDomainPolicyRegistry,
    operation: _ignoredCallerOperation,
    requiredCapabilityKeys: callerRequiredCapabilityKeys,
    requiredMatrixRowIds: callerRequiredMatrixRowIds,
    requiredDomainIds: callerRequiredDomainIds,
    ...callerOptions
  } = gateOptions ?? {};
  const detectorRows = mergeDomainSupportDetectorRows(callerOptions.detectorRows, detectedRows);

  return {
    ...callerOptions,
    domainPolicyRegistry: PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY,
    now: gateOptions?.now instanceof Date ? gateOptions.now : new Date(),
    ...(operationMatrixRow.validatorOperation
      ? { operation: operationMatrixRow.validatorOperation }
      : {}),
    requiredCapabilityKeys: requiredManifestCapabilityKeys(
      operationMatrixRow,
      callerRequiredCapabilityKeys,
    ),
    requiredMatrixRowIds: requiredManifestMatrixRowIds(
      operationMatrixRow,
      callerRequiredMatrixRowIds,
      detectorRows,
    ),
    requiredDomainIds: requiredManifestDomainIds(callerRequiredDomainIds, detectorRows),
    ...(detectorRows ? { detectorRows } : {}),
  };
}

export function mergeDetectedDomainDiagnostics(
  operation: VersionDomainSupportManifestGateOperation,
  options: DomainSupportManifestValidationOptions | undefined,
): readonly VersionStoreDiagnostic[] {
  if (operation !== 'merge' && operation !== 'applyMerge') return [];
  if (!Array.isArray(options?.detectorRows)) return [];

  const diagnostics: VersionStoreDiagnostic[] = [];
  options.detectorRows.forEach((row, itemIndex) => {
    if (!row.present) return;
    if (!isMaterializableMergeDomainReference(row)) {
      diagnostics.push(unsupportedDetectedMergeDomainDiagnostic(operation, itemIndex, row));
    }
  });
  return diagnostics;
}

function requiredManifestCapabilityKeys(
  operationMatrixRow: VersionDomainSupportOperationCapabilityMatrixRow,
  callerRequiredCapabilityKeys: readonly VersionDomainCapabilityKey[] | undefined,
): readonly VersionDomainCapabilityKey[] {
  return uniquePublicIds(
    operationMatrixRow.requiredCapabilityKeys,
    callerRequiredCapabilityKeys,
  ) as readonly VersionDomainCapabilityKey[];
}

function requiredManifestMatrixRowIds(
  operationMatrixRow: VersionDomainSupportOperationCapabilityMatrixRow,
  callerRequiredMatrixRowIds: readonly string[] | undefined,
  detectorRows: readonly DomainSupportDetectorRow[] | undefined,
): readonly string[] {
  return uniquePublicIds(
    operationMatrixRow.requiredMatrixRowIds,
    callerRequiredMatrixRowIds,
    detectorRows?.filter((row) => row.present).map((row) => row.matrixRowId),
  );
}

function requiredManifestDomainIds(
  callerRequiredDomainIds: readonly string[] | undefined,
  detectorRows: readonly DomainSupportDetectorRow[] | undefined,
): readonly string[] | undefined {
  const requiredDomainIds = uniquePublicIds(
    callerRequiredDomainIds,
    detectorRows?.filter((row) => row.present).map((row) => row.domainId),
  );
  return requiredDomainIds.length > 0 ? requiredDomainIds : undefined;
}

function uniquePublicIds(
  ...groups: readonly (readonly (string | undefined)[] | undefined)[]
): readonly string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const value of group ?? []) {
      if (typeof value !== 'string' || value === '' || seen.has(value)) continue;
      seen.add(value);
      ids.push(value);
    }
  }
  return ids;
}
