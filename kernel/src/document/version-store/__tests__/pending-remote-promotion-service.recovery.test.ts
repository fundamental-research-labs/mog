import { createPendingRemotePromotionService } from '../pending-remote-promotion-service';
import { createInMemoryVersionStoreProvider } from '../provider';
import {
  DOCUMENT_SCOPE,
  expectGraphHead,
  expectReadHeadSuccess,
  expectSingleCommit,
  initializeProvider,
  objectRecord,
  pendingSegmentFixture,
  persistAndReservePendingSegment,
  PROMOTION_NOW,
  providerWithCompletionFailures,
} from './pending-remote-promotion-service.test-helpers';

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
    const snapshotRootRecord = await objectRecord(
      'workbook.snapshotRoot.v1',
      { sheets: [] },
      namespace,
    );
    const semanticChangeSetRecord = await objectRecord(
      'workbook.semanticChangeSet.v1',
      { schemaVersion: 1, changes: [{ id: 'remote-change-1' }, { id: 'remote-change-2' }] },
      namespace,
    );
    const first = await pendingSegmentFixture(namespace, {
      createdAt: '2026-06-21T00:00:03.000Z',
      groupId: 'remote-group-recovery',
      mutationSegmentId: 'remote-segment-1',
      payloadHash: '5'.repeat(64),
      sequence: '1',
      sharedSnapshotRootRecord: snapshotRootRecord,
      sharedSemanticChangeSetRecord: semanticChangeSetRecord,
      updateId: 'remote-update-1',
    });
    const second = await pendingSegmentFixture(namespace, {
      createdAt: '2026-06-21T00:00:02.000Z',
      groupId: 'remote-group-recovery',
      mutationSegmentId: 'remote-segment-2',
      payloadHash: '6'.repeat(64),
      sequence: '2',
      sharedSnapshotRootRecord: snapshotRootRecord,
      sharedSemanticChangeSetRecord: semanticChangeSetRecord,
      updateId: 'remote-update-2',
    });
    await expect(
      graph.putObjects([...first.objectRecords, ...second.objectRecords]),
    ).resolves.toMatchObject({
      status: 'success',
    });
    await expect(store.reserveSegment(first.input)).resolves.toMatchObject({ status: 'created' });
    await expect(store.reserveSegment(second.input)).resolves.toMatchObject({ status: 'created' });

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
