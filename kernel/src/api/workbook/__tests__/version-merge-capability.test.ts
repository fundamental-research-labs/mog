import { registerMergeCapabilityPublicScenarios } from './version-merge-capability-public-scenarios';
import { registerMergeCapabilityReviewEndpointScenarios } from './version-merge-capability-review-scenarios';
import { registerMergeCapabilityServiceScenarios } from './version-merge-capability-service-scenarios';

describe('WorkbookVersion merge capability gate', () => {
  registerMergeCapabilityServiceScenarios();
  registerMergeCapabilityPublicScenarios();
  registerMergeCapabilityReviewEndpointScenarios();
});
