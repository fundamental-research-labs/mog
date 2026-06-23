import { registerReviewProviderApprovalStatusScenario } from './version-review-provider-approval-scenarios-approval-status';
import { registerReviewProviderMarkResolvedScenario } from './version-review-provider-approval-scenarios-mark-resolved';
import { registerReviewProviderRequestChangeScenario } from './version-review-provider-approval-scenarios-request-change';

export function registerReviewProviderApprovalScenarios(): void {
  registerReviewProviderApprovalStatusScenario();
  registerReviewProviderRequestChangeScenario();
  registerReviewProviderMarkResolvedScenario();
}
