import { registerReviewProviderAccessServiceGetReviewDiffScenarios } from './version-review-provider-access-service-get-review-diff-scenarios';
import { registerReviewProviderAccessServiceGetReviewScenarios } from './version-review-provider-access-service-get-review-scenarios';

export function registerReviewProviderAccessServiceScenarios(): void {
  registerReviewProviderAccessServiceGetReviewScenarios();
  registerReviewProviderAccessServiceGetReviewDiffScenarios();
}
