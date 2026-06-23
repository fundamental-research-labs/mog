import { registerSavedResolutionPayloadMalformedRefReviewTests } from './version-merge-review-saved-resolution-payload-malformed-ref-scenario';
import { registerSavedResolutionPayloadMissingTargetReviewTests } from './version-merge-review-saved-resolution-payload-missing-target-scenario';
import { registerSavedResolutionPayloadStaleRefReviewTests } from './version-merge-review-saved-resolution-payload-stale-ref-scenario';

export function registerSavedResolutionPayloadReviewTests(): void {
  registerSavedResolutionPayloadStaleRefReviewTests();
  registerSavedResolutionPayloadMissingTargetReviewTests();
  registerSavedResolutionPayloadMalformedRefReviewTests();
}
