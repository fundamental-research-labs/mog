import { describe } from '@jest/globals';

import { registerCleanMergePreviewScenario } from './version-apply-merge-core-preview-scenario';
import { registerCleanMergeApplyScenario } from './version-apply-merge-core-apply-scenario';
import { registerUnsupportedDomainMergeScenario } from './version-apply-merge-core-materializer-boundary-scenario';

describe('WorkbookVersion applyMerge preview planner', () => {
  registerCleanMergePreviewScenario();
  registerCleanMergeApplyScenario();
  registerUnsupportedDomainMergeScenario();
});
