import type {
  VersionCapability,
  VersionCapabilityDependency,
  VersionDiagnosticPublicPayload,
  VersionResult,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import { versionProposalFailureFromDiagnostics } from './version-proposal-diagnostics';
import type { VersionProposalPublicOperation } from './version-proposal-types';

export function capabilityUnavailable<T>(
  operation: VersionProposalPublicOperation,
  capability: VersionCapability,
  dependency: VersionCapabilityDependency,
  reason: string,
  retryable: boolean,
  diagnosticCode: string,
): VersionResult<T> {
  return {
    ok: false,
    error: {
      code: 'version_capability_unavailable',
      capability,
      dependency,
      reason,
      retryable,
      diagnostics: [
        {
          code: diagnosticCode,
          severity: retryable ? 'warning' : 'error',
          message: reason,
          dependency,
          data: { operation, capability },
        },
      ],
    },
  };
}

export function proposalFailure<T>(
  operation: VersionProposalPublicOperation,
  diagnostics: readonly VersionStoreDiagnostic[],
): VersionResult<T> {
  return versionProposalFailureFromDiagnostics(operation, diagnostics);
}

export function serviceUnavailableDiagnostic(
  operation: VersionProposalPublicOperation,
): VersionStoreDiagnostic {
  return proposalDiagnostic(
    operation,
    'VERSION_PROPOSAL_SERVICE_UNAVAILABLE',
    'No document-scoped version proposal service is attached; no proposal records are fabricated.',
    { recoverability: 'unsupported' },
  );
}

export function methodUnavailableDiagnostic(
  operation: VersionProposalPublicOperation,
): VersionStoreDiagnostic {
  return proposalDiagnostic(
    operation,
    'VERSION_PROPOSAL_METHOD_UNAVAILABLE',
    `The attached version proposal service does not implement ${operation}.`,
    { recoverability: 'unsupported' },
  );
}

export function providerErrorDiagnostic(
  operation: VersionProposalPublicOperation,
): VersionStoreDiagnostic {
  return proposalDiagnostic(
    operation,
    'VERSION_PROVIDER_ERROR',
    'The version proposal service failed before returning a usable public result.',
    { recoverability: 'retry', severity: 'error' },
  );
}

export function providerInvalidPayloadDiagnostic(
  operation: VersionProposalPublicOperation,
): VersionStoreDiagnostic {
  return proposalDiagnostic(
    operation,
    'VERSION_INVALID_COMMIT_PAYLOAD',
    'The version proposal service did not return a valid public proposal result.',
    { recoverability: 'repair', severity: 'error' },
  );
}

function proposalDiagnostic(
  operation: VersionProposalPublicOperation,
  issueCode: string,
  safeMessage: string,
  options: {
    readonly severity?: VersionStoreDiagnostic['severity'];
    readonly recoverability?: VersionStoreDiagnostic['recoverability'];
    readonly payload?: VersionDiagnosticPublicPayload;
  } = {},
): VersionStoreDiagnostic {
  return {
    issueCode,
    severity: options.severity ?? 'error',
    recoverability: options.recoverability ?? 'none',
    messageTemplateId: `version.${operation}.${issueCode}`,
    safeMessage,
    payload: { operation, ...(options.payload ?? {}) },
    redacted: true,
    mutationGuarantee: 'no-write-attempted',
  };
}
