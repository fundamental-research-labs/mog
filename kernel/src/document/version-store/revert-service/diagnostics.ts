import type {
  VersionDiagnosticPublicPayload,
  VersionStoreDiagnostic as PublicVersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

export function revertDiagnostic(
  issueCode: string,
  safeMessage: string,
  payload: VersionDiagnosticPublicPayload,
  recoverability: PublicVersionStoreDiagnostic['recoverability'],
  mutationGuarantee: NonNullable<PublicVersionStoreDiagnostic['mutationGuarantee']>,
): PublicVersionStoreDiagnostic {
  return {
    issueCode,
    severity: 'error',
    recoverability,
    messageTemplateId: `version.revert.${issueCode}`,
    safeMessage,
    payload: { operation: 'revert', ...payload },
    redacted: true,
    mutationGuarantee,
  };
}
