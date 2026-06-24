import { expect, it, jest } from '@jest/globals';

import { readVersionPendingProviderWrites } from '../version/pending/provider-writes';
import { createCtx } from './version-pending-provider-writes-test-utils';

export function registerPendingProviderWritesActivityScenarios(): void {
  it('reads provider-write activity from an attached pending promotion service tracker', async () => {
    const tracker = {
      readActivity: jest.fn(() => ({
        remoteSyncApplyActiveCount: 0,
        pendingRemotePromotionActiveCount: 1,
        pendingRemotePromotionQueuedCount: 0,
        statusRevision: 'revision:7',
      })),
      trackRemoteSyncApply: jest.fn(),
      runExclusivePendingRemotePromotion: jest.fn(),
    };

    const status = await readVersionPendingProviderWrites(
      createCtx({
        pendingRemotePromotionService: {
          providerWriteActivityTracker: tracker,
          promotePendingRemoteSegments: jest.fn(),
        },
      }),
    );

    expect(status).toMatchObject({
      pendingProviderWrites: true,
      statusRevision: 'providerActivity:revision:7|provider:none',
      unsafeReasons: [
        expect.objectContaining({
          code: 'version.surfaceStatus.pendingProviderWrites',
          data: expect.objectContaining({
            pendingRemotePromotionActiveCount: 1,
          }),
        }),
      ],
    });
    expect(tracker.readActivity).toHaveBeenCalledTimes(1);
  });

  it('fails closed when provider-write activity is missing settled-state evidence', async () => {
    const tracker = {
      readActivity: jest.fn(() => ({
        statusRevision: 'revision:missing-counts',
      })),
      trackRemoteSyncApply: jest.fn(),
      runExclusivePendingRemotePromotion: jest.fn(),
    };

    const status = await readVersionPendingProviderWrites(
      createCtx({
        pendingRemotePromotionService: {
          providerWriteActivityTracker: tracker,
          promotePendingRemoteSegments: jest.fn(),
        },
      }),
    );

    expect(status).toMatchObject({
      pendingProviderWrites: true,
      statusRevision: 'providerActivity:unknown|provider:none',
      unsafeReasons: [
        expect.objectContaining({
          code: 'version.surfaceStatus.pendingProviderWritesReadFailed',
          data: expect.objectContaining({
            redacted: true,
            providerPayload: 'activitySnapshot',
            payloadIssue: 'invalidCounts',
          }),
        }),
      ],
    });
  });
}
