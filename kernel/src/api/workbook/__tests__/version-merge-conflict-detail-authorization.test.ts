import { registerRedactedDetailValueScenarios } from './version-merge-conflict-detail-authorization-redacted-detail-scenarios';
import { registerRequestAndDiagnosticRedactionScenarios } from './version-merge-conflict-detail-authorization-request-redaction-scenarios';
import { registerSavedResolutionAuthorizationScenarios } from './version-merge-conflict-detail-authorization-saved-resolution-scenarios';

describe('WorkbookVersion merge conflict detail authorization', () => {
  registerRequestAndDiagnosticRedactionScenarios();
  registerSavedResolutionAuthorizationScenarios();
  registerRedactedDetailValueScenarios();
});
