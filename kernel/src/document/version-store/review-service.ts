import type {
  PageCursor,
  Paged,
  VersionAppendReviewDecisionInput,
  VersionCreateReviewInput,
  VersionDiagnostic,
  VersionGetReviewDiffInput,
  VersionGetReviewInput,
  VersionListReviewsInput,
  VersionResult,
  WorkbookVersionReviewDecision,
  WorkbookVersionReviewDecisionDraft,
  WorkbookVersionReviewApprovalEvidence,
  WorkbookVersionReviewDiffPage,
  WorkbookVersionReviewRecord,
  WorkbookVersionReviewRecordSummary,
  WorkbookVersionReviewStatus,
  WorkbookVersionReviewSubject,
  VersionUpdateReviewStatusInput,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import { objectDigestFor } from './merge-apply-intent-store';
import {
  normalizeVersionDocumentScope,
  versionDocumentScopeKey,
  type VersionDocumentScope,
} from './registry';
import {
  reviewRecordWithoutApproval,
  validateApprovalEvidenceForStatusMutation,
} from './review-approval';

const DEFAULT_REVIEW_LIST_LIMIT = 50;
const REVIEW_LIST_CURSOR_PREFIX = 'review-list:';
const REVIEW_ID_RE = /^review:sha256:[0-9a-f]{64}$/;
const REVIEW_DECISION_ID_RE = /^review-decision:sha256:[0-9a-f]{64}$/;
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

export interface WorkbookVersionReviewService {
  listReviews(
    input: VersionListReviewsInput,
  ): Promise<VersionResult<Paged<WorkbookVersionReviewRecordSummary>>>;
  getReview(input: VersionGetReviewInput): Promise<VersionResult<WorkbookVersionReviewRecord>>;
  createReview(
    input: VersionCreateReviewInput,
  ): Promise<VersionResult<WorkbookVersionReviewRecord>>;
  appendReviewDecision(
    input: VersionAppendReviewDecisionInput,
  ): Promise<VersionResult<WorkbookVersionReviewRecord>>;
  updateReviewStatus(
    input: VersionUpdateReviewStatusInput,
  ): Promise<VersionResult<WorkbookVersionReviewRecord>>;
  markReviewApplied?(
    input: WorkbookVersionMarkReviewAppliedInput,
  ): Promise<VersionResult<WorkbookVersionReviewRecord>>;
  getReviewDiff(
    input: VersionGetReviewDiffInput,
  ): Promise<VersionResult<WorkbookVersionReviewDiffPage>>;
}

export interface WorkbookVersionReviewRecordStore {
  readonly documentScope: VersionDocumentScope;
  listReviews(
    input: VersionListReviewsInput,
  ): Promise<VersionResult<Paged<WorkbookVersionReviewRecordSummary>>>;
  getReview(input: VersionGetReviewInput): Promise<VersionResult<WorkbookVersionReviewRecord>>;
  createReview(
    input: VersionCreateReviewInput,
  ): Promise<VersionResult<WorkbookVersionReviewRecord>>;
  appendReviewDecision(
    input: VersionAppendReviewDecisionInput,
  ): Promise<VersionResult<WorkbookVersionReviewRecord>>;
  updateReviewStatus(
    input: VersionUpdateReviewStatusInput,
    options?: WorkbookVersionReviewStatusUpdateOptions,
  ): Promise<VersionResult<WorkbookVersionReviewRecord>>;
}

export type WorkbookVersionReviewStatusUpdateOptions = {
  readonly approvalEvidence?: WorkbookVersionReviewApprovalEvidence;
  readonly flowOwnedStatus?: boolean;
  readonly preserveApproval?: boolean;
  readonly updatedAt?: string;
};

export type WorkbookVersionMarkReviewAppliedInput = {
  readonly reviewId: VersionUpdateReviewStatusInput['reviewId'];
  readonly clientRequestId: VersionUpdateReviewStatusInput['clientRequestId'];
  readonly actor: VersionUpdateReviewStatusInput['actor'];
  readonly reason?: VersionUpdateReviewStatusInput['reason'];
};

export type WorkbookVersionReviewRecordStoreProvider = {
  openWorkbookVersionReviewRecordStore(): Promise<WorkbookVersionReviewRecordStore>;
};

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

export type WorkbookVersionReviewRecordStoreAdapter = {
  readRow(reviewId: string): Promise<WorkbookVersionReviewRecordStoreRow | undefined>;
  listRows(): Promise<readonly WorkbookVersionReviewRecordStoreRow[]>;
  mutateRow<T>(
    reviewId: string,
    mutator: (row: WorkbookVersionReviewRecordStoreRow | undefined) => ReviewRecordRowMutation<T>,
  ): Promise<VersionResult<T>>;
  mutateRows<T>(
    mutator: (rows: readonly WorkbookVersionReviewRecordStoreRow[]) => ReviewRecordRowMutation<T>,
  ): Promise<VersionResult<T>>;
};

export type ReviewRecordRowMutation<T> =
  | {
      readonly action: 'put';
      readonly row: WorkbookVersionReviewRecordStoreRow;
      readonly result: VersionResult<T>;
    }
  | { readonly action: 'none'; readonly result: VersionResult<T> };

export class WorkbookVersionReviewRecordMemoryBackend {
  private readonly rowsByKey = new Map<string, WorkbookVersionReviewRecordStoreRow>();

  get(documentScopeKey: string, reviewId: string): WorkbookVersionReviewRecordStoreRow | undefined {
    return cloneRow(this.rowsByKey.get(reviewRecordStorageKey(documentScopeKey, reviewId)));
  }

  put(row: WorkbookVersionReviewRecordStoreRow): void {
    this.rowsByKey.set(reviewRecordStorageKey(row.documentScopeKey, row.record.id), cloneRow(row));
  }

  list(documentScopeKey: string): readonly WorkbookVersionReviewRecordStoreRow[] {
    return [...this.rowsByKey.values()]
      .filter((row) => row.documentScopeKey === documentScopeKey)
      .map((row) => cloneRow(row));
  }

  exportSnapshot(): WorkbookVersionReviewRecordMemoryBackendSnapshot {
    return { rows: [...this.rowsByKey.values()].map((row) => cloneRow(row)) };
  }

  static fromSnapshot(
    snapshot: WorkbookVersionReviewRecordMemoryBackendSnapshot,
  ): WorkbookVersionReviewRecordMemoryBackend {
    const backend = new WorkbookVersionReviewRecordMemoryBackend();
    for (const row of snapshot.rows) backend.put(row);
    return backend;
  }
}

export class WorkbookVersionReviewRecordStoreImpl implements WorkbookVersionReviewRecordStore {
  readonly documentScope: VersionDocumentScope;

  private readonly adapter: WorkbookVersionReviewRecordStoreAdapter;
  private readonly documentScopeKey: string;

  constructor(options: {
    readonly documentScope: VersionDocumentScope;
    readonly adapter: WorkbookVersionReviewRecordStoreAdapter;
  }) {
    this.documentScope = normalizeVersionDocumentScope(options.documentScope);
    this.documentScopeKey = versionDocumentScopeKey(this.documentScope);
    this.adapter = options.adapter;
  }

  async listReviews(
    input: VersionListReviewsInput,
  ): Promise<VersionResult<Paged<WorkbookVersionReviewRecordSummary>>> {
    const cursor = parseReviewListCursor(input.cursor);
    if (!cursor.ok) return cursor.result;

    const limit = input.limit ?? DEFAULT_REVIEW_LIST_LIMIT;
    const rows = await this.adapter.listRows();
    const filtered = rows
      .map((row) => row.record)
      .filter((record) => reviewMatchesListInput(record, input))
      .sort(compareReviewsForList);
    const page = filtered.slice(cursor.offset, cursor.offset + limit);
    const nextOffset = cursor.offset + page.length;
    return {
      ok: true,
      value: {
        items: page.map(reviewSummary),
        ...(nextOffset < filtered.length ? { nextCursor: reviewListCursor(nextOffset) } : {}),
        limit,
        totalEstimate: filtered.length,
      },
    };
  }

  async getReview(
    input: VersionGetReviewInput,
  ): Promise<VersionResult<WorkbookVersionReviewRecord>> {
    const row = await this.adapter.readRow(input.reviewId);
    return row ? ok(cloneRecord(row.record)) : notFound(input.reviewId);
  }

  async createReview(
    input: VersionCreateReviewInput,
  ): Promise<VersionResult<WorkbookVersionReviewRecord>> {
    const reviewId = await reviewIdForCreate(this.documentScopeKey, input.clientRequestId);
    const fingerprint = mutationFingerprint('createReview', createReviewFingerprint(input));
    const createdAt = new Date().toISOString();
    return this.adapter.mutateRows<WorkbookVersionReviewRecord>((rows) => {
      const existing = rows.find((row) => row.record.id === reviewId);
      if (existing) {
        const idempotent = idempotencyResult<WorkbookVersionReviewRecord>(
          existing,
          'createReview',
          input.clientRequestId,
          fingerprint,
        );
        return { action: 'none', result: idempotent ?? invalidClientRequestReuse() };
      }

      const duplicate = rows.find(
        (row) =>
          isActiveReview(row.record) && reviewSubjectsEqual(row.record.subject, input.subject),
      );
      if (duplicate) {
        return {
          action: 'none',
          result: invalidState(
            'active_review_exists',
            ['existing_active_review', 'terminal_review_then_new_review'],
            'An active review already exists for this review subject.',
          ),
        };
      }

      const record = createReviewRecord({
        documentScope: this.documentScope,
        reviewId,
        input,
        createdAt,
      });
      const row: WorkbookVersionReviewRecordStoreRow = {
        schemaVersion: 1,
        operation: 'workbook-version-review-record',
        documentScopeKey: this.documentScopeKey,
        createClientRequestId: input.clientRequestId,
        record,
        mutationLog: [
          {
            schemaVersion: 1,
            operation: 'createReview',
            clientRequestId: input.clientRequestId,
            fingerprint,
            resultRecord: cloneRecord(record),
            recordedAt: createdAt,
          },
        ],
      };
      return { action: 'put', row, result: ok(cloneRecord(record)) };
    });
  }

  async appendReviewDecision(
    input: VersionAppendReviewDecisionInput,
  ): Promise<VersionResult<WorkbookVersionReviewRecord>> {
    const fingerprint = mutationFingerprint('appendReviewDecision', {
      clientRequestId: input.clientRequestId,
      decision: input.decision,
    });
    const createdAt = new Date().toISOString();
    const decision = await materializeDecision(
      input.reviewId,
      input.clientRequestId,
      input.decision,
      createdAt,
    );
    return this.adapter.mutateRow<WorkbookVersionReviewRecord>(input.reviewId, (row) => {
      if (!row) return { action: 'none', result: notFound(input.reviewId) };
      const idempotent = idempotencyResult<WorkbookVersionReviewRecord>(
        row,
        'appendReviewDecision',
        input.clientRequestId,
        fingerprint,
      );
      if (idempotent) return { action: 'none', result: idempotent };
      if (clientRequestIdWasUsed(row, input.clientRequestId)) {
        return { action: 'none', result: invalidClientRequestReuse() };
      }
      if (row.record.revision !== input.expectedRevision) {
        return {
          action: 'none',
          result: staleRevision(input.expectedRevision, row.record.revision),
        };
      }
      const decisionValidation = validateDecisionDraft(input.decision);
      if (!decisionValidation.ok) return { action: 'none', result: decisionValidation.result };

      const record: WorkbookVersionReviewRecord = {
        ...row.record,
        revision: row.record.revision + 1,
        decisions: [...row.record.decisions, decision],
        updatedAt: createdAt,
      };
      const updatedRow = appendMutationLog(row, {
        operation: 'appendReviewDecision',
        clientRequestId: input.clientRequestId,
        fingerprint,
        resultRecord: record,
        recordedAt: createdAt,
      });
      return { action: 'put', row: updatedRow, result: ok(cloneRecord(record)) };
    });
  }

  async updateReviewStatus(
    input: VersionUpdateReviewStatusInput,
    options: WorkbookVersionReviewStatusUpdateOptions = {},
  ): Promise<VersionResult<WorkbookVersionReviewRecord>> {
    const fingerprint = mutationFingerprint('updateReviewStatus', {
      clientRequestId: input.clientRequestId,
      status: input.status,
      actor: input.actor,
      reason: input.reason,
    });
    return this.adapter.mutateRow<WorkbookVersionReviewRecord>(input.reviewId, (row) => {
      if (!row) return { action: 'none', result: notFound(input.reviewId) };
      const idempotent = idempotencyResult<WorkbookVersionReviewRecord>(
        row,
        'updateReviewStatus',
        input.clientRequestId,
        fingerprint,
      );
      if (idempotent) return { action: 'none', result: idempotent };
      if (clientRequestIdWasUsed(row, input.clientRequestId)) {
        return { action: 'none', result: invalidClientRequestReuse() };
      }
      if (row.record.revision !== input.expectedRevision) {
        return {
          action: 'none',
          result: staleRevision(input.expectedRevision, row.record.revision),
        };
      }
      const transition = validateStatusTransition(
        row.record.status,
        input.status,
        Boolean(options.approvalEvidence),
        options.flowOwnedStatus === true,
      );
      if (!transition.ok) return { action: 'none', result: transition.result };
      const approval = validateApprovalEvidenceForStatusMutation(
        row.record,
        input,
        options.approvalEvidence,
      );
      if (!approval.ok) return { action: 'none', result: approval.result };

      const updatedAt = options.updatedAt ?? new Date().toISOString();
      const recordBase = options.preserveApproval
        ? cloneJson(row.record)
        : reviewRecordWithoutApproval(row.record);
      const record: WorkbookVersionReviewRecord = {
        ...recordBase,
        status: input.status,
        revision: row.record.revision + 1,
        updatedAt,
        ...(input.status === 'approved' && options.approvalEvidence
          ? { approval: cloneJson(options.approvalEvidence) }
          : {}),
        diagnostics: input.reason
          ? [
              ...row.record.diagnostics,
              diagnostic('VERSION_REVIEW_STATUS_REASON', 'info', input.reason),
            ]
          : row.record.diagnostics,
      };
      const updatedRow = appendMutationLog(row, {
        operation: 'updateReviewStatus',
        clientRequestId: input.clientRequestId,
        fingerprint,
        resultRecord: record,
        recordedAt: updatedAt,
      });
      return { action: 'put', row: updatedRow, result: ok(cloneRecord(record)) };
    });
  }
}

export class InMemoryWorkbookVersionReviewRecordStore
  extends WorkbookVersionReviewRecordStoreImpl
  implements WorkbookVersionReviewRecordStore
{
  constructor(options: {
    readonly documentScope: VersionDocumentScope;
    readonly backend: WorkbookVersionReviewRecordMemoryBackend;
  }) {
    const documentScope = normalizeVersionDocumentScope(options.documentScope);
    const documentScopeKey = versionDocumentScopeKey(documentScope);
    super({
      documentScope,
      adapter: {
        async readRow(reviewId) {
          return options.backend.get(documentScopeKey, reviewId);
        },
        async listRows() {
          return options.backend.list(documentScopeKey);
        },
        async mutateRow(reviewId, mutator) {
          const result = mutator(options.backend.get(documentScopeKey, reviewId));
          if (result.action === 'put') options.backend.put(result.row);
          return result.result;
        },
        async mutateRows(mutator) {
          const result = mutator(options.backend.list(documentScopeKey));
          if (result.action === 'put') options.backend.put(result.row);
          return result.result;
        },
      },
    });
  }
}

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

async function reviewIdForCreate(
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

function createReviewRecord(input: {
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

async function materializeDecision(
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

function appendMutationLog(
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

function idempotencyResult<T>(
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

function clientRequestIdWasUsed(
  row: WorkbookVersionReviewRecordStoreRow,
  clientRequestId: string,
): boolean {
  return row.mutationLog.some((entry) => entry.clientRequestId === clientRequestId);
}

function createReviewFingerprint(input: VersionCreateReviewInput): unknown {
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

function mutationFingerprint(
  operation: WorkbookVersionReviewMutationOperation,
  value: unknown,
): string {
  return `${operation}:${canonicalJsonStringify(value)}`;
}

function reviewMatchesListInput(
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

function isActiveReview(record: WorkbookVersionReviewRecord): boolean {
  return ACTIVE_REVIEW_STATUSES.has(record.status);
}

function reviewSubjectsEqual(
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

function compareReviewsForList(
  left: WorkbookVersionReviewRecord,
  right: WorkbookVersionReviewRecord,
): number {
  if (left.updatedAt > right.updatedAt) return -1;
  if (left.updatedAt < right.updatedAt) return 1;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

function reviewSummary(record: WorkbookVersionReviewRecord): WorkbookVersionReviewRecordSummary {
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

function validateDecisionDraft(
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
  return { ok: true };
}

function validateStatusTransition(
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

function parseReviewListCursor(cursor: PageCursor | undefined):
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

function reviewListCursor(offset: number): PageCursor {
  return `${REVIEW_LIST_CURSOR_PREFIX}${offset}` as PageCursor;
}

function ok<T>(value: T): VersionResult<T> {
  return { ok: true, value };
}

function notFound<T>(reviewId: string): VersionResult<T> {
  return {
    ok: false,
    error: {
      code: 'not_found',
      target: 'workbook.version.review',
      reason: `Review record ${reviewId} was not found.`,
    },
  };
}

function staleRevision<T>(expectedRevision: number, actualRevision: number): VersionResult<T> {
  return {
    ok: false,
    error: { code: 'stale_revision', expectedRevision, actualRevision },
  };
}

function invalidClientRequestReuse<T>(): VersionResult<T> {
  return invalidState(
    'review_client_request_reused',
    ['idempotent_retry'],
    'clientRequestId is already bound to a different review mutation payload.',
  );
}

function invalidState<T>(
  state: string,
  allowed: readonly string[],
  reason: string,
): VersionResult<T> {
  return { ok: false, error: { code: 'invalid_state', state, allowed, reason } };
}

function diagnostic(
  code: string,
  severity: VersionDiagnostic['severity'],
  message: string,
): VersionDiagnostic {
  return { code, severity, message };
}

function isWorkbookVersionReviewRecordStoreRow(
  value: unknown,
): value is WorkbookVersionReviewRecordStoreRow {
  if (!isRecord(value) || value.schemaVersion !== 1) return false;
  if (value.operation !== 'workbook-version-review-record') return false;
  if (typeof value.documentScopeKey !== 'string') return false;
  if (typeof value.createClientRequestId !== 'string') return false;
  if (!isWorkbookVersionReviewRecord(value.record)) return false;
  return Array.isArray(value.mutationLog) && value.mutationLog.every(isMutationLogEntry);
}

function isMutationLogEntry(value: unknown): value is WorkbookVersionReviewMutationLogEntry {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    (value.operation === 'createReview' ||
      value.operation === 'appendReviewDecision' ||
      value.operation === 'updateReviewStatus') &&
    typeof value.clientRequestId === 'string' &&
    typeof value.fingerprint === 'string' &&
    isWorkbookVersionReviewRecord(value.resultRecord) &&
    typeof value.recordedAt === 'string'
  );
}

function isWorkbookVersionReviewRecord(value: unknown): value is WorkbookVersionReviewRecord {
  if (!isRecord(value) || value.schemaVersion !== 1) return false;
  if (typeof value.id !== 'string' || !REVIEW_ID_RE.test(value.id)) return false;
  if (typeof value.documentId !== 'string') return false;
  if (!isReviewSubject(value.subject)) return false;
  if (!isReviewStatus(value.status)) return false;
  if (typeof value.revision !== 'number' || !Number.isInteger(value.revision) || value.revision < 1)
    return false;
  if (!isRecord(value.createdBy)) return false;
  if (typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') return false;
  if (!Array.isArray(value.decisions) || !value.decisions.every(isReviewDecision)) return false;
  return isRecord(value.redaction) && Array.isArray(value.diagnostics);
}

function isReviewSubject(value: unknown): value is WorkbookVersionReviewSubject {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;
  switch (value.kind) {
    case 'commit':
      return typeof value.commitId === 'string';
    case 'commitRange':
      return typeof value.baseCommitId === 'string' && typeof value.headCommitId === 'string';
    case 'proposal':
      return (
        typeof value.proposalId === 'string' &&
        typeof value.baseCommitId === 'string' &&
        typeof value.headCommitId === 'string'
      );
    case 'merge':
      return typeof value.mergePreviewId === 'string';
    case 'conflict':
      return typeof value.mergePreviewId === 'string' && typeof value.conflictId === 'string';
    default:
      return false;
  }
}

function isReviewStatus(value: unknown): value is WorkbookVersionReviewStatus {
  return (
    value === 'open' ||
    value === 'approved' ||
    value === 'changes_requested' ||
    value === 'rejected' ||
    value === 'applied' ||
    value === 'superseded' ||
    value === 'stale'
  );
}

function isReviewDecision(value: unknown): value is WorkbookVersionReviewDecision {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    REVIEW_DECISION_ID_RE.test(value.id) &&
    isRecord(value.target) &&
    typeof value.decision === 'string' &&
    isRecord(value.reviewer) &&
    typeof value.createdAt === 'string'
  );
}

function cloneRow(row: WorkbookVersionReviewRecordStoreRow): WorkbookVersionReviewRecordStoreRow;
function cloneRow(row: undefined): undefined;
function cloneRow(
  row: WorkbookVersionReviewRecordStoreRow | undefined,
): WorkbookVersionReviewRecordStoreRow | undefined;
function cloneRow(
  row: WorkbookVersionReviewRecordStoreRow | undefined,
): WorkbookVersionReviewRecordStoreRow | undefined {
  return row === undefined ? undefined : cloneJson(row);
}

function cloneRecord(record: WorkbookVersionReviewRecord): WorkbookVersionReviewRecord {
  return cloneJson(record);
}

function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonical JSON number must be finite');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJsonStringify).join(',')}]`;
  if (!isRecord(value)) throw new Error('value must be canonical JSON');
  return `{${Object.keys(value)
    .sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJsonStringify(value[key])}`)
    .join(',')}}`;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
