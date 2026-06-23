import { createPendingRemotePromotionService } from '../pending-remote-promotion-service';
import { createInMemoryVersionStoreProvider } from '../provider';
import {
  DOCUMENT_SCOPE,
  expectGraphHead,
  expectReadHeadSuccess,
  expectSingleCommit,
  initializeProvider,
  pendingSegmentFixture,
  persistAndReservePendingSegment,
  PROMOTION_NOW,
  providerWithCompletionFailures,
} from './pending-remote-promotion-service.test-helpers';
import {
  groupedPendingSegmentsFixture,
  persistGroupedPendingSegments,
} from './pending-remote-promotion-service.group-fixtures';

describe('PendingRemotePromotionService', () => {
  it('recovers an already-created promotion commit when completion failed', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const namespace = await initializeProvider(provider);
    const graph = await provider.openGraph(namespace);
    const store = await provider.openPendingRemoteSegmentStore(namespace);
    const fixture = await pendingSegmentFixture(namespace);
    await persistAndReservePendingSegment(graph, store, fixture);

    const first = await createPendingRemotePromotionService({
      provider: providerWithCompletionFailures(provider, (attempt) => attempt === 1),
      now: () => PROMOTION_NOW,
    }).promotePendingRemoteSegments();

    const commitId = expectSingleCommit(first.commitIds);
    expect(first).toMatchObject({
      status: 'failed',
      promotedSegmentIds: [],
      skipped: [
        {
          segmentId: fixture.input.pendingRemoteSegmentId,
          reason: 'completion-failed',
          commitId,
        },
      ],
    });
    const headAfterFirst = await expectReadHeadSuccess(graph);
    expect(headAfterFirst.commitId).toBe(commitId);
    await expect(
      store.readBySegmentId(fixture.input.pendingRemoteSegmentId),
    ).resolves.toMatchObject({
      status: 'found',
      record: { state: 'pending' },
    });

    const second = await createPendingRemotePromotionService({
      provider,
      now: () => PROMOTION_NOW,
    }).promotePendingRemoteSegments();

    expect(second).toMatchObject({
      status: 'success',
      promotedSegmentIds: [fixture.input.pendingRemoteSegmentId],
      commitIds: [commitId],
      skipped: [],
      diagnostics: [{ code: 'VERSION_PENDING_REMOTE_PROMOTION_RECOVERED' }],
    });
    await expectGraphHead(graph, headAfterFirst);
    await expect(
      store.readBySegmentId(fixture.input.pendingRemoteSegmentId),
    ).resolves.toMatchObject({
      status: 'found',
      record: {
        state: 'promoted',
        terminal: {
          status: 'promoted',
          commitId,
          promotionDigest: { algorithm: 'sha256', digest: expect.any(String) },
        },
      },
    });
  });

  it('recovers remaining grouped segments from a promoted peer without a replacement commit', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const namespace = await initializeProvider(provider);
    const graph = await provider.openGraph(namespace);
    const store = await provider.openPendingRemoteSegmentStore(namespace);
    const { first, second } = await groupedPendingSegmentsFixture(namespace, {
      groupId: 'remote-group-recovery',
      firstPayloadHash: '5'.repeat(64),
      secondPayloadHash: '6'.repeat(64),
    });
    await persistGroupedPendingSegments(graph, store, { first, second });

    const firstRun = await createPendingRemotePromotionService({
      provider: providerWithCompletionFailures(provider, (attempt) => attempt === 2),
      now: () => PROMOTION_NOW,
    }).promotePendingRemoteSegments();

    const commitId = expectSingleCommit(firstRun.commitIds);
    expect(firstRun).toMatchObject({
      status: 'partial',
      promotedSegmentIds: [second.input.pendingRemoteSegmentId],
      skipped: [
        {
          segmentId: first.input.pendingRemoteSegmentId,
          reason: 'completion-failed',
          commitId,
        },
      ],
    });
    const headAfterFirst = await expectReadHeadSuccess(graph);
    expect(headAfterFirst.commitId).toBe(commitId);

    const secondRun = await createPendingRemotePromotionService({
      provider,
      now: () => PROMOTION_NOW,
    }).promotePendingRemoteSegments();

    expect(secondRun).toMatchObject({
      status: 'success',
      promotedSegmentIds: [first.input.pendingRemoteSegmentId],
      commitIds: [commitId],
      skipped: [],
      diagnostics: [{ code: 'VERSION_PENDING_REMOTE_PROMOTION_RECOVERED' }],
    });
    await expectGraphHead(graph, headAfterFirst);
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
