import type { VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';
import { validateDomainSupportManifest } from '../../../../document/version-store/domain-support-manifest-validator';
import { isVersionDomainSupportManifestRequired } from './version-domain-support-gate-capabilities';
import { detectWorkbookMutableDomainRows } from './version-domain-support-gate-domain-rows';
import {
  domainSupportManifestInvalidDiagnostic,
  domainSupportManifestMissingDiagnostics,
  domainSupportManifestReadFailedDiagnostics,
  domainSupportOperationCapabilityMatrixInvalidDiagnostics,
  publicExportRegistryUnsupportedDiagnostics,
} from './version-domain-support-gate-diagnostics';
import { domainSupportOperationCapabilityMatrixRow } from './version-domain-support-gate-operation-matrix';
import {
  mergeDetectedDomainDiagnostics,
  projectDomainSupportManifestValidationOptions,
} from './version-domain-support-gate-projection';
import { getAttachedDomainSupportManifestGate } from './version-domain-support-gate-source';
import type { VersionDomainSupportManifestGateOperation } from './version-domain-support-gate-types';

export async function validateVersionDomainSupportManifestGate(
  ctx: DocumentContext,
  operation: VersionDomainSupportManifestGateOperation,
): Promise<readonly VersionStoreDiagnostic[]> {
  const operationMatrixRow = domainSupportOperationCapabilityMatrixRow(operation);
  if (!operationMatrixRow) {
    return domainSupportOperationCapabilityMatrixInvalidDiagnostics(operation);
  }

  const gate = getAttachedDomainSupportManifestGate(ctx);
  if (!gate) {
    return isVersionDomainSupportManifestRequired(ctx, operation)
      ? domainSupportManifestMissingDiagnostics(
          operation,
          operationMatrixRow.requiredCapabilityKeys,
        )
      : [];
  }

  let manifest: unknown;
  if (gate.readManifest) {
    try {
      manifest = await gate.readManifest();
    } catch {
      return domainSupportManifestReadFailedDiagnostics(
        operation,
        operationMatrixRow.requiredCapabilityKeys,
      );
    }
  } else if (gate.hasManifestSource) {
    manifest = gate.manifest;
  }

  if (manifest === undefined || manifest === null) {
    return domainSupportManifestMissingDiagnostics(
      operation,
      operationMatrixRow.requiredCapabilityKeys,
    );
  }

  const detected = await detectWorkbookMutableDomainRows(ctx, operation);
  if (detected.diagnostics.length > 0) return detected.diagnostics;

  const options = projectDomainSupportManifestValidationOptions({
    operation,
    operationMatrixRow,
    gateOptions: gate.options,
    detectedRows: detected.detectorRows,
  });
  const validation = validateDomainSupportManifest(manifest, options);
  if (validation.ok) {
    const exportDiagnostics = publicExportRegistryUnsupportedDiagnostics(operation);
    if (exportDiagnostics.length > 0) return exportDiagnostics;
    return mergeDetectedDomainDiagnostics(operation, options);
  }

  return validation.diagnostics.map((diagnostic) =>
    domainSupportManifestInvalidDiagnostic(operation, diagnostic),
  );
}
