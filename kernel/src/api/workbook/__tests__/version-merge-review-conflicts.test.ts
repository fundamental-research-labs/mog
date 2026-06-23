import { registerMergeReviewConflictNormalizationScenarios } from './version-merge-review-conflicts-normalization-scenarios';
import { registerMergeReviewConflictPayloadValidationScenarios } from './version-merge-review-conflicts-payload-validation-scenarios';
import { registerMergeReviewConflictRedactionScenarios } from './version-merge-review-conflicts-redaction-scenarios';

describe('WorkbookVersion merge review conflict normalization', () => {
  registerMergeReviewConflictNormalizationScenarios();
  registerMergeReviewConflictPayloadValidationScenarios();
  registerMergeReviewConflictRedactionScenarios();
});
