import { registerCheckoutServiceTargetRefScenarios } from './checkout-service-targets-ref-scenarios';
import { registerCheckoutServiceTargetResolutionScenarios } from './checkout-service-targets-resolution-scenarios';
import { registerCheckoutServiceTargetValidationScenarios } from './checkout-service-targets-validation-scenarios';

describe('CheckoutMaterializationService planning', () => {
  registerCheckoutServiceTargetResolutionScenarios();
  registerCheckoutServiceTargetValidationScenarios();
  registerCheckoutServiceTargetRefScenarios();
});
