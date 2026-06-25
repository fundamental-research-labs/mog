import { it } from '@jest/globals';

import { expectCheckoutBlockedByProviderWrites } from './version-checkout-provider-write-preconditions-assertions';
import {
  createInitializedProviderWritePreconditionProvider,
  createProviderWritePreconditionWorkbook,
  createWorkbookWithPendingRemoteSegment,
  startHeldPendingRemotePromotionActivity,
  startHeldRemoteSyncApplyActivity,
} from './version-checkout-provider-write-preconditions-setup';

export function registerProviderWritePendingRemoteSegmentPreconditionScenario(): void {
  it('blocks checkout while remote sync changes are waiting for promotion', async () => {
    const wb = await createWorkbookWithPendingRemoteSegment('graph-pending-remote-checkout');

    await expectCheckoutBlockedByProviderWrites(wb, {
      pendingRemoteSegmentCount: 1,
    });
  });
}

export function registerProviderWriteActivityPreconditionScenario(): void {
  it('blocks checkout while provider write activity is in flight', async () => {
    const provider = await createInitializedProviderWritePreconditionProvider(
      'graph-active-provider-writes',
    );
    const activity = startHeldRemoteSyncApplyActivity();
    const wb = createProviderWritePreconditionWorkbook(provider, {
      providerWriteActivityTracker: activity.providerWriteActivityTracker,
    });

    try {
      await expectCheckoutBlockedByProviderWrites(wb, {
        remoteSyncApplyActiveCount: 1,
      });
    } finally {
      activity.release();
      await activity.done;
    }
  });
}

export function registerProviderWritePendingRemotePromotionPreconditionScenario(): void {
  it('blocks checkout while pending remote promotion activity is in flight', async () => {
    const provider =
      await createInitializedProviderWritePreconditionProvider('graph-active-promotion');
    const activity = await startHeldPendingRemotePromotionActivity();
    const wb = createProviderWritePreconditionWorkbook(provider, {
      providerWriteActivityTracker: activity.providerWriteActivityTracker,
    });

    try {
      await expectCheckoutBlockedByProviderWrites(wb, {
        pendingRemotePromotionActiveCount: 1,
      });
    } finally {
      activity.release();
      await activity.done;
    }
  });
}
