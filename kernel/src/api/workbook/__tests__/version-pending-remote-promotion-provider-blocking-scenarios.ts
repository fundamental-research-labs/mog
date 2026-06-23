import { registerPendingRemotePromotionProviderAuthorityBlockingScenarios } from './version-pending-remote-promotion-provider-blocking-authority-scenarios';
import { registerPendingRemotePromotionProviderBatchStatusBlockingScenarios } from './version-pending-remote-promotion-provider-blocking-batch-status-scenarios';
import { registerPendingRemotePromotionProviderDurableReceiptBlockingScenarios } from './version-pending-remote-promotion-provider-blocking-durable-receipt-scenarios';
import { registerPendingRemotePromotionProviderStaleHeadBlockingScenarios } from './version-pending-remote-promotion-provider-blocking-stale-head-scenarios';

export function registerPendingRemotePromotionProviderBlockingScenarios(): void {
  registerPendingRemotePromotionProviderBatchStatusBlockingScenarios();
  registerPendingRemotePromotionProviderAuthorityBlockingScenarios();
  registerPendingRemotePromotionProviderDurableReceiptBlockingScenarios();
  registerPendingRemotePromotionProviderStaleHeadBlockingScenarios();
}
