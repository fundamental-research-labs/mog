import {
  registerProjectionDiagnosticScenarios,
  registerProjectionPaginationScenarios,
  registerProjectionRedactionScenarios,
  registerProjectionSemanticScenarios,
} from './version-diff-projection-scenarios';

describe('WorkbookVersion public semantic diff projection', () => {
  registerProjectionSemanticScenarios();
  registerProjectionRedactionScenarios();
  registerProjectionDiagnosticScenarios();
  registerProjectionPaginationScenarios();
});
