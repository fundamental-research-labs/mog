import { describe } from '@jest/globals';

import { registerRevertAdmissionCapabilityScenarios } from './version-revert-admission-capability-scenarios';
import {
  registerRevertAdmissionPreflightMatrixScenarios,
  registerRevertAdmissionUnsupportedDomainScenario,
} from './version-revert-admission-preflight-scenarios';
import { registerRevertAdmissionRedactionScenarios } from './version-revert-admission-redaction-scenarios';

describe('WorkbookVersion revert facade disabled admission', () => {
  registerRevertAdmissionCapabilityScenarios();
  registerRevertAdmissionUnsupportedDomainScenario();
  registerRevertAdmissionRedactionScenarios();
  registerRevertAdmissionPreflightMatrixScenarios();
});
