import { registerCapabilityOperationScenarios } from './domain-support-manifest-validator-capabilities-operation-scenarios';
import { registerCapabilityStateMapScenarios } from './domain-support-manifest-validator-capabilities-state-map-scenarios';

describe('validateDomainSupportManifest capability states', () => {
  registerCapabilityStateMapScenarios();
  registerCapabilityOperationScenarios();
});
