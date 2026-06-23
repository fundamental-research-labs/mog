import { registerVersionHistoryAccessDenialProjectionScenarios } from './version-history-diagnostic-projection-access-denial-scenarios';
import { registerVersionHistoryCapabilityDeniedProjectionScenarios } from './version-history-diagnostic-projection-capability-denied-scenarios';
import { registerVersionHistoryNonPublicAccessMetadataScenarios } from './version-history-diagnostic-projection-non-public-access-metadata-scenarios';

describe('version history access diagnostic projection', () => {
  registerVersionHistoryCapabilityDeniedProjectionScenarios();
  registerVersionHistoryAccessDenialProjectionScenarios();
  registerVersionHistoryNonPublicAccessMetadataScenarios();
});
