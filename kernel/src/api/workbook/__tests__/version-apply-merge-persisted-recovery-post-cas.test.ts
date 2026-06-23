import { registerPostCasRecoveryIdentityScenario } from './version-apply-merge-persisted-recovery-post-cas-identity';
import { registerPostCasRecoveryProviderDiagnosticsScenario } from './version-apply-merge-persisted-recovery-post-cas-provider-diagnostics';
import { registerPostCasRecoveryStalenessScenarios } from './version-apply-merge-persisted-recovery-post-cas-staleness';

describe('persisted applyMerge post-CAS recovery hardening', () => {
  registerPostCasRecoveryProviderDiagnosticsScenario();
  registerPostCasRecoveryStalenessScenarios();
  registerPostCasRecoveryIdentityScenario();
});
