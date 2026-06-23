import { createPendingRemotePromotionService } from '../pending-remote-promotion-service';
import { createInMemoryVersionStoreProvider } from '../provider';
import {
  DOCUMENT_SCOPE,
  expectSingleCommit,
  initializeProvider,
  PROMOTION_NOW,
} from './pending-remote-promotion-service.test-helpers';
import {
  groupedPendingSegmentsFixture,
  persistGroupedPendingSegments,
} from './pending-remote-promotion-service.group-fixtures';

describe('PendingRemotePromotionService', () => {
  it('promotes explicit grouped segments together with deterministic metadata', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const namespace = await initializeProvider(provider);
    const graph = await provider.openGraph(namespace);
    const store = await provider.openPendingRemoteSegmentStore(namespace);
    const { first, second } = await groupedPendingSegmentsFixture(namespace, {
      groupId: 'remote-group-1',
      firstPayloadHash: '3'.repeat(64),
      secondPayloadHash: '4'.repeat(64),
    });
    await persistGroupedPendingSegments(graph, store, { first, second });

    const result = await createPendingRemotePromotionService({
      provider,
      now: () => PROMOTION_NOW,
    }).promotePendingRemoteSegments();

    const commitId = expectSingleCommit(result.commitIds);
    expect(result).toMatchObject({
      status: 'success',
      promotedSegmentIds: [second.input.pendingRemoteSegmentId, first.input.pendingRemoteSegmentId],
      skipped: [],
    });
    const readCommit = await graph.readCommit(commitId);
    expect(readCommit).toMatchObject({
      status: 'success',
      commit: {
        payload: {
          createdAt: second.input.operationContext.createdAt,
          mutationSegmentDigests: [
            second.input.mutationSegmentDigest,
            first.input.mutationSegmentDigest,
          ],
        },
      },
    });
    await expect(store.readBySegmentId(first.input.pendingRemoteSegmentId)).resolves.toMatchObject({
      status: 'found',
      record: { terminal: { commitId } },
    });
    await expect(store.readBySegmentId(second.input.pendingRemoteSegmentId)).resolves.toMatchObject(
      {
        status: 'found',
        record: { terminal: { commitId } },
      },
    );
  });
});
