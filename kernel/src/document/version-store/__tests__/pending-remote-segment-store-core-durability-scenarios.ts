import { reservePersistedPendingRemoteSegment } from '../pending-remote-segment-store';
import { createInMemoryVersionStoreProvider } from '../provider';
import {
  DOCUMENT_SCOPE,
  initializeProvider,
  pendingSegmentFixture,
} from './pending-remote-segment-store-fixtures';

export function registerPendingRemoteSegmentStoreCoreDurabilityScenarios(): void {
  it('does not reserve a persisted pending remote segment before referenced objects are durable', async () => {
    const provider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      durability: 'memory',
    });
    const namespace = await initializeProvider(provider);
    const graph = await provider.openGraph(namespace);
    const store = await provider.openPendingRemoteSegmentStore(namespace);
    const fixture = await pendingSegmentFixture(namespace);

    const rejected = await reservePersistedPendingRemoteSegment({
      graph,
      store,
      input: fixture.input,
    });
    expect(rejected).toMatchObject({
      status: 'failed',
      diagnostics: [
        { code: 'VERSION_PENDING_REMOTE_MISSING_OBJECT', recoverability: 'repair' },
        { code: 'VERSION_PENDING_REMOTE_MISSING_OBJECT', recoverability: 'repair' },
      ],
    });
    await expect(store.readByIdempotencyKey(fixture.input.idempotencyKey)).resolves.toMatchObject({
      status: 'missing',
    });

    await expect(graph.putObjects(fixture.objectRecords)).resolves.toMatchObject({
      status: 'success',
    });
    await expect(
      reservePersistedPendingRemoteSegment({ graph, store, input: fixture.input }),
    ).resolves.toMatchObject({ status: 'created' });
  });

  it('validates optional boundary snapshot roots before reserving pending remote segments', async () => {
    const provider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      durability: 'memory',
    });
    const namespace = await initializeProvider(provider);
    const graph = await provider.openGraph(namespace);
    const store = await provider.openPendingRemoteSegmentStore(namespace);
    const fixture = await pendingSegmentFixture(namespace, { includeSnapshotRoot: true });
    const input = fixture.input;
    const durableNonSnapshotObjects = fixture.objectRecords.filter(
      (record) => record.preimage.objectType !== 'workbook.snapshotRoot.v1',
    );

    await expect(graph.putObjects(durableNonSnapshotObjects)).resolves.toMatchObject({
      status: 'success',
    });
    await expect(
      reservePersistedPendingRemoteSegment({ graph, store, input }),
    ).resolves.toMatchObject({
      status: 'failed',
      diagnostics: [
        {
          code: 'VERSION_PENDING_REMOTE_MISSING_OBJECT',
          details: { field: 'snapshotRootDigest', objectType: 'workbook.snapshotRoot.v1' },
        },
      ],
    });
    await expect(store.readByIdempotencyKey(input.idempotencyKey)).resolves.toMatchObject({
      status: 'missing',
    });

    await expect(graph.putObjects(fixture.objectRecords)).resolves.toMatchObject({
      status: 'success',
    });
    await expect(
      reservePersistedPendingRemoteSegment({ graph, store, input }),
    ).resolves.toMatchObject({
      status: 'created',
      record: { snapshotRootDigest: input.snapshotRootDigest },
    });
    await expect(store.listByState('pending')).resolves.toMatchObject({
      status: 'success',
      records: [{ snapshotRootDigest: input.snapshotRootDigest }],
    });
  });
}
