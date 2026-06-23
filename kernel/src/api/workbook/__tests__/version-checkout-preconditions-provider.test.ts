import { beforeEach, describe } from '@jest/globals';

import { registerVersionCheckoutProviderHistoryGapScenario } from './version-checkout-preconditions-provider-history-gap-scenario';
import { registerVersionCheckoutProviderPendingWritesScenario } from './version-checkout-preconditions-provider-pending-writes-scenario';
import { registerVersionCheckoutProviderRollbackDiagnosticsScenario } from './version-checkout-preconditions-provider-rollback-diagnostics-scenario';
import { resetCheckoutPreconditionMocks } from './version-checkout-preconditions-test-utils';

describe('WorkbookVersion checkout provider preconditions', () => {
  beforeEach(() => {
    resetCheckoutPreconditionMocks();
  });

  registerVersionCheckoutProviderPendingWritesScenario();
  registerVersionCheckoutProviderHistoryGapScenario();
  registerVersionCheckoutProviderRollbackDiagnosticsScenario();
});
