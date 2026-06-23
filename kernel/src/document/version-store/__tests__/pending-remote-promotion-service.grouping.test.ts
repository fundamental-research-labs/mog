import { createPendingRemotePromotionService } from '../pending-remote-promotion-service';
import { createInMemoryVersionStoreProvider } from '../provider';
import {
  DOCUMENT_SCOPE,
  expectSingleCommit,
  initializeProvider,
  objectRecord,
  pendingSegmentFixture,
  PROMOTION_NOW,
} from './pending-remote-promotion-service.test-helpers';

describe('PendingRemotePromotionService', () => {
  it('promotes explicit grouped segments together with deterministic metadata', async () => {
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
      groupId: 'remote-group-1',
      mutationSegmentId: 'remote-segment-1',
      payloadHash: '3'.repeat(64),
      sequence: '1',
      sharedSnapshotRootRecord: snapshotRootRecord,
      sharedSemanticChangeSetRecord: semanticChangeSetRecord,
      updateId: 'remote-update-1',
    });
    const second = await pendingSegmentFixture(namespace, {
      createdAt: '2026-06-21T00:00:02.000Z',
      groupId: 'remote-group-1',
      mutationSegmentId: 'remote-segment-2',
      payloadHash: '4'.repeat(64),
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
