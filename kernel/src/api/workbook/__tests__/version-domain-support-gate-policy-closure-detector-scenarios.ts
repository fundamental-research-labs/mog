import { registerPolicyClosureDetectorCapabilityStateScenarios } from './version-domain-support-gate-policy-closure-detector-capability-state-scenarios';
import { registerPolicyClosureDetectorReadFailureScenarios } from './version-domain-support-gate-policy-closure-detector-read-failure-scenarios';
import { registerPolicyClosureDetectorRequiredRowsScenarios } from './version-domain-support-gate-policy-closure-detector-required-rows-scenarios';
import { registerPolicyClosureDetectorUnavailableScenarios } from './version-domain-support-gate-policy-closure-detector-unavailable-scenarios';

export function registerPolicyClosureDetectorScenarios(): void {
  registerPolicyClosureDetectorRequiredRowsScenarios();
  registerPolicyClosureDetectorCapabilityStateScenarios();
  registerPolicyClosureDetectorUnavailableScenarios();
  registerPolicyClosureDetectorReadFailureScenarios();
}
