import { beforeEach, describe, jest } from '@jest/globals';

import { registerProvenanceStatusProviderAttachmentScenarios } from './version-provenance-status-provider-attachment-scenarios';
import { registerProvenanceStatusProviderIncompleteScenarios } from './version-provenance-status-provider-incomplete-scenarios';
import { registerProvenanceStatusRedactionScenarios } from './version-provenance-status-redaction-scenarios';
import { registerProvenanceStatusTruthScenarios } from './version-provenance-status-truth-scenarios';

describe('WorkbookVersion provenance status', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  registerProvenanceStatusTruthScenarios();
  registerProvenanceStatusProviderAttachmentScenarios();
  registerProvenanceStatusRedactionScenarios();
  registerProvenanceStatusProviderIncompleteScenarios();
});
