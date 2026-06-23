import type {
  VersionAuthor,
  VersionDiagnostic,
  WorkbookVersionReviewApprovalEvidence,
  WorkbookVersionReviewDecision,
  WorkbookVersionReviewDiffChange,
  WorkbookVersionReviewDiffPage,
  WorkbookVersionReviewRecord,
  WorkbookVersionReviewRecordSummary,
} from '@mog-sdk/contracts/api';

import {
  reviewAccessDiffPageRejectionDiagnostics,
  sanitizeDiagnosticData,
  sanitizeDiagnosticString,
  sanitizeVersionDiagnostics,
} from './review-access-diagnostics';
import {
  projectReviewAccessChangeValue,
  structuralFromReviewTarget,
} from './review-access-value-projection';

export { projectReviewAccessDiffValue } from './review-access-value-projection';

export function projectReviewAccessRecordSummary(
  record: WorkbookVersionReviewRecordSummary,
): WorkbookVersionReviewRecordSummary {
  return {
    ...cloneJson(record),
    ...(record.title === undefined ? {} : { title: sanitizeDiagnosticString(record.title) }),
    createdBy: projectReviewAccessAuthor(record.createdBy),
  };
}

export function projectReviewAccessRecord(
  record: WorkbookVersionReviewRecord,
): WorkbookVersionReviewRecord {
  const summary = projectReviewAccessRecordSummary(record);
  return {
    ...cloneJson(record),
    ...summary,
    decisions: record.decisions.map(projectReviewAccessDecision),
    ...(record.approval === undefined
      ? {}
      : { approval: projectReviewAccessApproval(record.approval) }),
    redaction: {
      policy: cloneJson(record.redaction.policy),
      redactedFields: record.redaction.redactedFields.includes('reviewAuthors.principalTrace')
        ? [...record.redaction.redactedFields]
        : [...record.redaction.redactedFields, 'reviewAuthors.principalTrace'],
      diagnostics: sanitizeVersionDiagnostics(record.redaction.diagnostics),
    },
    diagnostics: sanitizeVersionDiagnostics(record.diagnostics),
  };
}

export function projectReviewAccessDiffPage(
  page: WorkbookVersionReviewDiffPage,
):
  | { readonly ok: true; readonly value: WorkbookVersionReviewDiffPage }
  | { readonly ok: false; readonly diagnostics: readonly VersionDiagnostic[] } {
  const rejectionDiagnostics = reviewAccessDiffPageRejectionDiagnostics(page);
  if (rejectionDiagnostics.length > 0) return { ok: false, diagnostics: rejectionDiagnostics };

  const changes = page.changes.map(projectReviewAccessDiffChange);
  const derivedImpact = page.derivedImpact?.map(projectReviewAccessDiffChange);
  return {
    ok: true,
    value: {
      schemaVersion: page.schemaVersion,
      source: page.source,
      baseCommitId: page.baseCommitId,
      headCommitId: page.headCommitId,
      changeSetDigest: cloneJson(page.changeSetDigest),
      ...(page.reviewId === undefined ? {} : { reviewId: page.reviewId }),
      changes,
      ...(derivedImpact === undefined ? {} : { derivedImpact }),
      summary: {
        ...cloneJson(page.summary),
        authoredChanges: changes.length,
        derivedChanges: derivedImpact?.length ?? page.summary.derivedChanges,
      },
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      limit: page.limit,
      diagnostics: sanitizeVersionDiagnostics(page.diagnostics),
    },
  };
}

export function sanitizeReviewAccessDiagnostics(
  diagnostics: readonly VersionDiagnostic[],
): readonly VersionDiagnostic[] {
  return sanitizeVersionDiagnostics(diagnostics);
}

function projectReviewAccessDecision(
  decision: WorkbookVersionReviewDecision,
): WorkbookVersionReviewDecision {
  return {
    ...cloneJson(decision),
    reviewer: projectReviewAccessAuthor(decision.reviewer),
    ...(decision.body === undefined ? {} : { body: sanitizeDiagnosticString(decision.body) }),
    ...(decision.metadata === undefined
      ? {}
      : {
          metadata: sanitizeDiagnosticData(
            decision.metadata,
          ) as WorkbookVersionReviewDecision['metadata'],
        }),
  };
}

function projectReviewAccessApproval(
  approval: WorkbookVersionReviewApprovalEvidence,
): WorkbookVersionReviewApprovalEvidence {
  return {
    ...cloneJson(approval),
    approvedBy: projectReviewAccessAuthor(approval.approvedBy),
  };
}

function projectReviewAccessAuthor(author: VersionAuthor): VersionAuthor {
  return {
    kind: author.kind,
    trust: author.trust,
    ...(author.displayName === undefined
      ? {}
      : { displayName: sanitizeDiagnosticString(author.displayName) }),
  };
}

function projectReviewAccessDiffChange(
  change: WorkbookVersionReviewDiffChange,
): WorkbookVersionReviewDiffChange {
  const structural = structuralFromReviewTarget(change.target);
  return {
    ...cloneJson(change),
    before: structural
      ? projectReviewAccessChangeValue(structural, change.before)
      : cloneJson(change.before),
    after: structural
      ? projectReviewAccessChangeValue(structural, change.after)
      : cloneJson(change.after),
    diagnostics: sanitizeVersionDiagnostics(change.diagnostics),
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
