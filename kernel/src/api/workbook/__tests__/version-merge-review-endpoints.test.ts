import { registerMergeReviewEndpointDetailScenarios } from './version-merge-review-endpoints-detail-scenarios';
import { registerMergeReviewEndpointFailureScenarios } from './version-merge-review-endpoints-failure-scenarios';
import { registerMergeReviewEndpointPayloadScenarios } from './version-merge-review-endpoints-payload-scenarios';
import { registerMergeReviewEndpointResolutionScenarios } from './version-merge-review-endpoints-resolution-scenarios';

describe('WorkbookVersion merge review endpoints', () => {
  registerMergeReviewEndpointDetailScenarios();
  registerMergeReviewEndpointResolutionScenarios();
  registerMergeReviewEndpointPayloadScenarios();
  registerMergeReviewEndpointFailureScenarios();
});
