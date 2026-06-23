import { createPendingRemotePromotionService } from '../pending-remote-promotion-service';
import { createVersionProviderWriteActivityTracker } from '../provider-write-activity';
import { createInMemoryVersionStoreProvider } from '../provider';
import {
  deferred,
  DOCUMENT_SCOPE,
  initializeProvider,
  pendingSegmentFixture,
  persistAndReservePendingSegment,
  PROMOTION_NOW,
  providerWithGatedCommit,
} from './pending-remote-promotion-service.test-helpers';

describe('PendingRemotePromotionService', () => {
  it('serializes concurrent promotions and reports active promotion activity', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const namespace = await initializeProvider(provider);
    const graph = await provider.openGraph(namespace);
    const store = await provider.openPendingRemoteSegmentStore(namespace);
    const fixture = await pendingSegmentFixture(namespace);
    await persistAndReservePendingSegment(graph, store, fixture);
    const commitGate = deferred<void>();
    let commitAttempts = 0;
    const providerWriteActivityTracker = createVersionProviderWriteActivityTracker();
    const service = createPendingRemotePromotionService({
      provider: providerWithGatedCommit(provider, {
        beforeCommit: () => {
          commitAttempts += 1;
          commitGate.start();
          return commitGate.promise;
        },
      }),
      providerWriteActivityTracker,
      now: () => PROMOTION_NOW,
    });

    const first = service.promotePendingRemoteSegments();
    await commitGate.started;
    const second = service.promotePendingRemoteSegments();
    await Promise.resolve();

    expect(commitAttempts).toBe(1);
    expect(providerWriteActivityTracker.readActivity()).toMatchObject({
      pendingRemotePromotionActiveCount: 1,
      pendingRemotePromotionQueuedCount: 1,
    });

    commitGate.resolve();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toMatchObject({
      status: 'success',
      promotedSegmentIds: [fixture.input.pendingRemoteSegmentId],
    });
    expect(secondResult).toMatchObject({
      status: 'success',
      promotedSegmentIds: [],
      commitIds: [],
      skipped: [],
      diagnostics: [],
    });
    expect(commitAttempts).toBe(1);
    expect(providerWriteActivityTracker.readActivity()).toMatchObject({
      pendingRemotePromotionActiveCount: 0,
      pendingRemotePromotionQueuedCount: 0,
    });
  });
});
