import type {
  VersionGetReviewDiffInput,
  VersionResult,
  WorkbookVersionReviewDiffPage,
} from '@mog-sdk/contracts/api';

import { invalidStateResult } from './version-review-results';

export function validateReviewDiffTarget(
  input: VersionGetReviewDiffInput,
):
  | { readonly ok: true }
  | { readonly ok: false; readonly result: VersionResult<WorkbookVersionReviewDiffPage> } {
  if (input.reviewId || (input.baseCommitId && input.headCommitId)) return { ok: true };
  return {
    ok: false,
    result: invalidStateResult(
      'getReviewDiff',
      'missing_review_diff_target',
      'getReviewDiff requires reviewId or both baseCommitId and headCommitId.',
    ),
  };
}
