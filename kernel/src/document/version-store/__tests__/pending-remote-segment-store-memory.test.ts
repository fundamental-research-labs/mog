import 'fake-indexeddb/auto';

import {
  reservePersistedPendingRemoteSegment,
  validatePendingRemoteSegmentObjects,
} from '../pending-remote-segment-store';
import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
} from '../provider';
import { deleteVersionStoreIndexedDbForTesting } from '../provider-indexeddb-schema';
import {
  DOCUMENT_SCOPE,
  PROMOTED_COMMIT,
  expectGraphHeadUnchanged,
  expectPersistedPendingObjects,
  expectReadHeadSuccess,
  initializeProvider,
  objectRecord,
  pendingSegmentFixture,
  syncOperationContext,
} from './pending-remote-segment-store-fixtures';

beforeEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

afterEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

describe('pending remote segment store in-memory persistence', () => {
  it('reserves, reads, completes, and snapshots pending remote segments idempotently', async () => {
    const backend = new InMemoryVersionDocumentProviderBackend();
    const provider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend,
      durability: 'snapshot-test-double',
    });
    const namespace = await initializeProvider(provider);
    const graph = await provider.openGraph(namespace);
    const store = await provider.openPendingRemoteSegmentStore(namespace);
    const fixture = await pendingSegmentFixture(namespace);
    const input = fixture.input;
    const headBefore = await expectReadHeadSuccess(graph);

    await expect(graph.putObjects(fixture.objectRecords)).resolves.toMatchObject({
      status: 'success',
    });
    await expectGraphHeadUnchanged(graph, headBefore);
    await expectPersistedPendingObjects(graph, input);

    const created = await reservePersistedPendingRemoteSegment({ graph, store, input });
    expect(created.status).toBe('created');
    if (created.status !== 'created') throw new Error('expected pending segment creation');
    await expectGraphHeadUnchanged(graph, headBefore);
    await expect(store.listByState('pending')).resolves.toMatchObject({
      status: 'success',
      records: [{ pendingRemoteSegmentId: input.pendingRemoteSegmentId }],
    });

    await expect(
      reservePersistedPendingRemoteSegment({
        graph,
        store,
        input: {
          ...input,
          createdAt: '2026-06-21T00:00:02.000Z',
          operationContext: syncOperationContext({ createdAt: '2026-06-21T00:00:02.000Z' }),
        },
      }),
    ).resolves.toMatchObject({
      status: 'existing',
      record: { pendingRemoteSegmentId: input.pendingRemoteSegmentId },
    });
    await expect(store.readBySegmentId(input.pendingRemoteSegmentId)).resolves.toMatchObject({
      status: 'found',
      record: { idempotencyKey: input.idempotencyKey },
    });
    await expect(store.readByIdempotencyKey(input.idempotencyKey)).resolves.toMatchObject({
      status: 'found',
      record: { pendingRemoteSegmentId: input.pendingRemoteSegmentId },
    });

    const changedIdentity = await store.reserveSegment({
      ...input,
      operationContext: syncOperationContext({ updateId: 'remote-update-2' }),
    });
    expect(changedIdentity).toMatchObject({
      status: 'failed',
      diagnostics: [{ code: 'VERSION_INVALID_OPTIONS' }],
    });

    const changedMutationSegmentRecord = await objectRecord(
      'workbook.mutationSegment.v1',
      { segmentId: 'remote-segment-2' },
      namespace,
    );
    await expect(graph.putObjects([changedMutationSegmentRecord])).resolves.toMatchObject({
      status: 'success',
    });
    const changedPayload = await store.reserveSegment({
      ...input,
      mutationSegmentDigest: changedMutationSegmentRecord.digest,
    });
    expect(changedPayload).toMatchObject({
      status: 'conflict',
      diagnostics: [{ code: 'VERSION_PENDING_REMOTE_CONFLICT' }],
    });

    const completed = await store.completeSegment({
      pendingRemoteSegmentId: input.pendingRemoteSegmentId,
      mutationSegmentDigest: input.mutationSegmentDigest,
      completedAt: '2026-06-21T00:00:03.000Z',
      terminal: { status: 'promoted', commitId: PROMOTED_COMMIT },
    });
    expect(completed).toMatchObject({
      status: 'completed',
      record: { state: 'promoted', terminal: { status: 'promoted' } },
    });
    await expect(store.listByState('pending')).resolves.toMatchObject({
      status: 'success',
      records: [],
    });
    await expect(store.listByState('promoted')).resolves.toMatchObject({
      status: 'success',
      records: [{ pendingRemoteSegmentId: input.pendingRemoteSegmentId }],
    });
    await expect(
      store.completeSegment({
        pendingRemoteSegmentId: input.pendingRemoteSegmentId,
        mutationSegmentDigest: input.mutationSegmentDigest,
        completedAt: '2026-06-21T00:00:04.000Z',
        terminal: { status: 'promoted', commitId: PROMOTED_COMMIT },
      }),
    ).resolves.toMatchObject({
      status: 'completed',
      record: {
        state: 'promoted',
        updatedAt: '2026-06-21T00:00:03.000Z',
      },
    });
    await expect(
      store.completeSegment({
        pendingRemoteSegmentId: input.pendingRemoteSegmentId,
        mutationSegmentDigest: input.mutationSegmentDigest,
        completedAt: '2026-06-21T00:00:05.000Z',
        terminal: { status: 'dropped', reason: 'duplicate' },
      }),
    ).resolves.toMatchObject({
      status: 'conflict',
      diagnostics: [{ code: 'VERSION_PENDING_REMOTE_CONFLICT' }],
    });

    const snapshot = await backend.exportSnapshot();
    const reloadedBackend = await InMemoryVersionDocumentProviderBackend.fromSnapshot(snapshot);
    const reloadedProvider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend: reloadedBackend,
      durability: 'snapshot-test-double',
    });
    const reloadedGraph = await reloadedProvider.openGraph(namespace);
    const reloadedStore = await reloadedProvider.openPendingRemoteSegmentStore(namespace);
    const reloadedRead = await reloadedStore.readByIdempotencyKey(input.idempotencyKey);
    expect(reloadedRead).toMatchObject({
      status: 'found',
      record: { state: 'promoted', terminal: { commitId: PROMOTED_COMMIT } },
    });
    if (reloadedRead.status !== 'found') throw new Error('expected reloaded pending remote row');
    await expect(
      validatePendingRemoteSegmentObjects(reloadedGraph, reloadedRead.record),
    ).resolves.toEqual({
      status: 'success',
      diagnostics: [],
    });
  });
});
