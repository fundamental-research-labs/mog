import { registerVersionReviewDiagnosticsScenarios } from './version-review-diagnostics-scenarios';
import { registerVersionReviewDiffScenarios } from './version-review-diff-scenarios';
import { registerVersionReviewFacadeScenarios } from './version-review-facade-scenarios';
import { registerVersionReviewValidationScenarios } from './version-review-validation-scenarios';

describe('WorkbookVersion review records facade', () => {
  registerVersionReviewFacadeScenarios();
  registerVersionReviewValidationScenarios();
  registerVersionReviewDiagnosticsScenarios();
  registerVersionReviewDiffScenarios();
});
