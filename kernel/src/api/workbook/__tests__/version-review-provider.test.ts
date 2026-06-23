import { registerReviewProviderCoreDiagnosticScenarios } from './version-review-provider-core-diagnostic-scenarios';
import { registerReviewProviderCoreProjectionScenarios } from './version-review-provider-core-projection-scenarios';
import { registerReviewProviderCoreWiringScenarios } from './version-review-provider-core-wiring-scenarios';

describe('WorkbookVersion provider-backed review service', () => {
  registerReviewProviderCoreWiringScenarios();
  registerReviewProviderCoreProjectionScenarios();
  registerReviewProviderCoreDiagnosticScenarios();
});
