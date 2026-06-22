import type {
  Paged,
  VersionAppendReviewDecisionInput,
  VersionCreateReviewInput,
  VersionDiagnostic,
  VersionGetReviewDiffInput,
  VersionGetReviewInput,
  VersionListReviewsInput,
  VersionResult,
  WorkbookVersionReviewDiffPage,
  WorkbookVersionReviewRecord,
  WorkbookVersionReviewRecordSummary,
  VersionUpdateReviewStatusInput,
} from '@mog-sdk/contracts/api';

import { buildWorkbookVersionReviewApprovalEvidence } from './review-approval';
import type { WorkbookVersionReviewDiffService } from './review-diff-service';
import type {
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

  async listReviews(input: VersionListReviewsInput): Promise<VersionResult<Paged<WorkbookVersionReviewRecordSummary>>> {
    return (await this.openStore()).listReviews(input);
  }

  async getReview(input: VersionGetReviewInput): Promise<VersionResult<WorkbookVersionReviewRecord>> {
    return (await this.openStore()).getReview(input);
  }

  async createReview(input: VersionCreateReviewInput): Promise<VersionResult<WorkbookVersionReviewRecord>> {
    return (await this.openStore()).createReview(input);
  }

  async appendReviewDecision(input: VersionAppendReviewDecisionInput): Promise<VersionResult<WorkbookVersionReviewRecord>> {
    return (await this.openStore()).appendReviewDecision(input);
  }

  async updateReviewStatus(input: VersionUpdateReviewStatusInput): Promise<VersionResult<WorkbookVersionReviewRecord>> {
    const store = await this.openStore();
    if (input.status !== 'approved') return store.updateReviewStatus(input);

    const idempotentOrBlocked = await store.updateReviewStatus(input);
    if (idempotentOrBlocked.ok) return idempotentOrBlocked;
    if (
      idempotentOrBlocked.error.code !== 'invalid_state' ||
      idempotentOrBlocked.error.state !== 'approval_requires_review_diff'
    ) {
      return idempotentOrBlocked;
    }

    const review = await store.getReview({ reviewId: input.reviewId });
    if (!review.ok) return review;
    const updatedAt = new Date().toISOString();
    const approvalEvidence = await buildWorkbookVersionReviewApprovalEvidence({
      review: review.value,
      actor: input.actor,
      approvedAt: updatedAt,
      reviewRevision: review.value.revision + 1,
      diffService: this.diffService,
    });
    if (!approvalEvidence.ok) return approvalEvidence;
    return store.updateReviewStatus(input, {
      approvalEvidence: approvalEvidence.value,
      updatedAt,
    });
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
    if (!input.reviewId) return this.diffService.getReviewDiff(input);
    const resolved = await this.reviewDiffInputForReview(input);
    if (!resolved.ok) return resolved;
    return this.diffService.getReviewDiff(resolved.value);
  }

  private async reviewDiffInputForReview(
    input: VersionGetReviewDiffInput,
  ): Promise<VersionResult<VersionGetReviewDiffInput>> {
    if (!input.reviewId) return ok(input);
    const review = await (await this.openStore()).getReview({ reviewId: input.reviewId });
    if (!review.ok) return review as VersionResult<VersionGetReviewDiffInput>;
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

function targetUnavailable<T>(
  operation: string,
  code: string,
  message: string,
): VersionResult<T> {
  return {
    ok: false,
    error: {
      code: 'target_unavailable',
      target: `workbook.version.${operation}`,
      diagnostics: [diagnostic(code, 'warning', message)],
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
