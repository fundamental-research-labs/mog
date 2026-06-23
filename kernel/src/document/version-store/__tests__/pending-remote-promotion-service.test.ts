import { createPendingRemotePromotionService } from '../pending-remote-promotion-service';
import { createInMemoryVersionStoreProvider } from '../provider';
import {
  DOCUMENT_SCOPE,
  expectSingleCommit,
  initializeProvider,
  pendingSegmentFixture,
  persistAndReservePendingSegment,
  PROMOTION_NOW,
} from './pending-remote-promotion-service.test-helpers';

describe('PendingRemotePromotionService', () => {
  it('promotes a pending remote segment into a graph commit and completes it', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const namespace = await initializeProvider(provider);
    const graph = await provider.openGraph(namespace);
    const store = await provider.openPendingRemoteSegmentStore(namespace);
    const fixture = await pendingSegmentFixture(namespace);
    await persistAndReservePendingSegment(graph, store, fixture);

    const result = await createPendingRemotePromotionService({
      provider,
      now: () => PROMOTION_NOW,
    }).promotePendingRemoteSegments();

    expect(result).toMatchObject({
      status: 'success',
      promotedSegmentIds: [fixture.input.pendingRemoteSegmentId],
      skipped: [],
    });
    const commitId = expectSingleCommit(result.commitIds);
    const readCommit = await graph.readCommit(commitId);
    expect(readCommit).toMatchObject({
      status: 'success',
      commit: {
        payload: {
          author: fixture.input.operationContext.author,
          createdAt: fixture.input.operationContext.createdAt,
          snapshotRootDigest: fixture.input.snapshotRootDigest,
          semanticChangeSetDigest: fixture.input.semanticChangeSetDigest,
          mutationSegmentDigests: [fixture.input.mutationSegmentDigest],
        },
      },
    });
    await expect(
      store.readBySegmentId(fixture.input.pendingRemoteSegmentId),
    ).resolves.toMatchObject({
      status: 'found',
      record: {
        state: 'promoted',
        updatedAt: PROMOTION_NOW.toISOString(),
        terminal: { status: 'promoted', commitId },
      },
    });
  });
});
