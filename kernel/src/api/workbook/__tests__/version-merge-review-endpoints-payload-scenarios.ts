import { registerMergeReviewEndpointPayloadMissingRefScenario } from './version-merge-review-endpoints-payload-missing-ref-scenario';
import { registerMergeReviewEndpointPayloadPutScenario } from './version-merge-review-endpoints-payload-put-scenario';
import { registerMergeReviewEndpointPayloadSaveRefScenario } from './version-merge-review-endpoints-payload-save-ref-scenario';

export function registerMergeReviewEndpointPayloadScenarios(): void {
  registerMergeReviewEndpointPayloadPutScenario();
  registerMergeReviewEndpointPayloadSaveRefScenario();
  registerMergeReviewEndpointPayloadMissingRefScenario();
}
