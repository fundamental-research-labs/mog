import { registerPersistedRefCasProofTerminalReplayAlreadyAppliedStaleTargetScenarios } from './version-apply-merge-ref-cas-proof-persisted-terminal-replay-already-applied-stale-target-scenarios';
import { registerPersistedRefCasProofTerminalReplayFastForwardIdempotencyScenarios } from './version-apply-merge-ref-cas-proof-persisted-terminal-replay-fast-forward-idempotency-scenarios';

export function registerPersistedRefCasProofTerminalReplayScenarios(): void {
  registerPersistedRefCasProofTerminalReplayFastForwardIdempotencyScenarios();
  registerPersistedRefCasProofTerminalReplayAlreadyAppliedStaleTargetScenarios();
}
