import type {
  Paged,
  VersionAppendReviewDecisionInput,
  VersionCreateReviewInput,
  VersionGetReviewInput,
  VersionListReviewsInput,
  VersionResult,
  VersionUpdateReviewStatusInput,
  WorkbookVersionReviewRecord,
  WorkbookVersionReviewRecordSummary,
} from '@mog-sdk/contracts/api';

import {
  normalizeVersionDocumentScope,
  versionDocumentScopeKey,
  type VersionDocumentScope,
} from './registry';
import {
  reviewRecordWithoutApproval,
  validateApprovalEvidenceForStatusMutation,
} from './review-approval';
import { cloneJson, cloneRecord } from './review-service-codec';
import {
  DEFAULT_REVIEW_LIST_LIMIT,
  appendMutationLog,
  clientRequestIdWasUsed,
  compareReviewsForList,
  createReviewFingerprint,
  createReviewRecord,
  diagnostic,
  idempotencyResult,
  invalidClientRequestReuse,
  invalidState,
  isActiveReview,
  materializeDecision,
  mutationFingerprint,
  notFound,
  ok,
  parseReviewListCursor,
  reviewIdForCreate,
  reviewListCursor,
  reviewMatchesListInput,
  reviewSubjectsEqual,
  reviewSummary,
  staleRevision,
  validateApprovalEvidenceTargets,
  validateDecisionDraft,
  validateStatusTransition,
  type WorkbookVersionReviewRecordStoreRow,
} from './review-service-record-store-helpers';
import type {
  WorkbookVersionReviewRecordStore,
  WorkbookVersionReviewRecordStoreAdapter,
  WorkbookVersionReviewStatusUpdateOptions,
} from './review-service-record-store-types';

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
      const approvalTargetSupport = validateApprovalEvidenceTargets(options.approvalEvidence);
      if (!approvalTargetSupport.ok) {
        return { action: 'none', result: approvalTargetSupport.result };
      }

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
