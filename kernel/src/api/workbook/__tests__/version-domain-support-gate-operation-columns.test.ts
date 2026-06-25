import { describe } from '@jest/globals';

import { registerOperationColumnCapabilityMatrixScenarios } from './version-domain-support-gate-operation-columns-capability-matrix-scenarios';
import { registerOperationColumnManifestRowScenarios } from './version-domain-support-gate-operation-columns-manifest-row-scenarios';
import { registerOperationColumnPartialSupportScenarios } from './version-domain-support-gate-operation-columns-partial-support-scenarios';
import { registerOperationColumnPublicDiagnosticsScenarios } from './version-domain-support-gate-operation-columns-public-diagnostics-scenarios';

describe('WorkbookVersion domain support gate operation capability columns', () => {
  registerOperationColumnCapabilityMatrixScenarios();
  registerOperationColumnPartialSupportScenarios();
  registerOperationColumnManifestRowScenarios();
  registerOperationColumnPublicDiagnosticsScenarios();
});
