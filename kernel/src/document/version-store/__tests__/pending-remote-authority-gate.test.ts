import { registerPendingRemoteAuthorityGateAuthorIdentityScenarios } from './pending-remote-authority-gate-author-identity-scenarios';
import { registerPendingRemoteAuthorityGateEligibilityScenarios } from './pending-remote-authority-gate-eligibility-scenarios';
import { registerPendingRemoteAuthorityGateProviderIdentityScenarios } from './pending-remote-authority-gate-provider-identity-scenarios';
import { registerPendingRemoteAuthorityGateReplayScenarios } from './pending-remote-authority-gate-replay-scenarios';

describe('validatePendingRemoteProviderAuthority', () => {
  registerPendingRemoteAuthorityGateEligibilityScenarios();
  registerPendingRemoteAuthorityGateProviderIdentityScenarios();
  registerPendingRemoteAuthorityGateReplayScenarios();
  registerPendingRemoteAuthorityGateAuthorIdentityScenarios();
});
