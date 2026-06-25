import type {
  VersionDiagnosticPublicPayload,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import type {
  NormalCommitCaptureAdmissionState,
  VersionSurfaceDirtyAdmissionState,
} from './version-commit-types';
import {
  VERSION_COMMIT_OBJECT_KIND_BY_TYPE,
  VERSION_COMMIT_REPAIR_ISSUES,
  VERSION_COMMIT_SAFE_MESSAGES,
  VERSION_COMMIT_UNSUPPORTED_ISSUES,
  VERSION_HEAD_REF,
  VERSION_MAIN_REF,
} from './version-commit-constants';
import { isPayloadPrimitive, isRecord } from './version-commit-utils';

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

export function mapOptionalServiceDiagnostics(value: unknown): readonly VersionStoreDiagnostic[] {
  if (!Array.isArray(value) || value.length === 0) return [];
  return value.map(mapServiceDiagnostic);
}

export function mapServiceDiagnostic(value: unknown): VersionStoreDiagnostic {
  if (!isRecord(value)) return providerErrorDiagnostic();

  const issueCode = publicIssueCodeFromDiagnostic(value);
  const severity = value.severity === 'corruption' ? 'error' : value.severity;

  return publicDiagnostic(issueCode, safeMessageForIssue(issueCode), {
    severity:
      severity === 'info' || severity === 'warning' || severity === 'error' || severity === 'fatal'
        ? severity
        : 'error',
    recoverability: recoverabilityForIssue(issueCode),
    payload: sanitizeDiagnosticPayload(value, issueCode),
    mutationGuarantee: toMutationGuarantee(value.mutationGuarantee),
  });
}

export function safeMessageForIssue(issueCode: string): string {
  return VERSION_COMMIT_SAFE_MESSAGES[issueCode] ?? 'The version graph could not complete commit.';
}

export function recoverabilityForIssue(
  issueCode: string,
): VersionStoreDiagnostic['recoverability'] {
  if (issueCode === 'VERSION_REF_CONFLICT') return 'retry';
  if (VERSION_COMMIT_REPAIR_ISSUES.has(issueCode)) return 'repair';
  if (VERSION_COMMIT_UNSUPPORTED_ISSUES.has(issueCode)) return 'unsupported';
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
  return typeof value === 'string' ? VERSION_COMMIT_OBJECT_KIND_BY_TYPE[value] : undefined;
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
