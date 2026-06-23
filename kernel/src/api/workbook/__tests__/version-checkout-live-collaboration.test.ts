import { jest } from '@jest/globals';

import { registerLiveCollaborationBlockingAdmissionScenarios } from './version-checkout-live-collaboration-blocking-admission-scenarios';
import { registerLiveCollaborationSafeAdmissionScenarios } from './version-checkout-live-collaboration-safe-admission-scenarios';

describe('WorkbookVersion checkout live collaboration admission', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  registerLiveCollaborationBlockingAdmissionScenarios();
  registerLiveCollaborationSafeAdmissionScenarios();
});
