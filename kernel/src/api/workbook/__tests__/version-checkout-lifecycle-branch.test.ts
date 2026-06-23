import { describe } from '@jest/globals';

import { registerBranchCheckoutCustomCaptureScenario } from './version-checkout-lifecycle-branch-custom-capture-scenario';
import { registerBranchCheckoutEditAfterCheckoutScenario } from './version-checkout-lifecycle-branch-edit-after-checkout-scenario';
import { registerBranchCheckoutSessionStatusScenario } from './version-checkout-lifecycle-branch-status-scenario';

describe('WorkbookVersion checkout branch lifecycle', () => {
  registerBranchCheckoutSessionStatusScenario();
  registerBranchCheckoutEditAfterCheckoutScenario();
  registerBranchCheckoutCustomCaptureScenario();
});
