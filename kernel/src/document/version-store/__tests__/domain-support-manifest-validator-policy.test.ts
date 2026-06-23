import { registerPolicyFieldScenarios } from './domain-support-manifest-validator-policy-field-scenarios';
import { registerPolicyOperationScenarios } from './domain-support-manifest-validator-policy-operation-scenarios';
import { registerPolicyRowIdentityScenarios } from './domain-support-manifest-validator-policy-row-identity-scenarios';

describe('validateDomainSupportManifest policy rows', () => {
  registerPolicyRowIdentityScenarios();
  registerPolicyFieldScenarios();
  registerPolicyOperationScenarios();
});
