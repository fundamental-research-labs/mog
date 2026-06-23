import type {
  VersionDiagnosticPublicPayload,
  VersionMainRefName,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import type {
  NormalCommitCaptureAdmissionState,
  VersionSurfaceDirtyAdmissionState,
} from './version-commit-types';
import { isPayloadPrimitive, isRecord } from './version-commit-utils';

export const VERSION_HEAD_REF = 'HEAD';
export const VERSION_MAIN_REF = 'refs/heads/main' satisfies VersionMainRefName;
export const VERSION_BRANCH_REF_PREFIX = 'refs/heads/';

const OBJECT_KIND_BY_TYPE: Record<string, string> = {
  'workbook.snapshotRoot.v1': 'snapshot-root',
  'workbook.semanticChangeSet.v1': 'semantic-change-set',
  'workbook.mutationSegment.v1': 'mutation-segment',
  'workbook.redactionSummary.v1': 'redaction-summary',
  'workbook.verificationSummary.v1': 'verification-summary',
  'workbook.authorizationSnapshot.v1': 'authorization-snapshot',
};

const SAFE_MESSAGES: Record<string, string> = {
  VERSION_GRAPH_UNINITIALIZED: 'The workbook version graph is not initialized for this document.',
  VERSION_INVALID_OPTIONS: 'The version commit options are invalid for this method.',
  VERSION_PERMISSION_DENIED:
    'The requested version commit option is not authorized in this public slice.',
  VERSION_REF_WRITE_UNAVAILABLE:
    'Public version commits cannot target or mutate arbitrary refs in this slice.',
  VERSION_STORE_READ_ONLY: 'The attached version store is read-only for this document.',
  VERSION_REF_CONFLICT: 'The version ref changed while the commit was in progress.',
  VERSION_MISSING_CHANGE_SET: 'The version commit has no eligible captured change set.',
  VERSION_MISSING_SNAPSHOT_ROOT:
    'The version commit is missing its materializable snapshot root.',
  VERSION_MISSING_MUTATION_SEGMENT: 'The version commit is missing a captured mutation segment.',
  VERSION_DIGEST_MISMATCH: 'A version commit object digest does not match its canonical bytes.',
  VERSION_WRONG_OBJECT_KIND: 'A version commit dependency has the wrong object kind.',
  VERSION_UNSUPPORTED_SCHEMA: 'A version commit dependency uses an unsupported schema.',
  VERSION_REDACTION_VIOLATION:
    'The version commit could not prove required redaction before storage.',
  VERSION_ANNOTATION_WRITE_FAILED:
    'The version commit annotation could not be written durably.',
  VERSION_UNMATERIALIZABLE_COMMIT:
    'The version commit is not materializable by the attached service.',
  VERSION_INVALID_COMMIT_PAYLOAD:
    'The version write service returned an invalid public commit payload.',
};

const REPAIR_ISSUES = new Set([
  'VERSION_DANGLING_REF',
  'VERSION_MISSING_OBJECT',
  'VERSION_MISSING_SNAPSHOT_ROOT',
  'VERSION_MISSING_CHANGE_SET',
  'VERSION_MISSING_MUTATION_SEGMENT',
  'VERSION_DIGEST_MISMATCH',
  'VERSION_WRONG_OBJECT_KIND',
  'VERSION_OBJECT_STORE_FAILURE',
  'VERSION_INVALID_COMMIT_PAYLOAD',
  'VERSION_UNMATERIALIZABLE_COMMIT',
]);

const UNSUPPORTED_ISSUES = new Set([
  'VERSION_GRAPH_UNINITIALIZED',
  'VERSION_PERMISSION_DENIED',
  'VERSION_REF_WRITE_UNAVAILABLE',
  'VERSION_STORE_READ_ONLY',
]);

export function serviceUnavailableDiagnostic(): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_GRAPH_UNINITIALIZED',
    'No document-scoped version write service is attached; no commit was fabricated.',
    {
      severity: 'error',
      recoverability: 'unsupported',
      mutationGuarantee: 'no-write-attempted',
    },
  );
}

export function providerErrorDiagnostic(
  payload: VersionDiagnosticPublicPayload = {},
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_PROVIDER_ERROR',
    'The version write service failed before returning a usable public commit ref.',
    {
      severity: 'error',
      recoverability: 'retry',
      payload,
      mutationGuarantee: 'unknown-after-crash',
    },
  );
}

export function missingChangeSetDiagnostic(
  captureState: NormalCommitCaptureAdmissionState,
  dirtyState: VersionSurfaceDirtyAdmissionState | null,
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_MISSING_CHANGE_SET',
    safeMessageForIssue('VERSION_MISSING_CHANGE_SET'),
    {
      severity: 'error',
      recoverability: 'repair',
      payload: {
        operation: 'commitGraphWrite',
        reason:
          captureState.pendingUncapturedNormalMutationCount > 0
            ? 'uncaptured-normal-mutations'
            : 'empty-normal-capture',
        dirtyWorkingState: dirtyState?.hasUncommittedLocalChanges === true,
        pendingCapturedNormalMutationCount: captureState.pendingCapturedNormalMutationCount,
        pendingUncapturedNormalMutationCount: captureState.pendingUncapturedNormalMutationCount,
      },
      mutationGuarantee: 'no-write-attempted',
    },
  );
}

