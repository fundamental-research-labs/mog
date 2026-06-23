import 'fake-indexeddb/auto';

import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import {
  reservePersistedPendingRemoteSegment,
  pendingRemoteSegmentKeyMaterialForOperationContext,
  validatePendingRemoteSegmentObjects,
  type PendingRemoteSegmentId,
  type PendingRemoteSegmentIdempotencyKey,
  type PendingRemoteSegmentOperationContext,
  type ReservePendingRemoteSegmentInput,
} from '../pending-remote-segment-store';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';
import type { VersionObjectType, WorkbookCommitId } from '../object-digest';
import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphStore,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../provider';
import { createIndexedDbVersionStoreProvider } from '../provider-indexeddb-backend';
import { deleteVersionStoreIndexedDbForTesting } from '../provider-indexeddb-schema';

const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};

const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

const PROMOTED_COMMIT = `commit:sha256:${'4'.repeat(64)}` as WorkbookCommitId;

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
      roomId: 'room-1',
      epoch: 'epoch-1',
      updateId: 'remote-update-1',
      sequence: '7',
      payloadHash: '3'.repeat(64),
    });
  });

  it('reserves, reads, completes, and snapshots in-memory pending remote segments idempotently', async () => {
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

  it('persists pending remote segments through IndexedDB provider reloads', async () => {
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

type PendingSegmentFixture = {
  readonly input: ReservePendingRemoteSegmentInput;
  readonly objectRecords: readonly VersionObjectRecord<unknown>[];
};

async function pendingSegmentFixture(
  namespace: VersionGraphNamespace,
  options: {
    readonly createdAt?: string;
    readonly includeSnapshotRoot?: boolean;
    readonly payloadHash?: string;
    readonly updateId?: string;
  } = {},
): Promise<PendingSegmentFixture> {
  const operationContext = syncOperationContext({
    payloadHash: options.payloadHash,
    updateId: options.updateId,
  });
  const keys = await pendingRemoteSegmentKeyMaterialForOperationContext(operationContext);
  const snapshotRootRecord = await objectRecord(
    'workbook.snapshotRoot.v1',
    { snapshotId: 'remote-boundary-snapshot-1', sheets: [] },
    namespace,
  );
  const semanticChangeSetRecord = await objectRecord(
    'workbook.semanticChangeSet.v1',
    { schemaVersion: 1, changes: [] },
    namespace,
  );
  const mutationSegmentRecord = await objectRecord(
    'workbook.mutationSegment.v1',
    { segmentId: 'remote-segment-1', domainId: 'runtime-diagnostics' },
    namespace,
  );
  return {
    input: {
      pendingRemoteSegmentId: keys.pendingRemoteSegmentId,
      idempotencyKey: keys.idempotencyKey,
      operationContext,
      mutationSegmentDigest: mutationSegmentRecord.digest,
      ...(options.includeSnapshotRoot ? { snapshotRootDigest: snapshotRootRecord.digest } : {}),
      semanticChangeSetDigest: semanticChangeSetRecord.digest,
      createdAt: options.createdAt ?? '2026-06-21T00:00:00.000Z',
    },
    objectRecords: [
      ...(options.includeSnapshotRoot ? [snapshotRootRecord] : []),
      semanticChangeSetRecord,
      mutationSegmentRecord,
    ],
  };
}

function syncOperationContext(
  options: {
    readonly createdAt?: string;
    readonly updateId?: string;
    readonly payloadHash?: string;
  } = {},
): PendingRemoteSegmentOperationContext {
  const updateId = options.updateId ?? 'remote-update-1';
  const payloadHash = options.payloadHash ?? '3'.repeat(64);
  return {
    operationId: `sync:providerLiveInbound:${updateId}`,
    kind: 'sync-import',
    author: {
      authorId: 'subject-ref-1',
      actorKind: 'user',
      sessionId: 'remote-session-1',
    },
    createdAt: options.createdAt ?? '2026-06-21T00:00:01.000Z',
    workbookId: DOCUMENT_SCOPE.documentId,
    domainIds: ['runtime-diagnostics'],
    capturePolicy: 'commitEligible',
    writeAdmissionMode: 'capture',
    collaboration: {
      sourceKind: 'providerLiveInbound',
      originKind: 'provider',
      stableOriginId: 'provider-stable-1',
      providerId: 'provider-1',
      roomId: 'room-1',
      epoch: 'epoch-1',
      updateId,
      sequence: '7',
      payloadHash,
      trustStatus: 'verified',
      authorState: 'singleRemote',
      remoteSessionId: 'remote-session-1',
      correlationId: 'correlation-1',
      causationIds: ['cause-1'],
      replay: false,
      system: false,
      commitGrouping: 'pendingRemote',
      validationDiagnosticCount: 0,
    },
  };
}

async function initializeProvider(provider: {
  initializeGraph(input: VersionGraphInitializeInput): Promise<VersionGraphInitializeResult>;
}): Promise<VersionGraphNamespace> {
  const input = await initializeInput('graph-1');
  const initialized = await provider.initializeGraph(input);
  expect(initialized.status).toBe('success');
  if (initialized.status !== 'success') {
    throw new Error(`expected initialize success: ${initialized.diagnostics[0]?.code}`);
  }
  return namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1');
}

async function initializeInput(graphId: string): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      snapshotRootRecord: await objectRecord(
        'workbook.snapshotRoot.v1',
        { label: 'root', sheets: [] },
        namespace,
      ),
      semanticChangeSetRecord: await objectRecord(
        'workbook.semanticChangeSet.v1',
        { label: 'root', changes: [] },
        namespace,
      ),
      author: AUTHOR,
      createdAt: '2026-06-20T00:00:00.000Z',
      completenessDiagnostics: [],
    },
  };
}

async function objectRecord(
  objectType: VersionObjectType,
  payload: unknown,
  namespace: VersionGraphNamespace,
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload,
  });
}

