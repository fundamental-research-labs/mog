import { describe } from '@jest/globals';

import { registerVersionCheckoutInvalidRootAtomicityScenario } from './version-checkout-atomicity-invalid-root';
import { registerVersionCheckoutMaterializerFailureAtomicityScenario } from './version-checkout-atomicity-materializer-failure';
import { registerVersionCheckoutPublishFailureAtomicityScenario } from './version-checkout-atomicity-publish-failure';

describe('WorkbookVersion checkout atomicity', () => {
  registerVersionCheckoutMaterializerFailureAtomicityScenario();
  registerVersionCheckoutInvalidRootAtomicityScenario();
  registerVersionCheckoutPublishFailureAtomicityScenario();
});
