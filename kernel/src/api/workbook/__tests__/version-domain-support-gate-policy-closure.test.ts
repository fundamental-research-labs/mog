import { registerPolicyClosureDetectorScenarios } from './version-domain-support-gate-policy-closure-detector-scenarios';
import {
  registerPolicyClosureManifestSourceScenarios,
  registerPolicyClosureOperationOverrideScenarios,
} from './version-domain-support-gate-policy-closure-operation-scenarios';
import { registerPolicyClosurePublicDiagnosticsScenarios } from './version-domain-support-gate-policy-closure-public-diagnostics-scenarios';
import { registerPolicyClosureRegistryScenarios } from './version-domain-support-gate-policy-closure-registry-scenarios';

describe('WorkbookVersion domain support policy gate closure', () => {
  registerPolicyClosureManifestSourceScenarios();
  registerPolicyClosureDetectorScenarios();
  registerPolicyClosureOperationOverrideScenarios();
  registerPolicyClosureRegistryScenarios();
  registerPolicyClosurePublicDiagnosticsScenarios();
});
