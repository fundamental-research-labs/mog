import { registerPostCasRecoveryScenarios } from './version-apply-merge-ref-cas-proof-recovery-post-cas-scenarios';
import { registerStagedMergeCommitRecoveryScenarios } from './version-apply-merge-ref-cas-proof-recovery-staged-scenarios';

describe('recoverStagedMergeCommitIfAlreadyApplied ref CAS proof recovery', () => {
  registerStagedMergeCommitRecoveryScenarios();
});

describe('recoverPersistedMergeApplyPostCas', () => {
  registerPostCasRecoveryScenarios();
});
