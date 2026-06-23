import { installProviderLifecycleDocumentFactoryHooks } from './version-checkout-provider-lifecycle-test-utils';
import { registerProviderIdentityRebindScenarios } from './version-checkout-provider-lifecycle-identity-provider-rebind-scenarios';
import { registerProviderIdentityReopenScenarios } from './version-checkout-provider-lifecycle-identity-reopen-scenarios';

installProviderLifecycleDocumentFactoryHooks();

describe('WorkbookVersion provider-backed checkout provider identity lifecycle guards', () => {
  registerProviderIdentityRebindScenarios();
  registerProviderIdentityReopenScenarios();
});
