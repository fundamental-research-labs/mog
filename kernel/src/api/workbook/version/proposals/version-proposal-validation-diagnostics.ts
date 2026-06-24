import type {
  VersionDiagnosticPublicPayload,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import type { VersionProposalPublicOperation } from './version-proposal-types';

export function invalidOptionDiagnostic(
  operation: VersionProposalPublicOperation,
  option: string,
  safeMessage: string,
): VersionStoreDiagnostic {
  return proposalInputDiagnostic(operation, 'VERSION_INVALID_OPTIONS', safeMessage, {
    payload: { option },
  });
}

export function invalidProposalIdDiagnostic(
  operation: VersionProposalPublicOperation,
  option: string,
): VersionStoreDiagnostic {
  return proposalInputDiagnostic(
    operation,
    'VERSION_INVALID_PROPOSAL_ID',
    `${option} must be a public proposal id.`,
    { payload: { option } },
  );
}

export function unauthorizedAuthorDiagnostic(
  operation: VersionProposalPublicOperation,
  option: string,
): VersionStoreDiagnostic {
  return proposalInputDiagnostic(
    operation,
    'VERSION_PERMISSION_DENIED',
    `${option} is not authorized for proposal ${operation}.`,
    { payload: { option, reason: 'unauthorizedActor' } },
  );
}

function proposalInputDiagnostic(
  operation: VersionProposalPublicOperation,
  issueCode: string,
  safeMessage: string,
  options: { readonly payload?: VersionDiagnosticPublicPayload } = {},
): VersionStoreDiagnostic {
  return {
    issueCode,
    severity: 'error',
    recoverability: 'none',
    messageTemplateId: `version.${operation}.${issueCode}`,
    safeMessage,
    payload: { operation, ...(options.payload ?? {}) },
    redacted: true,
    mutationGuarantee: 'no-write-attempted',
  };
}
