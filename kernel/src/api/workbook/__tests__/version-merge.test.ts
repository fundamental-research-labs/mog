import { describe } from '@jest/globals';

import { registerVersionMergeCoreAvailabilityScenarios } from './version-merge-core-availability-scenarios';
import { registerVersionMergeCoreRoutingScenarios } from './version-merge-core-routing-scenarios';
import { registerVersionMergeCoreValidationScenarios } from './version-merge-core-validation-scenarios';

describe('WorkbookVersion merge facade', () => {
  registerVersionMergeCoreRoutingScenarios();
  registerVersionMergeCoreValidationScenarios();
  registerVersionMergeCoreAvailabilityScenarios();
});
