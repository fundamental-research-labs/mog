import { jest } from '@jest/globals';

import { registerPendingRemoteDiagnosticsRedactionScenarios } from './version-pending-remote-diagnostics-redaction-scenarios';
import { registerPendingRemoteGuardScenarios } from './version-pending-remote-guard-scenarios';
import { registerPendingRemoteResultShapeScenarios } from './version-pending-remote-result-shape-scenarios';

describe('version pending remote promotion runtime helper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  registerPendingRemoteResultShapeScenarios();
  registerPendingRemoteDiagnosticsRedactionScenarios();
  registerPendingRemoteGuardScenarios();
});
