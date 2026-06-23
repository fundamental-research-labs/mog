import { registerPendingRemotePromotionProviderHostGateBoundaryScenarios } from './version-pending-remote-promotion-provider-boundary-host-gates-scenarios';
import { registerPendingRemotePromotionProviderPublicOpsBoundaryScenarios } from './version-pending-remote-promotion-provider-boundary-public-ops-scenarios';

export function registerPendingRemotePromotionProviderBoundaryScenarios(): void {
  registerPendingRemotePromotionProviderHostGateBoundaryScenarios();
  registerPendingRemotePromotionProviderPublicOpsBoundaryScenarios();
}
