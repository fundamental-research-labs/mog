import { installProviderLifecycleDocumentFactoryHooks } from './version-checkout-provider-lifecycle-test-utils';
import { registerProviderCheckoutStaleRefHeadScenario } from './version-checkout-provider-lifecycle-stale-ref-head-scenario';
import { registerProviderCheckoutStaleRegistryScenario } from './version-checkout-provider-lifecycle-stale-registry-scenario';

installProviderLifecycleDocumentFactoryHooks();

describe('WorkbookVersion provider-backed checkout stale lifecycle guards', () => {
  registerProviderCheckoutStaleRefHeadScenario();
  registerProviderCheckoutStaleRegistryScenario();
});
