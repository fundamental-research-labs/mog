import { registerProviderRefLifecycleFacadeScenarios } from './version-refs-provider-lifecycle-facade-scenarios';
import { resetWorkbookProviderTestMocks } from './version-refs-provider-test-utils';

describe('WorkbookVersion provider-backed ref lifecycle facade', () => {
  beforeEach(() => {
    resetWorkbookProviderTestMocks();
  });

  registerProviderRefLifecycleFacadeScenarios();
});
