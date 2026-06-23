import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { createPendingRemotePromotionService } from '../pending-remote-promotion-service';
import {
  pendingRemoteSegmentKeyMaterialForOperationContext,
  reservePersistedPendingRemoteSegment,
  type PendingRemoteSegmentOperationContext,
  type PendingRemoteSegmentStore,
  type ReservePendingRemoteSegmentInput,
} from '../pending-remote-segment-store';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';
import type { VersionObjectType, WorkbookCommitId } from '../object-digest';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
  type VersionGraphStore,
  type VersionStoreProvider,
} from '../provider';
import type { RefVersion } from '../ref-store';
import { syncBatchStatusKeyMaterialForOperationContext } from '../sync-batch-status-store';
import { createVersionProviderWriteActivityTracker } from '../provider-write-activity';

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

const PROMOTION_NOW = new Date('2026-06-21T00:10:00.000Z');
type InMemoryProvider = ReturnType<typeof createInMemoryVersionStoreProvider>;
type ConflictProvider = VersionStoreProvider &
  Pick<InMemoryProvider, 'openPendingRemoteSegmentStore' | 'openSyncBatchStatusStore'>;

describe('PendingRemotePromotionService', () => {
  it('promotes a pending remote segment into a graph commit and completes it', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const namespace = await initializeProvider(provider);
    const graph = await provider.openGraph(namespace);
    const store = await provider.openPendingRemoteSegmentStore(namespace);
    const fixture = await pendingSegmentFixture(namespace);
    await persistAndReservePendingSegment(graph, store, fixture);

    const result = await createPendingRemotePromotionService({
      provider,
      now: () => PROMOTION_NOW,
    }).promotePendingRemoteSegments();

    expect(result).toMatchObject({
      status: 'success',
      promotedSegmentIds: [fixture.input.pendingRemoteSegmentId],
      skipped: [],
    });
    const commitId = expectSingleCommit(result.commitIds);
    const readCommit = await graph.readCommit(commitId);
    expect(readCommit).toMatchObject({
      status: 'success',
      commit: {
        payload: {
          author: fixture.input.operationContext.author,
          createdAt: fixture.input.operationContext.createdAt,
          snapshotRootDigest: fixture.input.snapshotRootDigest,
          semanticChangeSetDigest: fixture.input.semanticChangeSetDigest,
          mutationSegmentDigests: [fixture.input.mutationSegmentDigest],
        },
      },
    });
    await expect(store.readBySegmentId(fixture.input.pendingRemoteSegmentId)).resolves.toMatchObject(
      {
        status: 'found',
        record: {
          state: 'promoted',
          updatedAt: PROMOTION_NOW.toISOString(),
          terminal: { status: 'promoted', commitId },
        },
      },
    );
  });

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
    await expect(graph.putObjects([...first.objectRecords, ...second.objectRecords])).resolves.toMatchObject({
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
    await expect(store.readBySegmentId(second.input.pendingRemoteSegmentId)).resolves.toMatchObject({
      status: 'found',
      record: { terminal: { commitId } },
    });
  });

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
    await expect(store.readBySegmentId(fixture.input.pendingRemoteSegmentId)).resolves.toMatchObject(
      {
        status: 'found',
        record: { state: 'pending' },
      },
    );

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
    await expect(store.readBySegmentId(fixture.input.pendingRemoteSegmentId)).resolves.toMatchObject(
      {
        status: 'found',
        record: {
          state: 'promoted',
          terminal: {
            status: 'promoted',
            commitId,
            promotionDigest: { algorithm: 'sha256', digest: expect.any(String) },
          },
        },
      },
    );
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
    await expect(graph.putObjects([...first.objectRecords, ...second.objectRecords])).resolves.toMatchObject({
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
    await expect(store.readBySegmentId(second.input.pendingRemoteSegmentId)).resolves.toMatchObject({
      status: 'found',
      record: { terminal: { commitId } },
    });
  });

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
    await expect(store.readBySegmentId(fixture.input.pendingRemoteSegmentId)).resolves.toMatchObject(
      {
        status: 'found',
        record: { state: 'pending' },
      },
    );
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

  it('serializes concurrent promotions and reports active promotion activity', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const namespace = await initializeProvider(provider);
    const graph = await provider.openGraph(namespace);
    const store = await provider.openPendingRemoteSegmentStore(namespace);
    const fixture = await pendingSegmentFixture(namespace);
    await persistAndReservePendingSegment(graph, store, fixture);
    const commitGate = deferred<void>();
    let commitAttempts = 0;
    const providerWriteActivityTracker = createVersionProviderWriteActivityTracker();
    const service = createPendingRemotePromotionService({
      provider: providerWithGatedCommit(provider, {
        beforeCommit: () => {
          commitAttempts += 1;
          commitGate.start();
          return commitGate.promise;
        },
      }),
      providerWriteActivityTracker,
      now: () => PROMOTION_NOW,
    });

    const first = service.promotePendingRemoteSegments();
    await commitGate.started;
    const second = service.promotePendingRemoteSegments();
    await Promise.resolve();

    expect(commitAttempts).toBe(1);
    expect(providerWriteActivityTracker.readActivity()).toMatchObject({
      pendingRemotePromotionActiveCount: 1,
      pendingRemotePromotionQueuedCount: 1,
    });

    commitGate.resolve();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toMatchObject({
      status: 'success',
      promotedSegmentIds: [fixture.input.pendingRemoteSegmentId],
    });
    expect(secondResult).toMatchObject({
      status: 'success',
      promotedSegmentIds: [],
      commitIds: [],
      skipped: [],
      diagnostics: [],
    });
    expect(commitAttempts).toBe(1);
    expect(providerWriteActivityTracker.readActivity()).toMatchObject({
      pendingRemotePromotionActiveCount: 0,
      pendingRemotePromotionQueuedCount: 0,
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
    readonly groupId?: string;
    readonly includeSnapshotRoot?: boolean;
    readonly mutationSegmentId?: string;
    readonly payloadHash?: string;
    readonly sequence?: string;
    readonly sharedSnapshotRootRecord?: VersionObjectRecord<unknown>;
    readonly sharedSemanticChangeSetRecord?: VersionObjectRecord<unknown>;
    readonly updateId?: string;
  } = {},
): Promise<PendingSegmentFixture> {
  const includeSnapshotRoot = options.includeSnapshotRoot ?? true;
  const operationContext = syncOperationContext(options);
  const keys = await pendingRemoteSegmentKeyMaterialForOperationContext(operationContext);
  const snapshotRootRecord =
    options.sharedSnapshotRootRecord ??
    (await objectRecord(
      'workbook.snapshotRoot.v1',
      { snapshotId: 'remote-boundary-snapshot-1', sheets: [] },
      namespace,
    ));
  const semanticChangeSetRecord =
    options.sharedSemanticChangeSetRecord ??
    (await objectRecord(
      'workbook.semanticChangeSet.v1',
      { schemaVersion: 1, changes: [{ id: 'remote-change-1' }] },
      namespace,
    ));
  const mutationSegmentRecord = await objectRecord(
    'workbook.mutationSegment.v1',
    {
      segmentId: options.mutationSegmentId ?? 'remote-segment-1',
      domainId: 'runtime-diagnostics',
    },
    namespace,
  );
  return {
    input: {
      pendingRemoteSegmentId: keys.pendingRemoteSegmentId,
      idempotencyKey: keys.idempotencyKey,
      operationContext,
      mutationSegmentDigest: mutationSegmentRecord.digest,
      ...(includeSnapshotRoot ? { snapshotRootDigest: snapshotRootRecord.digest } : {}),
      semanticChangeSetDigest: semanticChangeSetRecord.digest,
      createdAt: operationContext.createdAt,
    },
    objectRecords: [
      ...(includeSnapshotRoot ? [snapshotRootRecord] : []),
      semanticChangeSetRecord,
      mutationSegmentRecord,
    ],
  };
}

function syncOperationContext(
  options: {
    readonly createdAt?: string;
    readonly groupId?: string;
    readonly payloadHash?: string;
    readonly sequence?: string;
    readonly updateId?: string;
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
    ...(options.groupId === undefined ? {} : { groupId: options.groupId }),
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
      sequence: options.sequence ?? '7',
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

async function initializeProvider(
  provider: {
    initializeGraph(input: VersionGraphInitializeInput): Promise<VersionGraphInitializeResult>;
  },
  graphId = 'graph-1',
): Promise<VersionGraphNamespace> {
  const initialized = await provider.initializeGraph(await initializeInput(graphId));
  expect(initialized.status).toBe('success');
  if (initialized.status !== 'success') {
    throw new Error(`expected initialize success: ${initialized.diagnostics[0]?.code}`);
  }
  return namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
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

async function persistAndReservePendingSegment(
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

async function markSyncBatchFailed(
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

async function expectReadHeadSuccess(graph: VersionGraphStore): Promise<{
  readonly commitId: WorkbookCommitId;
  readonly revision: RefVersion;
}> {
  const result = await graph.readHead();
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected readHead success: ${result.diagnostics[0]?.code}`);
  }
  return { commitId: result.main.commitId, revision: result.main.revision };
}

async function expectGraphHead(
  graph: VersionGraphStore,
  expected: { readonly commitId: WorkbookCommitId; readonly revision: RefVersion },
): Promise<void> {
  const result = await expectReadHeadSuccess(graph);
  expect(result).toEqual(expected);
}

function expectSingleCommit(commitIds: readonly WorkbookCommitId[]): WorkbookCommitId {
  expect(commitIds).toHaveLength(1);
  const commitId = commitIds[0];
  if (commitId === undefined) throw new Error('expected single commit id');
  return commitId;
}

function providerWithCommitConflict(
  provider: InMemoryProvider,
  namespace: VersionGraphNamespace,
): ConflictProvider {
  return {
    documentScope: provider.documentScope,
    accessContext: provider.accessContext,
    capabilities: provider.capabilities,
    readGraphRegistry: provider.readGraphRegistry.bind(provider),
    initializeGraph: provider.initializeGraph.bind(provider),
    scanDocumentIntegrity: provider.scanDocumentIntegrity.bind(provider),
    close: provider.close.bind(provider),
    dispose: provider.dispose.bind(provider),
    openPendingRemoteSegmentStore: provider.openPendingRemoteSegmentStore.bind(provider),
    openSyncBatchStatusStore: provider.openSyncBatchStatusStore.bind(provider),
    openGraph: async (requestedNamespace, accessContext) => {
      const graph = await provider.openGraph(requestedNamespace, accessContext);
      return graphWithOneCommitConflict(graph, namespace);
    },
  };
}

function providerWithGatedCommit(
  provider: InMemoryProvider,
  gate: { readonly beforeCommit: () => Promise<void> },
): ConflictProvider {
  return {
    documentScope: provider.documentScope,
    accessContext: provider.accessContext,
    capabilities: provider.capabilities,
    readGraphRegistry: provider.readGraphRegistry.bind(provider),
    initializeGraph: provider.initializeGraph.bind(provider),
    scanDocumentIntegrity: provider.scanDocumentIntegrity.bind(provider),
    close: provider.close.bind(provider),
    dispose: provider.dispose.bind(provider),
    openPendingRemoteSegmentStore: provider.openPendingRemoteSegmentStore.bind(provider),
    openSyncBatchStatusStore: provider.openSyncBatchStatusStore.bind(provider),
    openGraph: async (requestedNamespace, accessContext) => {
      const graph = await provider.openGraph(requestedNamespace, accessContext);
      return graphWithGatedCommit(graph, gate);
    },
  };
}

function providerWithCompletionFailures(
  provider: InMemoryProvider,
  shouldFail: (
    attempt: number,
    input: Parameters<PendingRemoteSegmentStore['completeSegment']>[0],
  ) => boolean,
): ConflictProvider {
  let completionAttempts = 0;
  return {
    documentScope: provider.documentScope,
    accessContext: provider.accessContext,
    capabilities: provider.capabilities,
    readGraphRegistry: provider.readGraphRegistry.bind(provider),
    initializeGraph: provider.initializeGraph.bind(provider),
    scanDocumentIntegrity: provider.scanDocumentIntegrity.bind(provider),
    close: provider.close.bind(provider),
    dispose: provider.dispose.bind(provider),
    openGraph: provider.openGraph.bind(provider),
    openSyncBatchStatusStore: provider.openSyncBatchStatusStore.bind(provider),
    openPendingRemoteSegmentStore: async (namespace) => {
      const store = await provider.openPendingRemoteSegmentStore(namespace);
      const wrapped: PendingRemoteSegmentStore = {
        namespace: store.namespace,
        reserveSegment: (input) => store.reserveSegment(input),
        readBySegmentId: (segmentId) => store.readBySegmentId(segmentId),
        readByIdempotencyKey: (idempotencyKey) => store.readByIdempotencyKey(idempotencyKey),
        listByState: (state) => store.listByState(state),
        completeSegment: (input) => {
          completionAttempts += 1;
          if (!shouldFail(completionAttempts, input)) return store.completeSegment(input);
          const failed: Awaited<ReturnType<PendingRemoteSegmentStore['completeSegment']>> = {
            status: 'failed',
            record: null,
            diagnostics: [
              {
                code: 'VERSION_PROVIDER_FAILED',
                message: 'Injected pending remote completion failure.',
                recoverability: 'retry',
              },
            ],
          };
          return Promise.resolve(failed);
        },
      };
      return wrapped;
    },
  };
}

function graphWithOneCommitConflict(
  graph: VersionGraphStore,
  namespace: VersionGraphNamespace,
): VersionGraphStore {
  let advanced = false;
  return {
    namespace: graph.namespace,
    initializeGraph: (input) => graph.initializeGraph(input),
    mergeCommit: (input) => graph.mergeCommit(input),
    fastForwardRef: (input) => graph.fastForwardRef(input),
    putObjects: (batch) => graph.putObjects(batch),
    readCommit: (commitId) => graph.readCommit(commitId),
    getObjectRecord: <TPayload>(ref) => graph.getObjectRecord<TPayload>(ref),
    hasObject: (ref) => graph.hasObject(ref),
    readHead: () => graph.readHead(),
    readRef: (name) => graph.readRef(name),
    createBranch: (input) => graph.createBranch(input),
    readBranch: (input) => graph.readBranch(input),
    listBranches: (input) => graph.listBranches(input),
    fastForwardBranch: (input) => graph.fastForwardBranch(input),
    getHead: () => graph.getHead(),
    listCommits: (options) => graph.listCommits(options),
    readCommitClosure: (commitId) => graph.readCommitClosure(commitId),
    commit: async (input) => {
      if (!advanced) {
        advanced = true;
        const head = await expectReadHeadSuccess(graph);
        await graph.commit({
          ...(await conflictCommitContent(namespace)),
          expectedHeadCommitId: head.commitId,
          expectedTargetRefVersion: head.revision,
          parentCommitIds: [head.commitId],
        });
      }
      return graph.commit(input);
    },
  };
}

function graphWithGatedCommit(
  graph: VersionGraphStore,
  gate: { readonly beforeCommit: () => Promise<void> },
): VersionGraphStore {
  return {
    namespace: graph.namespace,
    initializeGraph: (input) => graph.initializeGraph(input),
    mergeCommit: (input) => graph.mergeCommit(input),
    fastForwardRef: (input) => graph.fastForwardRef(input),
    putObjects: (batch) => graph.putObjects(batch),
    readCommit: (commitId) => graph.readCommit(commitId),
    getObjectRecord: <TPayload>(ref) => graph.getObjectRecord<TPayload>(ref),
    hasObject: (ref) => graph.hasObject(ref),
    readHead: () => graph.readHead(),
    readRef: (name) => graph.readRef(name),
    createBranch: (input) => graph.createBranch(input),
    readBranch: (input) => graph.readBranch(input),
    listBranches: (input) => graph.listBranches(input),
    fastForwardBranch: (input) => graph.fastForwardBranch(input),
    getHead: () => graph.getHead(),
    listCommits: (options) => graph.listCommits(options),
    readCommitClosure: (commitId) => graph.readCommitClosure(commitId),
    commit: async (input) => {
      await gate.beforeCommit();
      return graph.commit(input);
    },
  };
}

async function conflictCommitContent(namespace: VersionGraphNamespace) {
  return {
    snapshotRootRecord: await objectRecord(
      'workbook.snapshotRoot.v1',
      { label: 'conflict', sheets: [] },
      namespace,
    ),
    semanticChangeSetRecord: await objectRecord(
      'workbook.semanticChangeSet.v1',
      { label: 'conflict', changes: [] },
      namespace,
    ),
    author: AUTHOR,
    createdAt: '2026-06-21T00:00:09.000Z',
    completenessDiagnostics: [],
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let start!: () => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  const started = new Promise<void>((promiseResolve) => {
    start = promiseResolve;
  });
  return { promise, resolve, started, start };
}
