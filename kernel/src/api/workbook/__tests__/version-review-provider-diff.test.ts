import { registerReviewProviderDiffCompletenessScenarios } from './version-review-provider-diff-completeness-scenarios';
import { registerReviewProviderDiffPaginationScenarios } from './version-review-provider-diff-pagination-scenarios';

describe('WorkbookVersion provider-backed review diffs', () => {
  registerReviewProviderDiffPaginationScenarios();
  registerReviewProviderDiffCompletenessScenarios();
});
