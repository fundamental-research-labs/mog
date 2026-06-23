import { describe } from '@jest/globals';

import { registerRevertProviderPreflightScenarios } from './version-revert-provider-preflight-scenarios';
import { registerRevertProviderResultScenarios } from './version-revert-provider-result-scenarios';

describe('WorkbookVersion revert provider recovery semantics', () => {
  registerRevertProviderResultScenarios();
  registerRevertProviderPreflightScenarios();
});
