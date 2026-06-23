import { describe } from '@jest/globals';

import { registerCheckoutRebindCaptureResetScenario } from './version-checkout-rebind-capture-reset-scenario';
import { registerCheckoutRebindCurrentRefFallbackScenario } from './version-checkout-rebind-current-ref-fallback-scenario';
import { registerCheckoutRebindPriorRefScenarios } from './version-checkout-rebind-prior-ref-scenarios';
import { registerCheckoutRebindProviderIdentityScenarios } from './version-checkout-rebind-provider-identity-scenarios';

describe('version checkout rebind hardening', () => {
  registerCheckoutRebindCaptureResetScenario();
  registerCheckoutRebindPriorRefScenarios();
  registerCheckoutRebindProviderIdentityScenarios();
  registerCheckoutRebindCurrentRefFallbackScenario();
});
