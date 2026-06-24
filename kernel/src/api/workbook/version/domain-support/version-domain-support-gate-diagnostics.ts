import type {
  VersionDiagnosticPublicPayload,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';
import {
  PUBLIC_VERSION_DOMAIN_EXPORT_REQUIRED_MATRIX_ROW_IDS,
  PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY,
  PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY_EXPORT_SUPPORTS_REQUIRED_ROWS,
  type DomainCapabilityPolicyManifest,
  type VersionDomainCapabilityKey,
} from '@mog-sdk/contracts/versioning';

import type { DomainSupportManifestDiagnostic } from '../../../../document/version-store/domain-support-manifest-validator';
import type {
  VersionDomainSupportManifestGateOperation,
  WorkbookMutableDomainDetector,
} from './version-domain-support-gate-types';

const EVAL_ONLY_EXPECTED_FAILING_STATE = 'expected-failing';
const PUBLIC_DIAGNOSTIC_VALUE_RE = /^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/;
const MAX_PUBLIC_DIAGNOSTIC_VALUE_LENGTH = 128;

export function publicExportRegistryUnsupportedDiagnostics(
  operation: VersionDomainSupportManifestGateOperation,
): readonly VersionStoreDiagnostic[] {
  if (
    operation !== 'export' ||
    PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY_EXPORT_SUPPORTS_REQUIRED_ROWS
  ) {
    return [];
  }

  return PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY.domains
    .filter(isRequiredPublicExportRow)
    .filter(
      (row) =>
        row.capabilityStates.export !== 'supported' && row.capabilityStates.export !== 'derived',
    )
    .map((row) =>
      publicDiagnostic(
        operation,
        'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
        'The public version domain policy registry does not yet support export for every required domain row.',
        {
          diagnosticCode: 'public-export-registry-not-supported',
          matrixRowId: row.matrixRowId,
          domainId: row.domainId,
          capabilityKey: 'export',
          capabilityState: row.capabilityStates.export,
          policyField: 'capabilityStates.export',
          policyValue: row.capabilityStates.export,
        },
      ),
    );
}

export function domainSupportManifestMissingDiagnostics(
  operation: VersionDomainSupportManifestGateOperation,
  requiredCapabilityKeys: readonly VersionDomainCapabilityKey[],
): readonly VersionStoreDiagnostic[] {
  return requiredCapabilityKeys.map((capabilityKey) =>
    domainSupportManifestMissingDiagnostic(operation, capabilityKey),
  );
}

export function domainSupportOperationCapabilityMatrixInvalidDiagnostics(
  operation: VersionDomainSupportManifestGateOperation,
): readonly VersionStoreDiagnostic[] {
  return [
    publicDiagnostic(
      operation,
      'VERSION_DOMAIN_SUPPORT_OPERATION_CAPABILITY_MATRIX_INVALID',
      'The domain support gate could not map this durable version operation to explicit capability columns.',
      { diagnosticCode: 'operation-capability-mapping-missing-or-ambiguous' },
    ),
  ];
}

export function domainSupportManifestReadFailedDiagnostics(
  operation: VersionDomainSupportManifestGateOperation,
  requiredCapabilityKeys: readonly VersionDomainCapabilityKey[],
): readonly VersionStoreDiagnostic[] {
  return requiredCapabilityKeys.map((capabilityKey) =>
    domainSupportManifestReadFailedDiagnostic(operation, capabilityKey),
  );
}

export function domainSupportDetectorReadFailedDiagnostic(
  operation: VersionDomainSupportManifestGateOperation,
  detector: Pick<WorkbookMutableDomainDetector, 'matrixRowId' | 'domainId' | 'detectorId'>,
): VersionStoreDiagnostic {
  return publicDiagnostic(
    operation,
    'VERSION_DOMAIN_SUPPORT_DETECTOR_READ_FAILED',
    'Workbook mutable domain detection failed before the durable version operation.',
    {
      detectorId: detector.detectorId,
      matrixRowId: detector.matrixRowId,
      domainId: detector.domainId,
    },
    'retry',
  );
}

export function domainSupportDetectorUnavailableDiagnostic(
  operation: VersionDomainSupportManifestGateOperation,
  detector: Pick<WorkbookMutableDomainDetector, 'matrixRowId' | 'domainId' | 'detectorId'>,
): VersionStoreDiagnostic {
  return publicDiagnostic(
    operation,
    'VERSION_DOMAIN_SUPPORT_DETECTOR_UNAVAILABLE',
    'Workbook mutable domain detection is unavailable before the durable version operation.',
    {
      detectorId: detector.detectorId,
      matrixRowId: detector.matrixRowId,
      domainId: detector.domainId,
    },
  );
}

export function domainSupportManifestInvalidDiagnostic(
  operation: VersionDomainSupportManifestGateOperation,
  diagnostic: DomainSupportManifestDiagnostic,
): VersionStoreDiagnostic {
  const payload: Record<string, string | number | boolean | null> = {
    diagnosticCode: diagnostic.code,
  };
  appendPublicSafePayloadValue(payload, 'matrixRowId', diagnostic.matrixRowId);
  appendPublicSafePayloadValue(payload, 'domainId', diagnostic.domainId);
  appendPublicSafePayloadValue(payload, 'capabilityKey', diagnostic.capabilityKey);
  appendPublicSafePayloadValue(payload, 'capabilityState', diagnostic.capabilityState);
  appendPublicSafePayloadValue(payload, 'policyField', diagnostic.policyField);
  appendPublicSafePayloadValue(payload, 'policyValue', diagnostic.policyValue);

  return publicDiagnostic(
    operation,
    'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
    'The document domain support manifest is invalid for durable version operations.',
    payload,
  );
}

function isRequiredPublicExportRow(row: DomainCapabilityPolicyManifest): boolean {
  return (PUBLIC_VERSION_DOMAIN_EXPORT_REQUIRED_MATRIX_ROW_IDS as readonly string[]).includes(
    row.matrixRowId,
  );
}

function domainSupportManifestMissingDiagnostic(
  operation: VersionDomainSupportManifestGateOperation,
  capabilityKey: VersionDomainCapabilityKey,
): VersionStoreDiagnostic {
  return publicDiagnostic(
    operation,
    'VERSION_DOMAIN_SUPPORT_MANIFEST_MISSING',
    'A required document domain support manifest is not attached for this durable version operation.',
    { capabilityKey },
  );
}

function domainSupportManifestReadFailedDiagnostic(
  operation: VersionDomainSupportManifestGateOperation,
  capabilityKey: VersionDomainCapabilityKey,
): VersionStoreDiagnostic {
  return publicDiagnostic(
    operation,
    'VERSION_DOMAIN_SUPPORT_MANIFEST_READ_FAILED',
    'The document domain support manifest could not be read before the durable version operation.',
    { capabilityKey },
    'retry',
  );
}

function appendPublicSafePayloadValue(
  payload: Record<string, string | number | boolean | null>,
  key: string,
  value: string | undefined,
): void {
  const safeValue = publicSafeDiagnosticValue(value);
  if (safeValue) payload[key] = safeValue;
}

function publicSafeDiagnosticValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value === EVAL_ONLY_EXPECTED_FAILING_STATE) return undefined;
  if (value.length > MAX_PUBLIC_DIAGNOSTIC_VALUE_LENGTH) return undefined;
  if (!PUBLIC_DIAGNOSTIC_VALUE_RE.test(value)) return undefined;
  return value;
}

function publicDiagnostic(
  operation: VersionDomainSupportManifestGateOperation | string,
  issueCode: string,
  safeMessage: string,
  payload: VersionDiagnosticPublicPayload = {},
  recoverability: VersionStoreDiagnostic['recoverability'] = 'none',
): VersionStoreDiagnostic {
  const publicOperation = publicSafeDiagnosticValue(String(operation)) ?? 'unknown';
  return {
    issueCode,
    severity: 'error',
    recoverability,
    messageTemplateId: `version.${publicOperation}.${issueCode}`,
    safeMessage,
    payload: {
      operation: publicOperation,
      ...payload,
    },
    redacted: true,
    mutationGuarantee: 'no-write-attempted',
  };
}
