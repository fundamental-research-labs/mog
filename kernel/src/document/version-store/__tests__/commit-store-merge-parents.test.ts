import { registerMergeParentDependencyScenarios } from './commit-store-merge-parents-dependency-scenarios';
import { registerMergeParentResolvedAttemptScenarios } from './commit-store-merge-parents-resolved-attempt-scenarios';
import { registerMergeParentValidationScenarios } from './commit-store-merge-parents-validation-scenarios';

describe('InMemoryWorkbookCommitStore merge commit parents', () => {
  registerMergeParentDependencyScenarios();
  registerMergeParentResolvedAttemptScenarios();
  registerMergeParentValidationScenarios();
});
