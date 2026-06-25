import type {
  RedactedVersionAuthor,
  VersionDiagnosticPublicPayload,
  VersionResult,
  VersionStoreDiagnostic,
  WorkbookCommitId,
  WorkbookCommitSummary,
} from '@mog-sdk/contracts/api';

import {
  mapOptionalServiceDiagnostics,
  mapServiceDiagnostic,
  mapServiceDiagnostics,
  providerErrorDiagnostic,
  publicDiagnostic,
  recoverabilityForIssue,
  safeMessageForIssue,
} from './version-commit-diagnostics';
import { isPayloadPrimitive, isRecord, toCommitId } from './version-commit-utils';
import { mapWorkbookCommitAnnotationSummary } from '../version-commit-summary-projection';
import { versionFailureFromStoreDiagnostics } from '../../version-result';

export function mapCommitWriteResult(value: unknown): VersionResult<WorkbookCommitSummary> {
  const directSummary = mapCommitSummary(value);
  if (directSummary) return commitSummaryResult(directSummary);

  if (!isRecord(value)) {
    return versionFailureFromStoreDiagnostics('commit', [providerErrorDiagnostic()]);
  }

  if (value.status === 'failed' || value.status === 'degraded') {
    return versionFailureFromStoreDiagnostics('commit', mapCommitFailureDiagnostics(value));
  }
  if (value.status !== 'success') {
    return versionFailureFromStoreDiagnostics('commit', [providerErrorDiagnostic()]);
  }

  const summary =
    mapCommitSummary(value.summary) ??
    mapCommitSummary(value.commitSummary) ??
    mapCommitSummary(value.commit) ??
    mapCommitSummary(value.rootCommit);

  if (summary) {
    return commitSummaryResult(
      withResultDiagnostics(summary, mapOptionalServiceDiagnostics(value.diagnostics)),
    );
  }

  return versionFailureFromStoreDiagnostics('commit', [
    publicDiagnostic(
      'VERSION_INVALID_COMMIT_PAYLOAD',
      safeMessageForIssue('VERSION_INVALID_COMMIT_PAYLOAD'),
      {
        severity: 'error',
        recoverability: 'repair',
        mutationGuarantee: 'unknown-after-crash',
      },
    ),
  ]);
}

export function diagnosticsFromThrownError(error: unknown): readonly VersionStoreDiagnostic[] {
  if (isRecord(error)) {
    const detailsDiagnostics = isRecord(error.details) ? error.details.diagnostics : undefined;
    if (Array.isArray(detailsDiagnostics)) return mapServiceDiagnostics(detailsDiagnostics);
    if (Array.isArray(error.diagnostics)) return mapServiceDiagnostics(error.diagnostics);
    if (isRecord(error.diagnostic)) return [mapServiceDiagnostic(error.diagnostic)];
  }

  return [providerErrorDiagnostic()];
}

function mapCommitFailureDiagnostics(
  value: Readonly<Record<string, unknown>>,
): readonly VersionStoreDiagnostic[] {
  const diagnostics = mapServiceDiagnostics(value.diagnostics);
  const mutationGuarantee = toFailureMutationGuarantee(value.mutationGuarantee);
  if (!mutationGuarantee) return diagnostics;
  return diagnostics.map((diagnostic) =>
    diagnostic.mutationGuarantee ? diagnostic : { ...diagnostic, mutationGuarantee },
  );
}

function commitSummaryResult(summary: WorkbookCommitSummary): VersionResult<WorkbookCommitSummary> {
  if (summary.parents.length > 0) return { ok: true, value: summary };
  return versionFailureFromStoreDiagnostics('commit', [
    publicDiagnostic(
      'VERSION_MISSING_CHANGE_SET',
      safeMessageForIssue('VERSION_MISSING_CHANGE_SET'),
      {
        payload: { operation: 'commitGraphWrite', reason: 'empty-normal-commit' },
        mutationGuarantee: 'unknown-after-crash',
      },
    ),
  ]);
}

