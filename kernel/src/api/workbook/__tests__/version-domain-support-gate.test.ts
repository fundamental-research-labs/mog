import { registerDomainSupportGateMissingManifestScenarios } from './version-domain-support-gate-missing-manifest-scenarios';
import { registerDomainSupportGateManifestValidationScenarios } from './version-domain-support-gate-manifest-validation-scenarios';
import { registerDomainSupportGateRequiredSourceScenarios } from './version-domain-support-gate-required-source-scenarios';

describe('WorkbookVersion domain support manifest gate', () => {
  registerDomainSupportGateMissingManifestScenarios();
  registerDomainSupportGateManifestValidationScenarios();
  registerDomainSupportGateRequiredSourceScenarios();
});
