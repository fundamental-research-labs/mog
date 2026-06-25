import type { VersionDiagnostic, VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

import { projectVersionStoreDiagnosticPayload } from './version-history-diagnostic-projection-store-payload';
import {
  isPublicMutationGuarantee,
  publicDiagnosticIssueCode,
  publicDiagnosticSeverity,
  publicMessageTemplateId,
  publicRecoverability,
  publicVersionStoreDiagnosticMessage,
} from './version-history-diagnostic-projection-store-public-fields';
import { isRecord } from './version-history-diagnostic-projection-store-redaction';

export function projectVersionStoreDiagnosticForPublicResult(
  diagnostic: VersionStoreDiagnostic,
): VersionDiagnostic {
  const source = isRecord(diagnostic) ? (diagnostic as Readonly<Record<string, unknown>>) : {};
  const issueCode = publicDiagnosticIssueCode(source);
  const payload = projectVersionStoreDiagnosticPayload(source);
  return {
    code: issueCode,
    severity: publicDiagnosticSeverity(source.severity),
    message: publicVersionStoreDiagnosticMessage(source, issueCode, payload),
    owner: 'version-store',
    data: {
      ...(typeof payload.operation === 'string' ? { operation: payload.operation } : {}),
      recoverability: publicRecoverability(source.recoverability),
      messageTemplateId: publicMessageTemplateId(source.messageTemplateId, issueCode),
      redacted: true,
      ...(Object.keys(payload).length > 0 ? { payload } : {}),
      ...(isPublicMutationGuarantee(source.mutationGuarantee)
        ? { mutationGuarantee: source.mutationGuarantee }
        : {}),
    },
  };
}

export function projectVersionStoreDiagnosticsForPublicResult(
  diagnostics: readonly VersionStoreDiagnostic[],
): readonly VersionDiagnostic[] {
  return diagnostics.map(projectVersionStoreDiagnosticForPublicResult);
}
