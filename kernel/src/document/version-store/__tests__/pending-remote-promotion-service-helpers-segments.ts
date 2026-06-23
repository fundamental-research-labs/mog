import {
  reservePersistedPendingRemoteSegment,
  type PendingRemoteSegmentOperationContext,
  type PendingRemoteSegmentStore,
} from '../pending-remote-segment-store';
import type { createInMemoryVersionStoreProvider, VersionGraphStore } from '../provider';
import { syncBatchStatusKeyMaterialForOperationContext } from '../sync-batch-status-store';
import type { PendingSegmentFixture } from './pending-remote-promotion-service-helpers-fixtures';

type InMemoryProvider = ReturnType<typeof createInMemoryVersionStoreProvider>;

export async function persistAndReservePendingSegment(
  graph: VersionGraphStore,
  store: PendingRemoteSegmentStore,
  fixture: PendingSegmentFixture,
): Promise<void> {
  await expect(graph.putObjects(fixture.objectRecords)).resolves.toMatchObject({
    status: 'success',
  });
  await expect(
    reservePersistedPendingRemoteSegment({ graph, store, input: fixture.input }),
  ).resolves.toMatchObject({ status: 'created' });
}

export async function markSyncBatchFailed(
  provider: InMemoryProvider,
  operationContext: PendingRemoteSegmentOperationContext,
): Promise<void> {
  const store = await provider.openSyncBatchStatusStore();
  const keyMaterial = await syncBatchStatusKeyMaterialForOperationContext(operationContext);
  await expect(
    store.reserveBatchStatus({
      batchStatusId: keyMaterial.batchStatusId,
      operationContext,
      createdAt: operationContext.createdAt,
    }),
  ).resolves.toMatchObject({ status: 'reserved' });
  await expect(
    store.completeBatchStatus({
      batchStatusId: keyMaterial.batchStatusId,
      payloadHash: operationContext.collaboration.payloadHash,
      completedAt: '2026-06-21T00:00:05.000Z',
      terminal: { status: 'failedAfterMutation', reason: 'remote-import-failed' },
    }),
  ).resolves.toMatchObject({ status: 'completed' });
}
