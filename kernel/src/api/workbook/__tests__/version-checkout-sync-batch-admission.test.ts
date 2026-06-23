import { beforeEach, describe } from '@jest/globals';

import { registerPendingSyncBatchAdmissionScenarios } from './version-checkout-sync-batch-admission-pending-scenarios';
import { resetCheckoutSyncBatchAdmissionMocks } from './version-checkout-sync-batch-admission-test-utils';
import { registerTerminalSyncBatchAdmissionScenarios } from './version-checkout-sync-batch-admission-terminal-scenarios';

describe('WorkbookVersion checkout sync batch admission', () => {
  beforeEach(() => {
    resetCheckoutSyncBatchAdmissionMocks();
  });

  registerPendingSyncBatchAdmissionScenarios();
  registerTerminalSyncBatchAdmissionScenarios();
});
