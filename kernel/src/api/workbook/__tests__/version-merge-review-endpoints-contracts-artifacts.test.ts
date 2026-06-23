import { registerArtifactProviderRedactionScenarios } from './version-merge-review-endpoints-contracts-artifacts-provider-redaction-scenarios';
import { registerSavedResolutionArtifactScenarios } from './version-merge-review-endpoints-contracts-artifacts-saved-resolution-scenarios';
import { registerSealedRefArtifactScenarios } from './version-merge-review-endpoints-contracts-artifacts-sealed-ref-scenarios';

describe('WorkbookVersion merge review endpoint artifact contracts', () => {
  registerSavedResolutionArtifactScenarios();
  registerSealedRefArtifactScenarios();
  registerArtifactProviderRedactionScenarios();
});
