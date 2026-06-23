import {
  registerDetectorPolicyRowAcceptanceScenarios,
  registerDetectorPolicyRowMissingScenarios,
} from './domain-support-manifest-validator-detectors-policy-row-scenarios';
import { registerDetectorPublicMutableScenarios } from './domain-support-manifest-validator-detectors-public-mutable-scenarios';

describe('validateDomainSupportManifest detector rows', () => {
  registerDetectorPolicyRowMissingScenarios();
  registerDetectorPublicMutableScenarios();
  registerDetectorPolicyRowAcceptanceScenarios();
});
