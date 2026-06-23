import { registerMergeAttemptArtifactsCleanScenarios } from './merge-attempt-artifacts-clean-scenarios';
import { registerMergeAttemptArtifactsConflictedScenarios } from './merge-attempt-artifacts-conflicted-scenarios';

describe('merge attempt artifact records', () => {
  registerMergeAttemptArtifactsCleanScenarios();
  registerMergeAttemptArtifactsConflictedScenarios();
});