async function expectReadHeadSuccess(graph: VersionGraphStore) {
  const result = await graph.readHead();
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected readHead success: ${result.diagnostics[0]?.code}`);
  }
  return {
    headId: result.head.id,
    mainRevision: result.main.revision,
  };
}

async function expectGraphHeadUnchanged(
  graph: VersionGraphStore,
  expected: Awaited<ReturnType<typeof expectReadHeadSuccess>>,
): Promise<void> {
  await expect(expectReadHeadSuccess(graph)).resolves.toEqual(expected);
}

async function expectPersistedPendingObjects(
  graph: VersionGraphStore,
  input: ReservePendingRemoteSegmentInput,
): Promise<void> {
  await expect(
    graph.getObjectRecord({
      kind: 'object',
      objectType: 'workbook.mutationSegment.v1',
      digest: input.mutationSegmentDigest,
    }),
  ).resolves.toMatchObject({
    digest: input.mutationSegmentDigest,
    preimage: { objectType: 'workbook.mutationSegment.v1' },
  });
  if (input.snapshotRootDigest !== undefined) {
    await expect(
      graph.getObjectRecord({
        kind: 'object',
        objectType: 'workbook.snapshotRoot.v1',
        digest: input.snapshotRootDigest,
      }),
    ).resolves.toMatchObject({
      digest: input.snapshotRootDigest,
      preimage: { objectType: 'workbook.snapshotRoot.v1' },
    });
  }
  if (input.semanticChangeSetDigest === undefined) return;
  await expect(
    graph.getObjectRecord({
      kind: 'object',
      objectType: 'workbook.semanticChangeSet.v1',
      digest: input.semanticChangeSetDigest,
    }),
  ).resolves.toMatchObject({
    digest: input.semanticChangeSetDigest,
    preimage: { objectType: 'workbook.semanticChangeSet.v1' },
  });
}
