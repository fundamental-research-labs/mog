import type {
  PageCursor,
  Paged,
  VersionCreateReviewInput,
  VersionDiagnostic,
  VersionListReviewsInput,
  VersionResult,
  WorkbookCommitId,
  WorkbookVersionReviewApprovalEvidence,
  WorkbookVersionReviewDecision,
  WorkbookVersionReviewDecisionDraft,
  WorkbookVersionReviewRecord,
  WorkbookVersionReviewRecordSummary,
  WorkbookVersionReviewStatus,
  WorkbookVersionReviewSubject,
} from '@mog-sdk/contracts/api';

import { objectDigestFor } from './merge-apply-intent-store';
import type { VersionDocumentScope } from './registry';
import {
  canonicalJsonStringify,
  cloneJson,
  cloneRecord,
  cloneRow,
  isWorkbookVersionReviewRecordStoreRow,
} from './review-service-codec';
import { reviewServiceSemanticTargetSupport } from './review-service-target-support';

export const DEFAULT_REVIEW_LIST_LIMIT = 50;

const REVIEW_LIST_CURSOR_PREFIX = 'review-list:';
const USER_OWNED_STATUSES = new Set<WorkbookVersionReviewStatus>([
  'open',
  'approved',
  'changes_requested',
  'rejected',
]);
const TERMINAL_STATUSES = new Set<WorkbookVersionReviewStatus>([
  'rejected',
  'applied',
  'superseded',
  'stale',
]);
const ACTIVE_REVIEW_STATUSES = new Set<WorkbookVersionReviewStatus>([
  'open',
  'approved',
  'changes_requested',
]);

export type WorkbookVersionReviewMutationOperation =
  | 'createReview'
  | 'appendReviewDecision'
  | 'updateReviewStatus';

export type WorkbookVersionReviewMutationLogEntry = {
  readonly schemaVersion: 1;
  readonly operation: WorkbookVersionReviewMutationOperation;
  readonly clientRequestId: string;
  readonly fingerprint: string;
  readonly resultRecord: WorkbookVersionReviewRecord;
  readonly recordedAt: string;
};

export type WorkbookVersionReviewRecordStoreRow = {
  readonly schemaVersion: 1;
  readonly operation: 'workbook-version-review-record';
  readonly documentScopeKey: string;
  readonly createClientRequestId: string;
  readonly record: WorkbookVersionReviewRecord;
  readonly mutationLog: readonly WorkbookVersionReviewMutationLogEntry[];
};

export type WorkbookVersionReviewRecordMemoryBackendSnapshot = {
  readonly rows: readonly WorkbookVersionReviewRecordStoreRow[];
};

export type ReviewRecordRowMutation<T> =
  | {
      readonly action: 'put';
      readonly row: WorkbookVersionReviewRecordStoreRow;
      readonly result: VersionResult<T>;
    }
  | { readonly action: 'none'; readonly result: VersionResult<T> };

export function reviewRecordStorageKey(documentScopeKey: string, reviewId: string): string {
  return `${documentScopeKey}\u0000review\u0000${reviewId}`;
}

export function storedWorkbookVersionReviewRecordRow(
  row: WorkbookVersionReviewRecordStoreRow,
): WorkbookVersionReviewRecordStoreRow {
  return cloneRow(row);
}

export function decodeStoredWorkbookVersionReviewRecordRow(
  value: unknown,
  documentScopeKey: string,
): WorkbookVersionReviewRecordStoreRow | null {
  if (!isWorkbookVersionReviewRecordStoreRow(value)) return null;
  return value.documentScopeKey === documentScopeKey ? cloneRow(value) : null;
}

export async function reviewIdForCreate(
  documentScopeKey: string,
  clientRequestId: string,
): Promise<string> {
  const digest = await objectDigestFor('mog.version.review-record.create.v1', {
    documentScopeKey,
    clientRequestId,
  });
  return `review:sha256:${digest.digest}`;
}

async function decisionIdForInput(input: {
  readonly reviewId: string;
  readonly clientRequestId: string;
  readonly decision: WorkbookVersionReviewDecisionDraft;
}): Promise<string> {
  const digest = await objectDigestFor('mog.version.review-record.decision.v1', input);
  return `review-decision:sha256:${digest.digest}`;
}

