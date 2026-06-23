import { registerPersistedRefCasProofBlockingScenarios } from './version-apply-merge-ref-cas-proof-persisted-blocking-scenarios';
import { registerPersistedRefCasProofTerminalScenarios } from './version-apply-merge-ref-cas-proof-persisted-terminal-scenarios';

describe('applyPersistedMergeResult ref CAS proof recovery', () => {
  registerPersistedRefCasProofTerminalScenarios();
  registerPersistedRefCasProofBlockingScenarios();
});
