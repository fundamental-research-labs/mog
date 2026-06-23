import { registerMergeCommitFailureScenarios } from './commit-service-merge-failure-scenarios';
import { registerMergeCommitFastForwardScenarios } from './commit-service-merge-fast-forward-scenarios';
import { registerMergeCommitMaterializationScenarios } from './commit-service-merge-materialization-scenarios';

describe('WorkbookVersionCommitService merge commits', () => {
  registerMergeCommitMaterializationScenarios();
  registerMergeCommitFailureScenarios();
  registerMergeCommitFastForwardScenarios();
});
