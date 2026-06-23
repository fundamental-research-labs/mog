import type {
  Paged,
  VersionAppendReviewDecisionInput,
  VersionCreateReviewInput,
  VersionDiagnostic,
  VersionError,
  VersionGetReviewDiffInput,
  VersionGetReviewInput,
  VersionListReviewsInput,
  VersionResult,
  WorkbookVersionReviewDiffPage,
  WorkbookVersionReviewRecord,
  WorkbookVersionReviewRecordSummary,
  VersionUpdateReviewStatusInput,
} from '@mog-sdk/contracts/api';

import {
  projectReviewAccessDiffPage,
  projectReviewAccessRecord,
  projectReviewAccessRecordSummary,
  sanitizeReviewAccessDiagnostics,
} from './review-access-projection';
import { buildWorkbookVersionReviewApprovalEvidence } from './review-approval';
import type { WorkbookVersionReviewDiffService } from './review-diff-service';
import type {
  WorkbookVersionMarkReviewAppliedInput,
  WorkbookVersionReviewRecordStore,
  WorkbookVersionReviewRecordStoreProvider,
  WorkbookVersionReviewService,
} from './review-service';

export class ProviderBackedWorkbookVersionReviewService implements WorkbookVersionReviewService {
  private readonly openStore: () => Promise<WorkbookVersionReviewRecordStore>;
  private readonly diffService?: WorkbookVersionReviewDiffService;

  constructor(options: {
    readonly openStore: () => Promise<WorkbookVersionReviewRecordStore>;
    readonly diffService?: WorkbookVersionReviewDiffService;
  }) {
    this.openStore = options.openStore;
    this.diffService = options.diffService;
  }

  async listReviews(
    input: VersionListReviewsInput,
  ): Promise<VersionResult<Paged<WorkbookVersionReviewRecordSummary>>> {
    const result = await (await this.openStore()).listReviews(input);
    if (!result.ok) return sanitizeReviewAccessError(result);
    return ok({
      ...result.value,
      items: result.value.items.map(projectReviewAccessRecordSummary),
    });
  }

  async getReview(
    input: VersionGetReviewInput,
  ): Promise<VersionResult<WorkbookVersionReviewRecord>> {
    return projectReviewRecordResult(await (await this.openStore()).getReview(input));
  }

  async createReview(
    input: VersionCreateReviewInput,
  ): Promise<VersionResult<WorkbookVersionReviewRecord>> {
    return projectReviewRecordResult(await (await this.openStore()).createReview(input));
  }

  async appendReviewDecision(
    input: VersionAppendReviewDecisionInput,
  ): Promise<VersionResult<WorkbookVersionReviewRecord>> {
    return projectReviewRecordResult(await (await this.openStore()).appendReviewDecision(input));
  }

  async updateReviewStatus(
    input: VersionUpdateReviewStatusInput,
  ): Promise<VersionResult<WorkbookVersionReviewRecord>> {
    const store = await this.openStore();
    if (input.status !== 'approved') {
      return projectReviewRecordResult(await store.updateReviewStatus(input));
    }

    const idempotentOrBlocked = await store.updateReviewStatus(input);
    if (idempotentOrBlocked.ok) return ok(projectReviewAccessRecord(idempotentOrBlocked.value));
    if (
      idempotentOrBlocked.error.code !== 'invalid_state' ||
      idempotentOrBlocked.error.state !== 'approval_requires_review_diff'
    ) {
      return sanitizeReviewAccessError(idempotentOrBlocked);
    }

    const review = await store.getReview({ reviewId: input.reviewId });
    if (!review.ok) return sanitizeReviewAccessError(review);
    const updatedAt = new Date().toISOString();
    const approvalEvidence = await buildWorkbookVersionReviewApprovalEvidence({
      review: review.value,
      actor: input.actor,
      approvedAt: updatedAt,
      reviewRevision: review.value.revision + 1,
      ...(this.diffService
        ? {
            diffService: {
              getReviewDiff: (diffInput: VersionGetReviewDiffInput) =>
                this.getProjectedReviewDiff(diffInput),
            },
          }
        : {}),
    });
    if (!approvalEvidence.ok) return sanitizeReviewAccessError(approvalEvidence);
    return projectReviewRecordResult(
      await store.updateReviewStatus(input, {
        approvalEvidence: approvalEvidence.value,
        updatedAt,
      }),
    );
  }

  async markReviewApplied(
    input: WorkbookVersionMarkReviewAppliedInput,
  ): Promise<VersionResult<WorkbookVersionReviewRecord>> {
    const store = await this.openStore();
    const review = await store.getReview({ reviewId: input.reviewId });
    if (!review.ok) return sanitizeReviewAccessError(review);
    if (review.value.status === 'applied') return ok(projectReviewAccessRecord(review.value));
    if (review.value.status !== 'approved') {
      return invalidState(
        'review_not_approved_for_apply',
        ['approved'],
        'Only approved reviews can be finalized as applied.',
      );
    }

    return store
      .updateReviewStatus(
        {
          reviewId: input.reviewId,
          expectedRevision: review.value.revision,
          clientRequestId: input.clientRequestId,
          status: 'applied',
          actor: input.actor,
          ...(input.reason ? { reason: input.reason } : {}),
        },
        { flowOwnedStatus: true, preserveApproval: true },
      )
      .then(projectReviewRecordResult);
  }

