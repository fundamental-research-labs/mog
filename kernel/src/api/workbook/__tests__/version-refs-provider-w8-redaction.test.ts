import { registerProviderW8RedactionActiveRefPreflightScenarios } from './version-refs-provider-w8-redaction-active-ref-preflight-scenarios';
import { registerProviderW8RedactionDeleteDenialScenarios } from './version-refs-provider-w8-redaction-delete-denial-scenarios';
import { registerProviderW8RedactionDeletePreflightScenarios } from './version-refs-provider-w8-redaction-delete-preflight-scenarios';
import { registerProviderW8RedactionProviderDiagnosticScenarios } from './version-refs-provider-w8-redaction-provider-diagnostic-scenarios';
import { registerProviderW8RedactionTombstoneConflictScenarios } from './version-refs-provider-w8-redaction-tombstone-conflict-scenarios';
import { resetWorkbookProviderTestMocks } from './version-refs-provider-w8-test-utils';

describe('WorkbookVersion provider-backed ref lifecycle W8 redaction and preflight', () => {
  beforeEach(() => {
    resetWorkbookProviderTestMocks();
  });

  registerProviderW8RedactionDeletePreflightScenarios();
  registerProviderW8RedactionDeleteDenialScenarios();
  registerProviderW8RedactionProviderDiagnosticScenarios();
  registerProviderW8RedactionTombstoneConflictScenarios();
  registerProviderW8RedactionActiveRefPreflightScenarios();
});
