import { describe } from '@jest/globals';

import { registerDomainSupportCapabilityPolicyCheckoutScenarios } from './version-domain-support-gate-capability-policy-checkout-scenarios';
import { registerDomainSupportCapabilityPolicyCommitScenarios } from './version-domain-support-gate-capability-policy-commit-scenarios';
import { registerDomainSupportCapabilityPolicyMatrixRowScenarios } from './version-domain-support-gate-capability-policy-matrix-row-scenarios';
import { registerDomainSupportCapabilityPolicyOptionsScenarios } from './version-domain-support-gate-capability-policy-options-scenarios';

describe('WorkbookVersion domain support manifest gate capability policy', () => {
  registerDomainSupportCapabilityPolicyOptionsScenarios();
  registerDomainSupportCapabilityPolicyCommitScenarios();
  registerDomainSupportCapabilityPolicyMatrixRowScenarios();
  registerDomainSupportCapabilityPolicyCheckoutScenarios();
});