export function createReviewRecord(input: {
  readonly documentScope: VersionDocumentScope;
  readonly reviewId: string;
  readonly input: VersionCreateReviewInput;
  readonly createdAt: string;
}): WorkbookVersionReviewRecord {
  const subject = cloneJson(input.input.subject);
  const baseCommitId = input.input.baseCommitId ?? subjectBaseCommitId(subject);
  const headCommitId = input.input.headCommitId ?? subjectHeadCommitId(subject);
  const proposalId = subject.kind === 'proposal' ? subject.proposalId : undefined;
  return cloneRecord({
    schemaVersion: 1,
    id: input.reviewId,
    documentId: input.documentScope.documentId,
    subject,
    status: 'open',
    ...(input.input.title === undefined ? {} : { title: input.input.title }),
    ...(baseCommitId === undefined ? {} : { baseCommitId }),
    ...(headCommitId === undefined ? {} : { headCommitId }),
    ...(proposalId === undefined ? {} : { proposalId }),
    revision: 1,
    createdBy: cloneJson(input.input.createdBy),
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    decisions: [],
    redaction: {
      policy: cloneJson(input.input.redactionPolicy),
      redactedFields: [],
      diagnostics: [],
    },
    diagnostics: [],
  });
}

export async function materializeDecision(
  reviewId: string,
  clientRequestId: string,
  draft: WorkbookVersionReviewDecisionDraft,
  createdAt: string,
): Promise<WorkbookVersionReviewDecision> {
  return cloneJson({
    ...draft,
    id: await decisionIdForInput({ reviewId, clientRequestId, decision: draft }),
    createdAt,
  });
}

export function appendMutationLog(
  row: WorkbookVersionReviewRecordStoreRow,
  input: Omit<WorkbookVersionReviewMutationLogEntry, 'schemaVersion'>,
): WorkbookVersionReviewRecordStoreRow {
  return cloneRow({
    ...row,
    record: cloneRecord(input.resultRecord),
    mutationLog: [
      ...row.mutationLog,
      {
        schemaVersion: 1,
        operation: input.operation,
        clientRequestId: input.clientRequestId,
        fingerprint: input.fingerprint,
        resultRecord: cloneRecord(input.resultRecord),
        recordedAt: input.recordedAt,
      },
    ],
  });
}

export function idempotencyResult<T>(
  row: WorkbookVersionReviewRecordStoreRow,
  operation: WorkbookVersionReviewMutationOperation,
  clientRequestId: string,
  fingerprint: string,
): VersionResult<T> | null {
  const entry = row.mutationLog.find((item) => item.clientRequestId === clientRequestId);
  if (!entry) return null;
  if (entry.operation !== operation || entry.fingerprint !== fingerprint) {
    return invalidClientRequestReuse();
  }
  return ok(cloneRecord(entry.resultRecord) as T);
}

export function clientRequestIdWasUsed(
  row: WorkbookVersionReviewRecordStoreRow,
  clientRequestId: string,
): boolean {
  return row.mutationLog.some((entry) => entry.clientRequestId === clientRequestId);
}

export function createReviewFingerprint(input: VersionCreateReviewInput): unknown {
  return {
    clientRequestId: input.clientRequestId,
    subject: input.subject,
    title: input.title,
    createdBy: input.createdBy,
    baseCommitId: input.baseCommitId,
    headCommitId: input.headCommitId,
    redactionPolicy: input.redactionPolicy,
  };
}

export function mutationFingerprint(
  operation: WorkbookVersionReviewMutationOperation,
  value: unknown,
): string {
  return `${operation}:${canonicalJsonStringify(value)}`;
}

export function reviewMatchesListInput(
  record: WorkbookVersionReviewRecord,
  input: VersionListReviewsInput,
): boolean {
  if (input.subjectKind && record.subject.kind !== input.subjectKind) return false;
  if (input.status && record.status !== input.status) return false;
  if (input.proposalId && record.proposalId !== input.proposalId) return false;
  if (input.commitId && !reviewIncludesCommit(record, input.commitId)) return false;
  if (input.mergePreviewId && !reviewIncludesMergePreview(record.subject, input.mergePreviewId)) {
    return false;
  }
  if (input.conflictId && !reviewIncludesConflict(record.subject, input.conflictId)) return false;
  return true;
}

export function isActiveReview(record: WorkbookVersionReviewRecord): boolean {
  return ACTIVE_REVIEW_STATUSES.has(record.status);
}

export function reviewSubjectsEqual(
  left: WorkbookVersionReviewSubject,
  right: WorkbookVersionReviewSubject,
): boolean {
  return canonicalJsonStringify(left) === canonicalJsonStringify(right);
}

