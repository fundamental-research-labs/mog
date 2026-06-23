import { describe } from '@jest/globals';

import { registerWriteCasActiveDeleteScenarios } from './version-refs-write-cas-active-delete-scenarios';
import { registerWriteCasFastForwardScenarios } from './version-refs-write-cas-fast-forward-scenarios';
import { registerWriteCasLastLiveDeleteScenarios } from './version-refs-write-cas-last-live-delete-scenarios';
import { registerWriteCasPublicDeleteScenarios } from './version-refs-write-cas-public-delete-scenarios';

describe('WorkbookVersion public ref compare-and-swap writes', () => {
  registerWriteCasFastForwardScenarios();
  registerWriteCasPublicDeleteScenarios();
  registerWriteCasActiveDeleteScenarios();
  registerWriteCasLastLiveDeleteScenarios();
});
