import type {
  VersionDiagnostic,
  VersionResult,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

export function versionFailureFromRevertDiagnostics<T>(
  diagnostics: readonly VersionStoreDiagnostic[],
): VersionResult<T> {
  return {
    ok: false,
    error: {
      code: 'target_unavailable',
      target: 'workbook.version.revert',
      diagnostics: diagnostics.map(toVersionDiagnostic),
    },
  };
}

function toVersionDiagnostic(diagnostic: VersionStoreDiagnostic): VersionDiagnostic {
  return {
    code: diagnostic.issueCode,
    severity: diagnostic.severity === 'fatal' ? 'error' : diagnostic.severity,
    message: diagnostic.safeMessage,
    owner: 'version-store',
    data: {
      operation: 'revert',
      recoverability: diagnostic.recoverability,
      messageTemplateId: diagnostic.messageTemplateId,
      redacted: diagnostic.redacted,
      ...(diagnostic.payload ? { payload: diagnostic.payload } : {}),
      ...(diagnostic.mutationGuarantee ? { mutationGuarantee: diagnostic.mutationGuarantee } : {}),
    },
  };
}
