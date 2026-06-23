import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { VersionObjectType, WorkbookCommitId } from '../object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';
import {
  pendingRemoteSegmentKeyMaterialForOperationContext,
  reservePersistedPendingRemoteSegment,
  type PendingRemoteSegmentOperationContext,
  type PendingRemoteSegmentStore,
  type ReservePendingRemoteSegmentInput,
} from '../pending-remote-segment-store';
import {
  namespaceForDocumentScope,
  type createInMemoryVersionStoreProvider,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
  type VersionGraphStore,
  type VersionStoreProvider,
} from '../provider';
import type { RefVersion } from '../ref-store';
import { syncBatchStatusKeyMaterialForOperationContext } from '../sync-batch-status-store';

export const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};

const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

export const PROMOTION_NOW = new Date('2026-06-21T00:10:00.000Z');

type InMemoryProvider = ReturnType<typeof createInMemoryVersionStoreProvider>;
type ConflictProvider = VersionStoreProvider &
  Pick<InMemoryProvider, 'openPendingRemoteSegmentStore' | 'openSyncBatchStatusStore'>;

export type PendingSegmentFixture = {
  readonly input: ReservePendingRemoteSegmentInput;
  readonly objectRecords: readonly VersionObjectRecord<unknown>[];
};

export async function pendingSegmentFixture(
  namespace: VersionGraphNamespace,
  options: {
    readonly createdAt?: string;
    readonly authorityRef?: string | null;
    readonly collaboration?: Partial<PendingRemoteSegmentOperationContext['collaboration']>;
    readonly epoch?: string | null;
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
    readonly authorityRef?: string | null;
    readonly collaboration?: Partial<PendingRemoteSegmentOperationContext['collaboration']>;
    readonly epoch?: string | null;
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
      ...(options.authorityRef === null
        ? {}
        : { authorityRef: options.authorityRef ?? 'authority-1' }),
      roomId: 'room-1',
      ...(options.epoch === null ? {} : { epoch: options.epoch ?? 'epoch-1' }),
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
      ...options.collaboration,
    },
  };
}

export async function initializeProvider(
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

export async function objectRecord(
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

export async function expectReadHeadSuccess(graph: VersionGraphStore): Promise<{
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

export async function expectGraphHead(
  graph: VersionGraphStore,
  expected: { readonly commitId: WorkbookCommitId; readonly revision: RefVersion },
): Promise<void> {
  const result = await expectReadHeadSuccess(graph);
  expect(result).toEqual(expected);
}

export function expectSingleCommit(commitIds: readonly WorkbookCommitId[]): WorkbookCommitId {
  expect(commitIds).toHaveLength(1);
  const commitId = commitIds[0];
  if (commitId === undefined) throw new Error('expected single commit id');
  return commitId;
}

export function providerWithCommitConflict(
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

export function providerWithGatedCommit(
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

export function providerWithCompletionFailures(
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

export function deferred<T>() {
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
