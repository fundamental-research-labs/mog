import type {
  VersionDiagnosticPublicPayload,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

export function invalidOptionsDiagnostic(message: string, option?: string): VersionStoreDiagnostic {
  return publicDiagnostic('VERSION_INVALID_OPTIONS', message, 'error', 'none', {
    operation: 'promotePendingRemote',
    ...(option ? { option } : {}),
  });
}

export function noWriteDiagnostic(
  issueCode: string,
  safeMessage: string,
  recoverability: VersionStoreDiagnostic['recoverability'],
  payload: VersionDiagnosticPublicPayload,
): VersionStoreDiagnostic {
  return {
    ...publicDiagnostic(issueCode, safeMessage, 'error', recoverability, payload),
    mutationGuarantee: 'no-write-attempted',
  };
}

export function publicDiagnostic(
  issueCode: string,
  safeMessage: string,
  severity: VersionStoreDiagnostic['severity'],
  recoverability: VersionStoreDiagnostic['recoverability'],
  payload: VersionDiagnosticPublicPayload = { operation: 'promotePendingRemote' },
): VersionStoreDiagnostic {
  return {
    issueCode,
    severity,
    recoverability,
    messageTemplateId:
      `version.promotePendingRemote.${issueCode}` as VersionStoreDiagnostic['messageTemplateId'],
    safeMessage,
    payload,
    redacted: true,
  };
}
