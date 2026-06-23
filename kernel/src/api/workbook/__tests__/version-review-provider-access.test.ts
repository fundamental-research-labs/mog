import 'fake-indexeddb/auto';

import { registerReviewProviderAccessDiagnosticScenarios } from './version-review-provider-access-diagnostic-scenarios';
import { registerReviewProviderAccessProviderDiffScenarios } from './version-review-provider-access-provider-diff-scenarios';
import { registerReviewProviderAccessServiceScenarios } from './version-review-provider-access-service-scenarios';

describe('WorkbookVersion provider review access hardening', () => {
  registerReviewProviderAccessServiceScenarios();
  registerReviewProviderAccessDiagnosticScenarios();
  registerReviewProviderAccessProviderDiffScenarios();
});
