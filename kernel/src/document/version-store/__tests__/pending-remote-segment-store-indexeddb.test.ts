import 'fake-indexeddb/auto';

import {
  reservePersistedPendingRemoteSegment,
  validatePendingRemoteSegmentObjects,
} from '../pending-remote-segment-store';
import { createIndexedDbVersionStoreProvider } from '../provider-indexeddb/backend';
import { deleteVersionStoreIndexedDbForTesting } from '../provider-indexeddb-schema';
import {
  DOCUMENT_SCOPE,
  PROMOTED_COMMIT,
  expectGraphHeadUnchanged,
  expectReadHeadSuccess,
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

describe('pending remote segment store IndexedDB persistence', () => {
  it('persists pending remote segments through provider reloads', async () => {
    const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
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
    const reserved = await reservePersistedPendingRemoteSegment({ graph, store, input });
    expect(reserved).toMatchObject({ status: 'created' });
    await expect(store.readByIdempotencyKey(input.idempotencyKey)).resolves.toMatchObject({
      status: 'found',
      record: { pendingRemoteSegmentId: input.pendingRemoteSegmentId },
    });

    const reloadedProvider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const reloadedGraph = await reloadedProvider.openGraph(namespace);
    const reloadedStore = await reloadedProvider.openPendingRemoteSegmentStore(namespace);
    const reloadedRead = await reloadedStore.readByIdempotencyKey(input.idempotencyKey);
    expect(reloadedRead).toMatchObject({
      status: 'found',
      record: {
        pendingRemoteSegmentId: input.pendingRemoteSegmentId,
        namespaceKey: expect.any(String),
        documentScopeKey: expect.any(String),
      },
    });
    if (reloadedRead.status !== 'found') throw new Error('expected reloaded pending remote row');
    await expect(
      validatePendingRemoteSegmentObjects(reloadedGraph, reloadedRead.record),
    ).resolves.toEqual({
      status: 'success',
      diagnostics: [],
    });
    await expect(
      reloadedStore.readBySegmentId(input.pendingRemoteSegmentId),
    ).resolves.toMatchObject({
      status: 'found',
      record: { idempotencyKey: input.idempotencyKey },
    });
    await expect(reloadedStore.listByState('pending')).resolves.toMatchObject({
      status: 'success',
      records: [{ pendingRemoteSegmentId: input.pendingRemoteSegmentId }],
    });
    await expect(
      reservePersistedPendingRemoteSegment({
        graph: reloadedGraph,
        store: reloadedStore,
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
    await expect(
      reloadedStore.completeSegment({
        pendingRemoteSegmentId: input.pendingRemoteSegmentId,
        mutationSegmentDigest: input.mutationSegmentDigest,
        completedAt: '2026-06-21T00:00:03.000Z',
        terminal: { status: 'dropped', reason: 'duplicate' },
      }),
    ).resolves.toMatchObject({ status: 'completed' });
    await expect(reloadedStore.listByState('pending')).resolves.toMatchObject({
      status: 'success',
      records: [],
    });
    await expect(reloadedStore.listByState('dropped')).resolves.toMatchObject({
      status: 'success',
      records: [{ idempotencyKey: input.idempotencyKey }],
    });
    await expect(
      reloadedStore.completeSegment({
        pendingRemoteSegmentId: input.pendingRemoteSegmentId,
        mutationSegmentDigest: input.mutationSegmentDigest,
        completedAt: '2026-06-21T00:00:04.000Z',
        terminal: { status: 'dropped', reason: 'duplicate' },
      }),
    ).resolves.toMatchObject({
      status: 'completed',
      record: { updatedAt: '2026-06-21T00:00:03.000Z' },
    });
    await expect(
      reloadedStore.completeSegment({
        pendingRemoteSegmentId: input.pendingRemoteSegmentId,
        mutationSegmentDigest: input.mutationSegmentDigest,
        completedAt: '2026-06-21T00:00:05.000Z',
        terminal: { status: 'promoted', commitId: PROMOTED_COMMIT },
      }),
    ).resolves.toMatchObject({
      status: 'conflict',
      diagnostics: [{ code: 'VERSION_PENDING_REMOTE_CONFLICT' }],
    });
  });
});
