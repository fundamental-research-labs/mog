import { beforeEach, describe, jest } from '@jest/globals';

import { registerProposalRuntimeDiagnosticsAccessScenarios } from './version-proposal-runtime-diagnostics-access-scenarios';
import { registerProposalRuntimeDiagnosticsPayloadScenarios } from './version-proposal-runtime-diagnostics-payload-scenarios';
import { registerProposalRuntimeDiagnosticsServiceScenarios } from './version-proposal-runtime-diagnostics-service-scenarios';

describe('WorkbookVersion proposal runtime diagnostics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  registerProposalRuntimeDiagnosticsAccessScenarios();
  registerProposalRuntimeDiagnosticsPayloadScenarios();
  registerProposalRuntimeDiagnosticsServiceScenarios();
});
