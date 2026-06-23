import { registerVersionStatusCommitProviderScenarios } from './version-status-commit-provider-scenarios';
import { registerVersionStatusCommitServiceBoundaryScenarios } from './version-status-commit-service-boundary-scenarios';
import { registerVersionStatusCommitValidationScenarios } from './version-status-commit-validation-scenarios';
import { registerVersionStatusCommitWriteServiceScenarios } from './version-status-commit-write-service-scenarios';
import { resetVersionStatusWorkbookMocks } from './version-status-workbook-test-utils';

describe('WorkbookVersion status commit APIs', () => {
  beforeEach(() => {
    resetVersionStatusWorkbookMocks();
  });

  registerVersionStatusCommitWriteServiceScenarios();
  registerVersionStatusCommitProviderScenarios();
  registerVersionStatusCommitValidationScenarios();
  registerVersionStatusCommitServiceBoundaryScenarios();
});
