import 'fake-indexeddb/auto';

import {
  reservePersistedPendingRemoteSegment,
  pendingRemoteSegmentKeyMaterialForOperationContext,
  type PendingRemoteSegmentId,
  type PendingRemoteSegmentIdempotencyKey,
} from '../pending-remote-segment-store';
import { createInMemoryVersionStoreProvider } from '../provider';
import { deleteVersionStoreIndexedDbForTesting } from '../provider-indexeddb-schema';
import {
  DOCUMENT_SCOPE,
  initializeProvider,
  pendingSegmentFixture,
  syncOperationContext,
} from './pending-remote-segment-store-fixtures';

beforeEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

afterEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

describe('pending remote segment store', () => {
  it('computes stable key material from sync collaboration identity', async () => {
    const first = await pendingRemoteSegmentKeyMaterialForOperationContext(syncOperationContext());
    const second = await pendingRemoteSegmentKeyMaterialForOperationContext(
      syncOperationContext({ createdAt: '2026-06-21T00:00:02.000Z' }),
    );
    const changedIdentity = await pendingRemoteSegmentKeyMaterialForOperationContext(
      syncOperationContext({ updateId: 'remote-update-2' }),
    );

    expect(first).toEqual(second);
    expect(first.idempotencyKey).toMatch(/^pending-remote:sha256:[0-9a-f]{64}$/);
    expect(first.pendingRemoteSegmentId).toMatch(/^pending-remote-segment:sha256:[0-9a-f]{64}$/);
    expect(first.idempotencyKey).not.toBe(changedIdentity.idempotencyKey);
    expect(first.syncIdentity).toEqual({
      schemaVersion: 1,
      sourceKind: 'providerLiveInbound',
      originKind: 'provider',
      stableOriginId: 'provider-stable-1',
      providerId: 'provider-1',
      authorityRef: 'authority-1',
      roomId: 'room-1',
      epoch: 'epoch-1',
      updateId: 'remote-update-1',
      sequence: '7',
      payloadHash: '3'.repeat(64),
    });
  });

  it('rejects pending remote reservations with mismatched durable key material', async () => {
    const provider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      durability: 'memory',
    });
    const namespace = await initializeProvider(provider);
    const store = await provider.openPendingRemoteSegmentStore(namespace);
    const fixture = await pendingSegmentFixture(namespace);
    const mismatchedIdempotencyKey =
      `pending-remote:sha256:${'9'.repeat(64)}` as PendingRemoteSegmentIdempotencyKey;
    const mismatchedSegmentId =
      `pending-remote-segment:sha256:${'8'.repeat(64)}` as PendingRemoteSegmentId;

    await expect(
      store.reserveSegment({
        ...fixture.input,
        idempotencyKey: mismatchedIdempotencyKey,
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      record: null,
      diagnostics: [{ code: 'VERSION_INVALID_OPTIONS' }],
    });
    await expect(store.readByIdempotencyKey(mismatchedIdempotencyKey)).resolves.toMatchObject({
      status: 'missing',
    });

    await expect(
      store.reserveSegment({
        ...fixture.input,
        pendingRemoteSegmentId: mismatchedSegmentId,
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      record: null,
      diagnostics: [{ code: 'VERSION_INVALID_OPTIONS' }],
    });
    await expect(store.readBySegmentId(mismatchedSegmentId)).resolves.toMatchObject({
      status: 'missing',
    });
  });

  it('lists pending remote segments deterministically by reservation identity', async () => {
    const provider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      durability: 'memory',
    });
    const namespace = await initializeProvider(provider);
    const store = await provider.openPendingRemoteSegmentStore(namespace);
    const later = await pendingSegmentFixture(namespace, {
      createdAt: '2026-06-21T00:00:02.000Z',
      payloadHash: '5'.repeat(64),
      updateId: 'remote-update-2',
    });
    const earlier = await pendingSegmentFixture(namespace, {
      createdAt: '2026-06-21T00:00:01.000Z',
      payloadHash: '6'.repeat(64),
      updateId: 'remote-update-3',
    });

    await expect(store.reserveSegment(later.input)).resolves.toMatchObject({ status: 'created' });
    await expect(store.reserveSegment(earlier.input)).resolves.toMatchObject({
      status: 'created',
    });

    const listed = await store.listByState('pending');
    expect(listed.status).toBe('success');
    if (listed.status !== 'success') throw new Error('expected pending segment list success');
    expect(listed.records.map((record) => record.pendingRemoteSegmentId)).toEqual([
      earlier.input.pendingRemoteSegmentId,
      later.input.pendingRemoteSegmentId,
    ]);
  });

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
});
