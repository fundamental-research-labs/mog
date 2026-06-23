import { beforeEach, describe } from '@jest/globals';

import { registerVersionCheckoutAdmissionDenialScenario } from './version-checkout-preconditions-admission-denial-scenario';
import { registerVersionCheckoutDirtyWorkingStateScenario } from './version-checkout-preconditions-dirty-working-state-scenario';
import { registerVersionCheckoutMissingTargetScenario } from './version-checkout-preconditions-missing-target-scenario';
import { registerVersionCheckoutStalePreflightTokenScenario } from './version-checkout-preconditions-stale-preflight-token-scenario';
import { resetCheckoutPreconditionMocks } from './version-checkout-preconditions-test-utils';

describe('WorkbookVersion checkout local preconditions', () => {
  beforeEach(() => {
    resetCheckoutPreconditionMocks();
  });

  registerVersionCheckoutDirtyWorkingStateScenario();
  registerVersionCheckoutAdmissionDenialScenario();
  registerVersionCheckoutStalePreflightTokenScenario();
  registerVersionCheckoutMissingTargetScenario();
});
