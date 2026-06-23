import {
  registerAsyncCommitDirtyTrackingScenarios,
  registerProviderCommitDirtyTrackingScenarios,
  registerProviderResidualDirtyTrackingScenarios,
  registerWriteServiceCommitDirtyTrackingScenarios,
} from './version-commit-dirty-tracking-scenarios';
import { resetVersionCommitDirtyTrackingMocks } from './version-commit-dirty-tracking-test-utils';

describe('WorkbookVersion dirty tracking around commit', () => {
  beforeEach(() => {
    resetVersionCommitDirtyTrackingMocks();
  });

  registerProviderCommitDirtyTrackingScenarios();
  registerWriteServiceCommitDirtyTrackingScenarios();
  registerProviderResidualDirtyTrackingScenarios();
  registerAsyncCommitDirtyTrackingScenarios();
});
