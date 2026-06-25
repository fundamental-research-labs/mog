import type { VersionDiagnostic, VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

import {
  diagnosticHistoryCondition,
  HISTORY_GAP_REASON,
  STALE_HEAD_REASON,
} from './version-history-diagnostic-projection-store-condition';
import { sanitizeDiagnosticMessage } from './version-history-diagnostic-projection-store-redaction';

export function publicDiagnosticIssueCode(value: Readonly<Record<string, unknown>>): string {
  return typeof value.issueCode === 'string'
    ? value.issueCode
    : typeof value.code === 'string'
      ? value.code
      : 'VERSION_PROVIDER_ERROR';
}

export function publicVersionStoreDiagnosticMessage(
  source: Readonly<Record<string, unknown>>,
  issueCode: string,
  payload: Readonly<Record<string, unknown>>,
): string {
  const condition = diagnosticHistoryCondition(source, payload);
  if (condition === STALE_HEAD_REASON) {
    return 'Version history head changed before the operation completed; refresh and retry.';
  }
  if (condition === HISTORY_GAP_REASON) {
    return 'Version history has a gap; refresh or repair the provider history before retrying.';
  }
  const safeMessage =
    typeof source.safeMessage === 'string'
      ? source.safeMessage
      : typeof source.message === 'string'
        ? source.message
        : '';
  const sanitized = sanitizeDiagnosticMessage(safeMessage);
  return sanitized.length > 0 ? sanitized : `Version history operation failed: ${issueCode}.`;
}

export function publicDiagnosticSeverity(value: unknown): VersionDiagnostic['severity'] {
  return value === 'info' || value === 'warning' || value === 'error' ? value : 'error';
}

export function publicRecoverability(value: unknown): VersionStoreDiagnostic['recoverability'] {
  return value === 'retry' || value === 'repair' || value === 'unsupported' || value === 'none'
    ? value
    : 'none';
}

export function publicMessageTemplateId(value: unknown, issueCode: string): string {
  return typeof value === 'string' && value.length > 0 ? value : `version.provider.${issueCode}`;
}

export function isPublicMutationGuarantee(
  value: unknown,
): value is NonNullable<VersionStoreDiagnostic['mutationGuarantee']> {
  return (
    value === 'ref-not-mutated' ||
    value === 'registry-not-visible' ||
    value === 'no-write-attempted' ||
    value === 'unknown-after-crash'
  );
}
