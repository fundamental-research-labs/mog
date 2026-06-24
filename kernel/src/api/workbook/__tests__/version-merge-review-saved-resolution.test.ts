import { registerSavedResolutionBindingReviewTests } from './version-merge-review-saved-resolution-binding-scenarios';
import { registerSavedResolutionPayloadReviewTests } from './version-merge-review-saved-resolution-payload-scenarios';
import { registerSavedResolutionProvenanceReloadReviewTests } from './version-merge-review-saved-resolution-provenance-reload-scenarios';
import { registerSavedResolutionResolvedAttemptReviewTests } from './version-merge-review-saved-resolution-resolved-attempt-scenarios';

describe('WorkbookVersion saved merge resolution validation', () => {
  registerSavedResolutionResolvedAttemptReviewTests();
  registerSavedResolutionPayloadReviewTests();
  registerSavedResolutionBindingReviewTests();
  registerSavedResolutionProvenanceReloadReviewTests();
});
