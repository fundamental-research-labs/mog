import type {
  VersionDiagnosticPublicPayload,
  VersionRecordRevision,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import {
  branchDiagnosticMutationGuarantee,
  issueCodeForBranchDiagnostic,
  recoverabilityForBranchIssue,
  safeBranchDiagnosticToken,
  safeMessageForBranchIssue,
} from './version-ref-diagnostics';

const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;
const REF_COUNTER_REVISION_VALUE_RE = /^(0|[1-9][0-9]*)$/;
const PUBLIC_NO_WRITE_DIAGNOSTIC_CODES = new Set([
  'VERSION_DANGLING_REF',
  'VERSION_INVALID_COMMIT_ID',
  'VERSION_INVALID_OPTIONS',
  'VERSION_PERMISSION_DENIED',
  'VERSION_REF_WRITE_UNAVAILABLE',
]);

export type VersionRefLifecycleOperation =
  | 'createBranch'
  | 'deleteBranch'
  | 'deleteRef'
  | 'fastForwardBranch'
  | 'getRef'
  | 'listRefs'
  | 'readRef'
  | 'updateBranch';

export function mapVersionRefLifecycleDiagnostic(
  value: unknown,
  operation: VersionRefLifecycleOperation,
  fallback: VersionStoreDiagnostic,
): VersionStoreDiagnostic {
  if (!isRecord(value)) return fallback;
  const code =
    typeof value.code === 'string'
      ? value.code
      : typeof value.issueCode === 'string'
        ? value.issueCode
        : 'versionCapabilityDisabled';
  const issueCode = issueCodeForPublicBranchDiagnostic(code);
  const mutationGuarantee = branchMutationGuaranteeForDiagnostic(code, value.details);
  return publicDiagnostic(issueCode, operation, safeMessageForBranchIssue(issueCode, operation), {
    severity: value.severity === 'warning' || value.severity === 'info' ? value.severity : 'error',
    recoverability: recoverabilityForBranchIssue(issueCode),
    payload: sanitizeBranchDiagnosticPayload(value, operation, code),
    ...(isRefMutationOperation(operation) && mutationGuarantee ? { mutationGuarantee } : {}),
  });
}

export function mapVersionRefProviderExceptionDiagnostics(
  error: unknown,
  operation: VersionRefLifecycleOperation,
  fallback: VersionStoreDiagnostic,
): readonly VersionStoreDiagnostic[] | null {
  const diagnostics = diagnosticsFromProviderException(error);
  return diagnostics
    ? diagnostics.map((item) => mapVersionRefLifecycleDiagnostic(item, operation, fallback))
    : null;
}

export function toVersionRefRecordRevision(
  refVersion: unknown,
  revisionValue: unknown,
): VersionRecordRevision | undefined {
  const publicRefVersion = toCounterRevision(refVersion);
  const revision = toRevision(revisionValue);
  if (refVersion !== undefined && !publicRefVersion) return undefined;
  if (revisionValue !== undefined && !revision) return undefined;
  const mismatched =
    publicRefVersion &&
    revision &&
    (publicRefVersion.kind !== revision.kind || publicRefVersion.value !== revision.value);
  return mismatched ? undefined : (publicRefVersion ?? revision);
}

function diagnosticsFromProviderException(error: unknown): readonly unknown[] | null {
  if (!isRecord(error)) return null;
  if (Array.isArray(error.diagnostics)) return error.diagnostics;
  if (isRecord(error.error) && Array.isArray(error.error.diagnostics)) {
    return error.error.diagnostics;
  }
  return typeof error.code === 'string' || typeof error.issueCode === 'string' ? [error] : null;
}

function sanitizeBranchDiagnosticPayload(
  value: Readonly<Record<string, unknown>>,
  operation: VersionRefLifecycleOperation,
  code: string,
): VersionDiagnosticPublicPayload {
  const payload: Record<string, string | number | boolean | null> = { operation };
  const details = isRecord(value.details) ? value.details : null;
  if (details && typeof details.issue === 'string') {
    payload.issue = safeBranchDiagnosticToken('issue', details.issue);
  }
  if (details && typeof details.missingField === 'string') {
    payload.option = safeBranchDiagnosticToken('option', details.missingField);
  }
  const conflict =
    details && typeof details.conflict === 'string'
      ? details.conflict
      : details && typeof details.cause === 'string'
        ? details.cause
        : isPublicRefConflictCode(code)
          ? code
          : undefined;
  if (conflict) payload.conflict = safeBranchDiagnosticToken('conflict', conflict);
  const actualHead = toCommitId(value.commitId) ?? toCommitId(value.actualHead);
  const actualRevision =
    toCounterRevision(value.refVersion) ??
    toCounterRevision(value.tombstoneRefVersion) ??
    toCounterRevision(value.actualRefVersion);
  if (actualHead) payload.actualHead = actualHead;
  if (actualRevision) payload.actualRefRevision = `rv:n:${actualRevision.value}`;
  if (value.refName === 'main' || value.refName === 'refs/heads/main') {
    payload.refName = 'refs/heads/main';
  }
  return payload;
}

function issueCodeForPublicBranchDiagnostic(code: string): string {
  switch (code) {
    case 'VERSION_REF_CONFLICT':
    case 'expectedPreviousRefIncarnationIdMismatch':
      return 'VERSION_REF_CONFLICT';
    case 'VERSION_DANGLING_REF':
    case 'VERSION_GRAPH_UNINITIALIZED':
    case 'VERSION_INVALID_COMMIT_ID':
    case 'VERSION_INVALID_OPTIONS':
    case 'VERSION_PROVIDER_ERROR':
    case 'VERSION_REF_WRITE_UNAVAILABLE':
      return code;
    default:
      return issueCodeForBranchDiagnostic(code);
  }
}

function branchMutationGuaranteeForDiagnostic(
  code: string,
  details: unknown,
): VersionStoreDiagnostic['mutationGuarantee'] | undefined {
  if (isPublicRefConflictCode(code) || PUBLIC_NO_WRITE_DIAGNOSTIC_CODES.has(code)) {
    return 'no-write-attempted';
  }
  return branchDiagnosticMutationGuarantee(code, details);
}

function isPublicRefConflictCode(code: string): boolean {
  return (
    code === 'VERSION_REF_CONFLICT' ||
    code === 'expectedHeadMismatch' ||
    code === 'expectedPreviousRefIncarnationIdMismatch' ||
    code === 'expectedRefVersionMismatch' ||
    code === 'refAlreadyExists' ||
    code === 'refTombstoned'
  );
}

function publicDiagnostic(
  issueCode: string,
  operation: VersionRefLifecycleOperation,
  safeMessage: string,
  options: {
    readonly severity?: VersionStoreDiagnostic['severity'];
    readonly recoverability?: VersionStoreDiagnostic['recoverability'];
    readonly payload?: VersionDiagnosticPublicPayload;
    readonly mutationGuarantee?: VersionStoreDiagnostic['mutationGuarantee'];
  },
): VersionStoreDiagnostic {
  return {
    issueCode,
    severity: options.severity ?? 'error',
    recoverability: options.recoverability ?? recoverabilityForBranchIssue(issueCode),
    messageTemplateId: `version.${operation}.${issueCode}`,
    safeMessage,
    ...(options.payload ? { payload: options.payload } : {}),
    redacted: true,
    ...(options.mutationGuarantee ? { mutationGuarantee: options.mutationGuarantee } : {}),
  };
}

function isRefMutationOperation(operation: VersionRefLifecycleOperation): boolean {
  return (
    operation === 'createBranch' ||
    operation === 'fastForwardBranch' ||
    operation === 'updateBranch' ||
    operation === 'deleteBranch' ||
    operation === 'deleteRef'
  );
}

function toCommitId(value: unknown): WorkbookCommitId | null {
  return typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value)
    ? (value as WorkbookCommitId)
    : null;
}

function toCounterRevision(
  value: unknown,
): { readonly kind: 'counter'; readonly value: string } | undefined {
  if (
    isRecord(value) &&
    value.kind === 'counter' &&
    typeof value.value === 'string' &&
    REF_COUNTER_REVISION_VALUE_RE.test(value.value)
  ) {
    return { kind: 'counter', value: value.value };
  }
  return undefined;
}

function toRevision(value: unknown): VersionRecordRevision | undefined {
  if (
    isRecord(value) &&
    value.kind === 'counter' &&
    typeof value.value === 'string' &&
    REF_COUNTER_REVISION_VALUE_RE.test(value.value)
  ) {
    return { kind: 'counter', value: value.value };
  }
  if (
    isRecord(value) &&
    value.kind === 'opaque' &&
    typeof value.value === 'string' &&
    value.value.length > 0
  ) {
    return { kind: 'opaque', value: value.value };
  }
  return undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
