import { registerProviderW8CasDeleteGuardScenarios } from './version-refs-provider-w8-cas-delete-guard-scenarios';
import { registerProviderW8CasRaceScenarios } from './version-refs-provider-w8-cas-race-scenarios';
import { registerProviderW8CasTombstoneReloadScenarios } from './version-refs-provider-w8-cas-tombstone-reload-scenarios';
import { resetWorkbookProviderTestMocks } from './version-refs-provider-w8-test-utils';

describe('WorkbookVersion provider-backed ref lifecycle W8 CAS and tombstones', () => {
  beforeEach(() => {
    resetWorkbookProviderTestMocks();
  });

  registerProviderW8CasRaceScenarios();
  registerProviderW8CasTombstoneReloadScenarios();
  registerProviderW8CasDeleteGuardScenarios();
});
