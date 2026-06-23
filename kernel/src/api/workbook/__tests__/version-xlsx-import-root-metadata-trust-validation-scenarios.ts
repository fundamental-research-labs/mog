import { registerRootMetadataTrustValidationHeadIdentityScenarios } from './version-xlsx-import-root-metadata-trust-validation-head-identity-scenarios';
import { registerRootMetadataTrustValidationObjectDigestScenarios } from './version-xlsx-import-root-metadata-trust-validation-object-digest-scenarios';

export function registerRootMetadataTrustValidationScenarios(): void {
  registerRootMetadataTrustValidationHeadIdentityScenarios();
  registerRootMetadataTrustValidationObjectDigestScenarios();
}
