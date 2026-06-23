import { createPendingRemotePromotionService } from '../pending-remote-promotion-service';
import { createInMemoryVersionStoreProvider } from '../provider';
import {
  DOCUMENT_SCOPE,
  expectGraphHead,
  expectReadHeadSuccess,
  initializeProvider,
  markSyncBatchFailed,
  pendingSegmentFixture,
  persistAndReservePendingSegment,
  PROMOTION_NOW,
  providerWithCommitConflict,
} from './pending-remote-promotion-service.test-helpers';

describe('PendingRemotePromotionService', () => {
  it('skips missing snapshot roots and missing required objects without mutating refs', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const namespace = await initializeProvider(provider);
    const graph = await provider.openGraph(namespace);
    const store = await provider.openPendingRemoteSegmentStore(namespace);
    const missingSnapshotDigest = await pendingSegmentFixture(namespace, {
      includeSnapshotRoot: false,
      updateId: 'remote-update-missing-snapshot-digest',
    });
    await persistAndReservePendingSegment(graph, store, missingSnapshotDigest);
    const missingSnapshotObject = await pendingSegmentFixture(namespace, {
      updateId: 'remote-update-missing-snapshot-object',
    });
    await graph.putObjects(
      missingSnapshotObject.objectRecords.filter(
        (record) => record.preimage.objectType !== 'workbook.snapshotRoot.v1',
      ),
    );
    await expect(store.reserveSegment(missingSnapshotObject.input)).resolves.toMatchObject({
      status: 'created',
    });
    const headBefore = await expectReadHeadSuccess(graph);

    const result = await createPendingRemotePromotionService({
      provider,
      now: () => PROMOTION_NOW,
    }).promotePendingRemoteSegments();

    expect(result.status).toBe('failed');
    expect(result.commitIds).toEqual([]);
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          segmentId: missingSnapshotDigest.input.pendingRemoteSegmentId,
          reason: 'missing-snapshot-root',
        }),
        expect.objectContaining({
          segmentId: missingSnapshotObject.input.pendingRemoteSegmentId,
          reason: 'missing-required-object',
        }),
      ]),
    );
    await expectGraphHead(graph, headBefore);
    await expect(
      store.readBySegmentId(missingSnapshotDigest.input.pendingRemoteSegmentId),
    ).resolves.toMatchObject({
      status: 'found',
      record: { state: 'pending' },
    });
    await expect(
      store.readBySegmentId(missingSnapshotObject.input.pendingRemoteSegmentId),
    ).resolves.toMatchObject({
      status: 'found',
      record: { state: 'pending' },
    });
  });

  it('leaves pending records pending when the visible graph ref conflicts', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const namespace = await initializeProvider(provider);
    const graph = await provider.openGraph(namespace);
    const store = await provider.openPendingRemoteSegmentStore(namespace);
    const fixture = await pendingSegmentFixture(namespace);
    await persistAndReservePendingSegment(graph, store, fixture);
    const conflictProvider = providerWithCommitConflict(provider, namespace);

    const result = await createPendingRemotePromotionService({
      provider: conflictProvider,
      now: () => PROMOTION_NOW,
    }).promotePendingRemoteSegments();

    expect(result).toMatchObject({
      status: 'failed',
      promotedSegmentIds: [],
      skipped: [{ segmentId: fixture.input.pendingRemoteSegmentId, reason: 'graph-write-failed' }],
      diagnostics: [
        {
          code: 'VERSION_PENDING_REMOTE_PROMOTION_GRAPH_WRITE_FAILED',
          sourceDiagnostics: [{ code: 'VERSION_REF_CONFLICT' }],
        },
      ],
    });
    await expect(
      store.readBySegmentId(fixture.input.pendingRemoteSegmentId),
    ).resolves.toMatchObject({
      status: 'found',
      record: { state: 'pending' },
    });
  });

  it('blocks failed sync batches and allows absent batch status records', async () => {
    const absentProvider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const absentNamespace = await initializeProvider(absentProvider, 'graph-absent-batch');
    const absentGraph = await absentProvider.openGraph(absentNamespace);
    const absentStore = await absentProvider.openPendingRemoteSegmentStore(absentNamespace);
    const absentFixture = await pendingSegmentFixture(absentNamespace);
    await persistAndReservePendingSegment(absentGraph, absentStore, absentFixture);
    await expect(
      createPendingRemotePromotionService({
        provider: absentProvider,
        now: () => PROMOTION_NOW,
      }).promotePendingRemoteSegments(),
    ).resolves.toMatchObject({
      status: 'success',
      promotedSegmentIds: [absentFixture.input.pendingRemoteSegmentId],
      skipped: [],
    });

    const failedProvider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const failedNamespace = await initializeProvider(failedProvider, 'graph-failed-batch');
    const failedGraph = await failedProvider.openGraph(failedNamespace);
    const failedStore = await failedProvider.openPendingRemoteSegmentStore(failedNamespace);
    const failedFixture = await pendingSegmentFixture(failedNamespace);
    await persistAndReservePendingSegment(failedGraph, failedStore, failedFixture);
    await markSyncBatchFailed(failedProvider, failedFixture.input.operationContext);

    const result = await createPendingRemotePromotionService({
      provider: failedProvider,
      now: () => PROMOTION_NOW,
    }).promotePendingRemoteSegments();

    expect(result).toMatchObject({
      status: 'failed',
      promotedSegmentIds: [],
      skipped: [
        {
          segmentId: failedFixture.input.pendingRemoteSegmentId,
          reason: 'batch-status-terminal',
        },
      ],
      diagnostics: [{ code: 'VERSION_PENDING_REMOTE_PROMOTION_BATCH_BLOCKED' }],
    });
    await expect(
      failedStore.readBySegmentId(failedFixture.input.pendingRemoteSegmentId),
    ).resolves.toMatchObject({
      status: 'found',
      record: { state: 'pending' },
    });
  });
});
