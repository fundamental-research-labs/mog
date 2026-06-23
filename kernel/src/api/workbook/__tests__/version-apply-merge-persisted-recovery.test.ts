import { registerArtifactCompletionRecoveryScenarios } from './version-apply-merge-persisted-recovery-completion-scenarios';
import { registerArtifactRecoveryDiagnosticScenarios } from './version-apply-merge-persisted-recovery-diagnostics-scenarios';
import {
  registerStagedArtifactRecoveryScenarios,
  registerStagedFastForwardRecoveryScenarios,
} from './version-apply-merge-persisted-recovery-staged-scenarios';
import { registerTerminalArtifactReplayScenarios } from './version-apply-merge-persisted-recovery-terminal-scenarios';

describe('persisted applyMerge artifact recovery hardening', () => {
  registerTerminalArtifactReplayScenarios();
  registerStagedFastForwardRecoveryScenarios();
  registerArtifactCompletionRecoveryScenarios();
  registerStagedArtifactRecoveryScenarios();
  registerArtifactRecoveryDiagnosticScenarios();
});
