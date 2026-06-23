import { describe } from '@jest/globals';

import { registerRevertInvalidTargetScenarios } from './version-revert-invalid-target-scenarios';
import { registerRevertStaleTargetRefScenarios } from './version-revert-stale-target-ref-scenarios';
import { registerRevertTargetSemanticsScenarios } from './version-revert-target-semantics-scenarios';

describe('WorkbookVersion VC-07/00 revert semantics', () => {
  registerRevertTargetSemanticsScenarios();
  registerRevertInvalidTargetScenarios();
  registerRevertStaleTargetRefScenarios();
});
