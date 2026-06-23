import 'fake-indexeddb/auto';

import { registerReviewProviderAccessMergeConflictDetailScenarios } from './version-review-provider-access-merge-conflict-detail-scenarios';
import { registerReviewProviderAccessMergeResolutionScenarios } from './version-review-provider-access-merge-resolution-scenarios';

describe('WorkbookVersion provider review access merge hardening', () => {
  registerReviewProviderAccessMergeConflictDetailScenarios();
  registerReviewProviderAccessMergeResolutionScenarios();
});
