import type {
  Paged,
  VersionAppendReviewDecisionInput,
  VersionCreateReviewInput,
  VersionGetReviewDiffInput,
  VersionGetReviewInput,
  VersionListReviewsInput,
  VersionResult,
  VersionUpdateReviewStatusInput,
  WorkbookVersionReviewApprovalEvidence,
  WorkbookVersionReviewDiffPage,
  WorkbookVersionReviewRecord,
  WorkbookVersionReviewRecordSummary,
} from '@mog-sdk/contracts/api';

import type { VersionDocumentScope } from './registry';
import type {
  ReviewRecordRowMutation,
  WorkbookVersionReviewRecordStoreRow,
} from './review-service-record-store-helpers';

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
