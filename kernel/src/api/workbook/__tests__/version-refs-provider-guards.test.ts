import { registerProviderRefConflictGuardScenarios } from './version-refs-provider-guards-conflict-scenarios';
import { registerProtectedRefProviderGuardScenarios } from './version-refs-provider-guards-protected-scenarios';
import { registerProviderRefTombstoneGuardScenarios } from './version-refs-provider-guards-tombstone-scenarios';
import { resetWorkbookProviderTestMocks } from './version-refs-provider-test-utils';

describe('WorkbookVersion provider-backed ref guard scenarios', () => {
  beforeEach(() => {
    resetWorkbookProviderTestMocks();
  });

  registerProtectedRefProviderGuardScenarios();
  registerProviderRefConflictGuardScenarios();
  registerProviderRefTombstoneGuardScenarios();
});
