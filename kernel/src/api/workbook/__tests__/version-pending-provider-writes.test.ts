import { describe } from '@jest/globals';

import { registerPendingProviderWritesActivityScenarios } from './version-pending-provider-writes-activity-scenarios';
import { registerPendingProviderWritesCheckoutScenarios } from './version-pending-provider-writes-checkout-scenarios';
import { registerPendingProviderWritesPersistedScenarios } from './version-pending-provider-writes-persisted-scenarios';

describe('version pending provider writes status', () => {
  registerPendingProviderWritesActivityScenarios();
  registerPendingProviderWritesPersistedScenarios();
  registerPendingProviderWritesCheckoutScenarios();
});