function reviewIncludesCommit(
  record: WorkbookVersionReviewRecord,
  commitId: WorkbookCommitId,
): boolean {
  if (record.baseCommitId === commitId || record.headCommitId === commitId) return true;
  return record.subject.kind === 'commit' && record.subject.commitId === commitId;
}

function reviewIncludesMergePreview(
  subject: WorkbookVersionReviewSubject,
  mergePreviewId: string,
): boolean {
  return (
    (subject.kind === 'merge' || subject.kind === 'conflict') &&
    subject.mergePreviewId === mergePreviewId
  );
}

function reviewIncludesConflict(
  subject: WorkbookVersionReviewSubject,
  conflictId: string,
): boolean {
  return subject.kind === 'conflict' && subject.conflictId === conflictId;
}

export function compareReviewsForList(
  left: WorkbookVersionReviewRecord,
  right: WorkbookVersionReviewRecord,
): number {
  if (left.updatedAt > right.updatedAt) return -1;
  if (left.updatedAt < right.updatedAt) return 1;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

export function reviewSummary(
  record: WorkbookVersionReviewRecord,
): WorkbookVersionReviewRecordSummary {
  return {
    id: record.id,
    documentId: record.documentId,
    subject: cloneJson(record.subject),
    status: record.status,
    ...(record.title === undefined ? {} : { title: record.title }),
    ...(record.baseCommitId === undefined ? {} : { baseCommitId: record.baseCommitId }),
    ...(record.headCommitId === undefined ? {} : { headCommitId: record.headCommitId }),
    ...(record.proposalId === undefined ? {} : { proposalId: record.proposalId }),
    revision: record.revision,
    createdBy: cloneJson(record.createdBy),
    updatedAt: record.updatedAt,
  };
}

export function validateDecisionDraft(
  decision: WorkbookVersionReviewDecisionDraft,
):
  | { readonly ok: true }
  | { readonly ok: false; readonly result: VersionResult<WorkbookVersionReviewRecord> } {
  if (
    decision.decision === 'mark_resolved' &&
    decision.target.kind === 'semanticChange' &&
    decision.target.derived
  ) {
    return {
      ok: false,
      result: invalidState(
        'derived_target_not_resolvable',
        ['authored_review_target'],
        'Derived-impact review targets may be commented on but cannot be marked resolved.',
      ),
    };
  }
  if (decision.decision === 'mark_resolved' && decision.target.kind === 'conflict') {
    return {
      ok: false,
      result: invalidState(
        'conflict_target_resolution_unavailable',
        ['semantic_review_target'],
        'Conflict review targets cannot be marked resolved until merge conflict application is enabled.',
      ),
    };
  }
  const targetSupport = validateSemanticDecisionTarget(decision.target);
  if (!targetSupport.ok) return targetSupport;
  return { ok: true };
}

function validateSemanticDecisionTarget(
  target: WorkbookVersionReviewDecisionDraft['target'],
):
  | { readonly ok: true }
  | { readonly ok: false; readonly result: VersionResult<WorkbookVersionReviewRecord> } {
  if (target.kind !== 'semanticChange') return { ok: true };
  const support = reviewServiceSemanticTargetSupport(target);
  if (support.ok) return { ok: true };
  return {
    ok: false,
    result: invalidState(
      'incomplete_review_target',
      ['complete_review_diff_target'],
      'Review decisions require complete supported review targets; hidden or unsupported semantic domains cannot be accepted.',
    ),
  };
}

export function validateApprovalEvidenceTargets(
  evidence: WorkbookVersionReviewApprovalEvidence | undefined,
):
  | { readonly ok: true }
  | { readonly ok: false; readonly result: VersionResult<WorkbookVersionReviewRecord> } {
  if (!evidence) return { ok: true };
  for (const item of evidence.requiredTargets) {
    const target = item.target;
    if (target.kind !== 'semanticChange') continue;
    const support = reviewServiceSemanticTargetSupport(target);
    if (support.ok) continue;
    return {
      ok: false,
      result: invalidState(
        'approval_required_targets_incomplete',
        ['complete_review_diff_targets'],
        'Manual approval requires complete authored review targets; hidden or unsupported semantic domains cannot be accepted.',
      ),
    };
  }
  return { ok: true };
}

export function validateStatusTransition(
  current: WorkbookVersionReviewStatus,
  next: WorkbookVersionReviewStatus,
  hasApprovalEvidence: boolean,
  flowOwnedStatus: boolean,
):
  | { readonly ok: true }
  | { readonly ok: false; readonly result: VersionResult<WorkbookVersionReviewRecord> } {
  if (TERMINAL_STATUSES.has(current)) {
    return {
      ok: false,
      result: invalidState(
        'terminal_review_status',
        ['new_review'],
        'Terminal review statuses cannot be manually reopened in this slice.',
      ),
    };
  }
  if (flowOwnedStatus) {
    if (current === 'approved' && next === 'applied') return { ok: true };
    return {
      ok: false,
      result: invalidState(
        'flow_owned_review_status_transition',
        ['approved_to_applied'],
        'Only approved reviews can be finalized as applied by proposal, merge, staleness, or supersede flows.',
      ),
    };
  }
  if (next === 'approved' && !hasApprovalEvidence) {
    return {
      ok: false,
      result: invalidState(
        'approval_requires_review_diff',
        ['open', 'changes_requested'],
        'Manual approval requires review diff coverage and approval evidence.',
      ),
    };
  }
  if (next === 'approved' && current !== 'open' && current !== 'changes_requested') {
    return {
      ok: false,
      result: invalidState(
        'review_status_not_approvable',
        ['open', 'changes_requested'],
        'Only open or changes_requested reviews can be manually approved.',
      ),
    };
  }
  if (!USER_OWNED_STATUSES.has(next)) {
    return {
      ok: false,
      result: invalidState(
        'flow_owned_review_status',
        ['open', 'approved', 'changes_requested', 'rejected'],
        `${next} is owned by proposal, merge, staleness, or supersede flows.`,
      ),
    };
  }
  return { ok: true };
}

function subjectBaseCommitId(subject: WorkbookVersionReviewSubject): WorkbookCommitId | undefined {
  return 'baseCommitId' in subject ? subject.baseCommitId : undefined;
}

function subjectHeadCommitId(subject: WorkbookVersionReviewSubject): WorkbookCommitId | undefined {
  if ('headCommitId' in subject) return subject.headCommitId;
  if (subject.kind === 'commit') return subject.commitId;
  return undefined;
}

export function parseReviewListCursor(cursor: PageCursor | undefined):
  | { readonly ok: true; readonly offset: number }
  | {
      readonly ok: false;
      readonly result: VersionResult<Paged<WorkbookVersionReviewRecordSummary>>;
    } {
  if (cursor === undefined) return { ok: true, offset: 0 };
  if (!cursor.startsWith(REVIEW_LIST_CURSOR_PREFIX)) {
    return {
      ok: false,
      result: invalidState(
        'stale_review_cursor',
        ['valid_cursor'],
        'Review list cursor is not valid for this store.',
      ),
    };
  }
  const offset = Number(cursor.slice(REVIEW_LIST_CURSOR_PREFIX.length));
  if (!Number.isSafeInteger(offset) || offset < 0) {
    return {
      ok: false,
      result: invalidState(
        'stale_review_cursor',
        ['valid_cursor'],
        'Review list cursor has an invalid offset.',
      ),
    };
  }
  return { ok: true, offset };
}

export function reviewListCursor(offset: number): PageCursor {
  return `${REVIEW_LIST_CURSOR_PREFIX}${offset}` as PageCursor;
}

export function ok<T>(value: T): VersionResult<T> {
  return { ok: true, value };
}

export function notFound<T>(reviewId: string): VersionResult<T> {
  return {
    ok: false,
    error: {
      code: 'not_found',
      target: 'workbook.version.review',
      reason: `Review record ${reviewId} was not found.`,
    },
  };
}

export function staleRevision<T>(
  expectedRevision: number,
  actualRevision: number,
): VersionResult<T> {
  return {
    ok: false,
    error: { code: 'stale_revision', expectedRevision, actualRevision },
  };
}

export function invalidClientRequestReuse<T>(): VersionResult<T> {
  return invalidState(
    'review_client_request_reused',
    ['idempotent_retry'],
    'clientRequestId is already bound to a different review mutation payload.',
  );
}

export function invalidState<T>(
  state: string,
  allowed: readonly string[],
  reason: string,
): VersionResult<T> {
  return { ok: false, error: { code: 'invalid_state', state, allowed, reason } };
}

export function diagnostic(
  code: string,
  severity: VersionDiagnostic['severity'],
  message: string,
): VersionDiagnostic {
  return { code, severity, message };
}
