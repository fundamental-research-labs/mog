import type {
  Paged,
  VersionAppendReviewDecisionInput,
  VersionCreateReviewInput,
  VersionGetReviewDiffInput,
  VersionGetReviewInput,
  VersionListReviewsInput,
  VersionResult,
  WorkbookVersionReviewDiffPage,
  WorkbookVersionReviewRecord,
  WorkbookVersionReviewRecordSummary,
  VersionUpdateReviewStatusInput,
} from '@mog-sdk/contracts/api';

export interface WorkbookVersionReviewService {
  listReviews(
    input: VersionListReviewsInput,
  ): Promise<VersionResult<Paged<WorkbookVersionReviewRecordSummary>>>;
  getReview(input: VersionGetReviewInput): Promise<VersionResult<WorkbookVersionReviewRecord>>;
  createReview(input: VersionCreateReviewInput): Promise<VersionResult<WorkbookVersionReviewRecord>>;
  appendReviewDecision(
    input: VersionAppendReviewDecisionInput,
  ): Promise<VersionResult<WorkbookVersionReviewRecord>>;
  updateReviewStatus(
    input: VersionUpdateReviewStatusInput,
  ): Promise<VersionResult<WorkbookVersionReviewRecord>>;
  getReviewDiff(input: VersionGetReviewDiffInput): Promise<VersionResult<WorkbookVersionReviewDiffPage>>;
}