export function publicDiagnostic(
  issueCode: string,
  safeMessage: string,
  options: {
    readonly severity?: VersionStoreDiagnostic['severity'];
    readonly recoverability?: VersionStoreDiagnostic['recoverability'];
    readonly payload?: VersionDiagnosticPublicPayload;
    readonly mutationGuarantee?: VersionStoreDiagnostic['mutationGuarantee'];
  } = {},
): VersionStoreDiagnostic {
  return {
    issueCode,
    severity: options.severity ?? 'error',
    recoverability: options.recoverability ?? recoverabilityForIssue(issueCode),
    messageTemplateId: `version.commit.${issueCode}`,
    safeMessage,
    ...(options.payload ? { payload: options.payload } : {}),
    ...(options.mutationGuarantee ? { mutationGuarantee: options.mutationGuarantee } : {}),
    redacted: true,
  };
}

export function mapServiceDiagnostics(value: unknown): readonly VersionStoreDiagnostic[] {
  if (!Array.isArray(value) || value.length === 0) return [providerErrorDiagnostic()];
  return value.map(mapServiceDiagnostic);
}

export function mapOptionalServiceDiagnostics(
  value: unknown,
): readonly VersionStoreDiagnostic[] {
  if (!Array.isArray(value) || value.length === 0) return [];
  return value.map(mapServiceDiagnostic);
}

export function mapServiceDiagnostic(value: unknown): VersionStoreDiagnostic {
  if (!isRecord(value)) return providerErrorDiagnostic();

  const issueCode = publicIssueCodeFromDiagnostic(value);
  const severity = value.severity === 'corruption' ? 'error' : value.severity;

  return publicDiagnostic(issueCode, safeMessageForIssue(issueCode), {
    severity:
      severity === 'info' ||
      severity === 'warning' ||
      severity === 'error' ||
      severity === 'fatal'
        ? severity
        : 'error',
    recoverability: recoverabilityForIssue(issueCode),
    payload: sanitizeDiagnosticPayload(value, issueCode),
    mutationGuarantee: toMutationGuarantee(value.mutationGuarantee),
  });
}

export function safeMessageForIssue(issueCode: string): string {
  return SAFE_MESSAGES[issueCode] ?? 'The version graph could not complete commit.';
}

export function recoverabilityForIssue(
  issueCode: string,
): VersionStoreDiagnostic['recoverability'] {
  if (issueCode === 'VERSION_REF_CONFLICT') return 'retry';
  if (REPAIR_ISSUES.has(issueCode)) return 'repair';
  if (UNSUPPORTED_ISSUES.has(issueCode)) return 'unsupported';
  return 'none';
}

function publicIssueCodeFromDiagnostic(value: Readonly<Record<string, unknown>>): string {
  const issueCode =
    typeof value.issueCode === 'string'
      ? value.issueCode
      : typeof value.code === 'string'
        ? value.code
        : 'VERSION_PROVIDER_ERROR';
  if (issueCode !== 'VERSION_MISSING_DEPENDENCY') return issueCode;
  switch (objectKindFromDiagnostic(value)) {
    case 'snapshot-root':
      return 'VERSION_MISSING_SNAPSHOT_ROOT';
    case 'semantic-change-set':
      return 'VERSION_MISSING_CHANGE_SET';
    case 'mutation-segment':
      return 'VERSION_MISSING_MUTATION_SEGMENT';
    default:
      return issueCode;
  }
}

function sanitizeDiagnosticPayload(
  value: Readonly<Record<string, unknown>>,
  issueCode?: string,
): VersionDiagnosticPublicPayload {
  const payload: Record<string, string | number | boolean | null> = { operation: 'commit' };

  if (typeof value.operation === 'string') payload.operation = value.operation;
  if (typeof value.option === 'string') payload.option = value.option;
  const refName = value.refName;
  if (refName === VERSION_HEAD_REF || refName === VERSION_MAIN_REF) {
    payload.refName = refName;
  }

  const details = isRecord(value.details) ? value.details : null;
  if (details) {
    for (const key of ['option', 'mode', 'mutationGuarantee'] as const) {
      const detailValue = details[key];
      if (isPayloadPrimitive(detailValue)) payload[key] = detailValue;
    }
  }
  const objectKind = objectKindFromDiagnostic(value);
  if (objectKind) payload.objectKind = objectKind;
  if (issueCode === 'VERSION_MISSING_SNAPSHOT_ROOT') {
    payload.operation = 'validateCommitClosure';
  }

  return payload;
}

function objectKindFromDiagnostic(value: unknown, depth = 0): string | undefined {
  if (!isRecord(value) || depth > 4) return undefined;
  const direct = objectKindForObjectType(value.objectType);
  if (direct) return direct;
  const dependency = isRecord(value.dependency) ? value.dependency : null;
  const dependencyKind = objectKindForObjectType(dependency?.objectType);
  if (dependencyKind) return dependencyKind;
  for (const key of ['sourceDiagnostics', 'diagnostics'] as const) {
    const sources = value[key];
    if (!Array.isArray(sources)) continue;
    for (const source of sources) {
      const nested = objectKindFromDiagnostic(source, depth + 1);
      if (nested) return nested;
    }
  }
  return undefined;
}

function objectKindForObjectType(value: unknown): string | undefined {
  return typeof value === 'string' ? OBJECT_KIND_BY_TYPE[value] : undefined;
}

function toMutationGuarantee(
  value: unknown,
): VersionStoreDiagnostic['mutationGuarantee'] | undefined {
  return value === 'ref-not-mutated' ||
    value === 'registry-not-visible' ||
    value === 'no-write-attempted' ||
    value === 'unknown-after-crash'
    ? value
    : undefined;
}