  async getReviewDiff(
    input: VersionGetReviewDiffInput,
  ): Promise<VersionResult<WorkbookVersionReviewDiffPage>> {
    if (!this.diffService) {
      return targetUnavailable(
        'getReviewDiff',
        'VERSION_REVIEW_DIFF_UNAVAILABLE',
        'Provider-backed review diff projection is not attached yet; review records remain persisted.',
      );
    }
    if (!input.reviewId) {
      return this.getProjectedReviewDiff(input);
    }
    const resolved = await this.reviewDiffInputForReview(input);
    if (!resolved.ok) return resolved;
    return this.getProjectedReviewDiff(resolved.value);
  }

  private async getProjectedReviewDiff(
    input: VersionGetReviewDiffInput,
  ): Promise<VersionResult<WorkbookVersionReviewDiffPage>> {
    if (!this.diffService) {
      return targetUnavailable(
        'getReviewDiff',
        'VERSION_REVIEW_DIFF_UNAVAILABLE',
        'Provider-backed review diff projection is not attached yet; review records remain persisted.',
      );
    }
    return projectReviewDiffResult(await this.diffService.getReviewDiff(input));
  }

  private async reviewDiffInputForReview(
    input: VersionGetReviewDiffInput,
  ): Promise<VersionResult<VersionGetReviewDiffInput>> {
    if (!input.reviewId) return ok(input);
    const review = await (await this.openStore()).getReview({ reviewId: input.reviewId });
    if (!review.ok) {
      return sanitizeReviewAccessError({ ok: false, error: review.error });
    }
    const baseCommitId = review.value.baseCommitId;
    const headCommitId = review.value.headCommitId;
    if (!baseCommitId || !headCommitId) {
      return invalidState(
        'review_diff_commit_range_unavailable',
        ['commit_range_review'],
        'Review record does not carry base/head commits for semantic diff projection.',
      );
    }
    if (input.baseCommitId && input.baseCommitId !== baseCommitId) {
      return invalidState(
        'review_diff_base_mismatch',
        ['matching_review_base_commit'],
        'baseCommitId must match the review record base commit.',
      );
    }
    if (input.headCommitId && input.headCommitId !== headCommitId) {
      return invalidState(
        'review_diff_head_mismatch',
        ['matching_review_head_commit'],
        'headCommitId must match the review record head commit.',
      );
    }
    return ok({ ...input, baseCommitId, headCommitId });
  }
}

export function createProviderBackedWorkbookVersionReviewService(options: {
  readonly provider: WorkbookVersionReviewRecordStoreProvider;
  readonly diffService?: WorkbookVersionReviewDiffService;
}): WorkbookVersionReviewService {
  return new ProviderBackedWorkbookVersionReviewService({
    openStore: () => options.provider.openWorkbookVersionReviewRecordStore(),
    ...(options.diffService ? { diffService: options.diffService } : {}),
  });
}

export function hasWorkbookVersionReviewRecordStoreProvider(
  value: unknown,
): value is WorkbookVersionReviewRecordStoreProvider {
  return isRecord(value) && typeof value.openWorkbookVersionReviewRecordStore === 'function';
}

function projectReviewRecordResult(
  result: VersionResult<WorkbookVersionReviewRecord>,
): VersionResult<WorkbookVersionReviewRecord> {
  if (!result.ok) return sanitizeReviewAccessError(result);
  return ok(projectReviewAccessRecord(result.value));
}

function projectReviewDiffResult(
  result: VersionResult<WorkbookVersionReviewDiffPage>,
): VersionResult<WorkbookVersionReviewDiffPage> {
  if (!result.ok) return sanitizeReviewAccessError(result);
  const projected = projectReviewAccessDiffPage(result.value);
  if (!projected.ok) {
    return targetUnavailableDiagnostics('getReviewDiff', projected.diagnostics);
  }
  return ok(projected.value);
}

function sanitizeReviewAccessError<T>(result: VersionResult<T>): VersionResult<T> {
  if (result.ok) return result;
  const error = result.error;
  if (error.code !== 'target_unavailable' || !Array.isArray(error.diagnostics)) return result;
  return {
    ok: false,
    error: {
      ...error,
      diagnostics: sanitizeReviewAccessDiagnostics(
        error.diagnostics as readonly VersionDiagnostic[],
      ),
    } as VersionError,
  };
}

function ok<T>(value: T): VersionResult<T> {
  return { ok: true, value };
}

function invalidState<T>(
  state: string,
  allowed: readonly string[],
  reason: string,
): VersionResult<T> {
  return { ok: false, error: { code: 'invalid_state', state, allowed, reason } };
}

function targetUnavailable<T>(operation: string, code: string, message: string): VersionResult<T> {
  return targetUnavailableDiagnostics(operation, [diagnostic(code, 'warning', message)]);
}

function targetUnavailableDiagnostics<T>(
  operation: string,
  diagnostics: readonly VersionDiagnostic[],
): VersionResult<T> {
  return {
    ok: false,
    error: {
      code: 'target_unavailable',
      target: `workbook.version.${operation}`,
      diagnostics,
    },
  };
}

function diagnostic(
  code: string,
  severity: VersionDiagnostic['severity'],
  message: string,
): VersionDiagnostic {
  return { code, severity, message };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
