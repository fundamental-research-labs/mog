import { describeMergeBaseApplyScenarios } from './version-merge-base-gate-apply-scenarios';
import { describePublicMergeBaseGateScenarios } from './version-merge-base-gate-public-scenarios';
import { describeMergeBaseServiceScenarios } from './version-merge-base-gate-service-scenarios';

describe('WorkbookVersion VC-07 merge-base gate', () => {
  describePublicMergeBaseGateScenarios();
  describeMergeBaseServiceScenarios();
  describeMergeBaseApplyScenarios();
});