function mapCommitSummary(value: unknown): WorkbookCommitSummary | null {
  if (!isRecord(value)) return null;
  const payload = isRecord(value.payload) ? value.payload : null;
  const id = toCommitId(value.id);
  const parentsValue = Array.isArray(value.parents)
    ? value.parents
    : Array.isArray(value.parentCommitIds)
      ? value.parentCommitIds
      : Array.isArray(payload?.parentCommitIds)
        ? payload.parentCommitIds
        : null;
  const createdAt =
    typeof value.createdAt === 'string'
      ? value.createdAt
      : typeof payload?.createdAt === 'string'
        ? payload.createdAt
        : null;
  const author = mapRedactedAuthor(value.author ?? payload?.author);

  if (!id || !parentsValue || !createdAt || !author) return null;
  const parents = parentsValue.map(toCommitId);
  if (parents.some((parent): parent is null => parent === null)) return null;

  const annotation = mapWorkbookCommitAnnotationSummary(value.annotation ?? payload?.annotation);
  const diagnostics = [
    ...mapOptionalServiceDiagnostics(value.diagnostics),
    ...mapCommitCompletenessDiagnostics(payload?.completenessDiagnostics),
  ];

  return {
    id,
    parents: parents as WorkbookCommitId[],
    createdAt,
    author,
    ...(annotation ? { annotation } : {}),
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
  };
}

function withResultDiagnostics(
  summary: WorkbookCommitSummary,
  diagnostics: readonly VersionStoreDiagnostic[],
): WorkbookCommitSummary {
  if (diagnostics.length === 0) return summary;
  return { ...summary, diagnostics: [...(summary.diagnostics ?? []), ...diagnostics] };
}

function mapRedactedAuthor(value: unknown): RedactedVersionAuthor | null {
  if (!isRecord(value)) return null;
  return {
    ...(typeof value.actorKind === 'string' ? { actorKind: value.actorKind } : {}),
    ...(typeof value.displayName === 'string' ? { displayName: value.displayName } : {}),
    redacted: true,
  };
}

function mapCommitCompletenessDiagnostics(value: unknown): readonly VersionStoreDiagnostic[] {
  if (!Array.isArray(value) || value.length === 0) return [];
  return value.map(mapCommitCompletenessDiagnostic);
}

function mapCommitCompletenessDiagnostic(value: unknown): VersionStoreDiagnostic {
  if (!isRecord(value)) return providerErrorDiagnostic();
  const issueCode = typeof value.code === 'string' ? value.code : 'VERSION_PROVIDER_ERROR';
  const severity = value.severity;
  return publicDiagnostic(
    issueCode,
    typeof value.message === 'string'
      ? value.message
      : 'The version commit includes a completeness diagnostic.',
    {
      severity:
        severity === 'info' || severity === 'warning' || severity === 'error' ? severity : 'error',
      recoverability: recoverabilityForIssue(issueCode),
      payload: sanitizeCompletenessDiagnosticPayload(value),
    },
  );
}

function sanitizeCompletenessDiagnosticPayload(
  value: Readonly<Record<string, unknown>>,
): VersionDiagnosticPublicPayload {
  const payload: Record<string, string | number | boolean | null> = { operation: 'commit' };
  if (typeof value.path === 'string') payload.path = value.path;
  const details = isRecord(value.details) ? value.details : null;
  if (details) {
    for (const [key, detailValue] of Object.entries(details)) {
      if (isPayloadPrimitive(detailValue)) payload[key] = detailValue;
    }
  }
  return payload;
}

function toFailureMutationGuarantee(
  value: unknown,
): VersionStoreDiagnostic['mutationGuarantee'] | undefined {
  return value === 'ref-not-mutated' ||
    value === 'registry-not-visible' ||
    value === 'no-write-attempted' ||
    value === 'unknown-after-crash'
    ? value
    : undefined;
}
