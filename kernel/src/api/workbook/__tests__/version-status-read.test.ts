import { registerVersionStatusReadGraphServiceScenarios } from './version-status-read-graph-service-scenarios';
import { registerVersionStatusReadPaginationScenarios } from './version-status-read-pagination-scenarios';
import { registerVersionStatusReadUnavailableScenarios } from './version-status-read-unavailable-scenarios';
import { resetVersionStatusWorkbookMocks } from './version-status-workbook-test-utils';

describe('WorkbookVersion status read APIs', () => {
  beforeEach(() => {
    resetVersionStatusWorkbookMocks();
  });

  registerVersionStatusReadUnavailableScenarios();
  registerVersionStatusReadGraphServiceScenarios();
  registerVersionStatusReadPaginationScenarios();
});
