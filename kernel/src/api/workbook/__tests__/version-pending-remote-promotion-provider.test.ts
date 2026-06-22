import { jest } from '@jest/globals';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { WorkbookConfig } from '../types';
import {
  pendingRemoteSegmentKeyMaterialForOperationContext,
  reservePersistedPendingRemoteSegment,
  type PendingRemoteSegmentOperationContext,
  type PendingRemoteSegmentStore,
  type ReservePendingRemoteSegmentInput,
} from '../../../document/version-store/pending-remote-segment-store';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import type { VersionObjectType, WorkbookCommitId } from '../../../document/version-store/object-digest';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
  type VersionGraphStore,
} from '../../../document/version-store/provider';
import type { RefVersion } from '../../../document/version-store/ref-store';
import { syncBatchStatusKeyMaterialForOperationContext } from '../../../document/version-store/sync-batch-status-store';

const createCheckpointManagerMock = jest.fn();
const worksheetImplMock = jest.fn().mockImplementation((sheetId: string) => ({
  _sheetId: sheetId,
  _syncMetadata: jest.fn(),
  dispose: jest.fn(),
}));

jest.unstable_mockModule('../../worksheet/worksheet-impl', () => ({
  WorksheetImpl: worksheetImplMock,
}));

jest.unstable_mockModule('../../../services/checkpoint', () => ({
  createCheckpointManager: createCheckpointManagerMock,
}));

jest.unstable_mockModule('../../namespaces/records', () => ({
  get: jest.fn(),
  query: jest.fn(),
  getFieldValue: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  del: jest.fn(),
}));

jest.unstable_mockModule('../../../bridges/compute/compute-bridge', () => ({
  ComputeBridge: jest.fn(),
  createComputeBridge: jest.fn(),
  createComputeBridgeFromTransport: jest.fn(),
  extractMutationData: jest.fn(),
  identityFormulaToWire: jest.fn(),
  rustSchemaResolveEditor: jest.fn(),
  wireTableToTableConfig: jest.fn(),
  wireToIdentityFormula: jest.fn(),
  __esModule: true,
}));

const { WorkbookImpl } = await import('../workbook-impl');

const CREATED_AT = '2026-06-20T00:00:00.000Z';
const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};
const VERSION_AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};
type InMemoryProvider = ReturnType<typeof createInMemoryVersionStoreProvider>;

describe('WorkbookVersion pending remote promotion provider facade', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('attaches a provider-backed pending remote promotion service', () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const ctx = createMockCtx();

    createWorkbook({
      ctx,
      versioning: { provider },
    });

    expect(ctx.versioning).toMatchObject({
      provider,
      pendingRemotePromotionService: {
        promotePendingRemoteSegments: expect.any(Function),
      },
      promotePendingRemoteSegments: expect.any(Function),
    });
  });

  it('promotes a seeded pending remote segment through wb.version.promotePendingRemote', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const namespace = await initializeProvider(provider);
    const graph = await provider.openGraph(namespace);
    const store = await provider.openPendingRemoteSegmentStore(namespace);
    const fixture = await pendingSegmentFixture(namespace);
    await persistAndReservePendingSegment(graph, store, fixture);
    const wb = createWorkbook({ versioning: { provider } });

    const result = await wb.version.promotePendingRemote();

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: 'success',
        promotedSegmentIds: [fixture.input.pendingRemoteSegmentId],
        skipped: [],
        diagnostics: [],
      },
    });
    if (!result.ok) throw new Error(`expected promotion success: ${result.error.code}`);
    const commitId = expectSingleCommit(result.value.commitIds);
    await expect(graph.readCommit(commitId)).resolves.toMatchObject({
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
          terminal: { status: 'promoted', commitId },
        },
      },
    );
  });

  it('returns a failed VersionResult when no promotion service is attached', async () => {
    const wb = createWorkbook();

    await expect(wb.version.promotePendingRemote()).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.promotePendingRemote',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_PENDING_REMOTE_PROMOTION_SERVICE_UNAVAILABLE',
            data: expect.objectContaining({
              redacted: true,
              payload: expect.objectContaining({ operation: 'promotePendingRemote' }),
            }),
          }),
        ],
      },
    });
  });

  it('blocks failed sync batches through wb.version.promotePendingRemote', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const namespace = await initializeProvider(provider, 'graph-failed-batch');
    const graph = await provider.openGraph(namespace);
    const store = await provider.openPendingRemoteSegmentStore(namespace);
    const fixture = await pendingSegmentFixture(namespace);
    await persistAndReservePendingSegment(graph, store, fixture);
    await markSyncBatchFailed(provider, fixture.input.operationContext);
    const headBefore = await expectReadHeadSuccess(graph);
    const wb = createWorkbook({ versioning: { provider } });

    const result = await wb.version.promotePendingRemote();

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: 'failed',
        promotedSegmentIds: [],
        commitIds: [],
        skipped: [
          {
            segmentId: fixture.input.pendingRemoteSegmentId,
            reason: 'batch-status-terminal',
          },
        ],
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_PENDING_REMOTE_PROMOTION_BATCH_BLOCKED',
          }),
        ],
      },
    });
    await expectGraphHead(graph, headBefore);
    await expect(store.readBySegmentId(fixture.input.pendingRemoteSegmentId)).resolves.toMatchObject(
      {
        status: 'found',
        record: { state: 'pending' },
      },
    );
  });
});

function createMockEventBus() {
  return {
    on: jest.fn().mockReturnValue(() => undefined),
    onAll: jest.fn().mockReturnValue(() => undefined),
    onMany: jest.fn(),
    emit: jest.fn(),
    emitBatch: jest.fn(),
    clear: jest.fn(),
  };
}

function createMockCtx(overrides: Record<string, unknown> = {}) {
  return {
    computeBridge: {},
    writeGate: {
      assertWritable: jest.fn(),
    },
    services: {
      undo: {},
    },
    floatingObjectManager: {
      dispose: jest.fn(),
    },
    ...overrides,
  } as any;
}

function createWorkbook(overrides?: Partial<WorkbookConfig>) {
  createCheckpointManagerMock.mockReturnValue({
    create: jest.fn(),
    createSync: jest.fn(),
    restore: jest.fn(),
    list: jest.fn().mockReturnValue([]),
    get: jest.fn(),
    delete: jest.fn(),
    clear: jest.fn(),
  });

  return new WorkbookImpl({
    ctx: createMockCtx(),
    eventBus: createMockEventBus(),
    ...overrides,
  });
}

type PendingSegmentFixture = {
  readonly input: ReservePendingRemoteSegmentInput;
  readonly objectRecords: readonly VersionObjectRecord<unknown>[];
};

async function pendingSegmentFixture(
  namespace: VersionGraphNamespace,
  options: {
    readonly payloadHash?: string;
    readonly updateId?: string;
  } = {},
): Promise<PendingSegmentFixture> {
  const operationContext = syncOperationContext(options);
  const keys = await pendingRemoteSegmentKeyMaterialForOperationContext(operationContext);
  const snapshotRootRecord = await objectRecord(
    namespace,
    'workbook.snapshotRoot.v1',
    { snapshotId: 'remote-boundary-snapshot-1', sheets: [] },
  );
  const semanticChangeSetRecord = await objectRecord(
    namespace,
    'workbook.semanticChangeSet.v1',
    { schemaVersion: 1, changes: [{ id: 'remote-change-1' }] },
  );
  const mutationSegmentRecord = await objectRecord(
    namespace,
    'workbook.mutationSegment.v1',
    {
      segmentId: 'remote-segment-1',
      domainId: 'runtime-diagnostics',
    },
  );

  return {
    input: {
      pendingRemoteSegmentId: keys.pendingRemoteSegmentId,
      idempotencyKey: keys.idempotencyKey,
      operationContext,
      mutationSegmentDigest: mutationSegmentRecord.digest,
      snapshotRootDigest: snapshotRootRecord.digest,
      semanticChangeSetDigest: semanticChangeSetRecord.digest,
      createdAt: operationContext.createdAt,
    },
    objectRecords: [snapshotRootRecord, semanticChangeSetRecord, mutationSegmentRecord],
  };
}

function syncOperationContext(
  options: {
    readonly payloadHash?: string;
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
    createdAt: '2026-06-21T00:00:01.000Z',
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

async function initializeProvider(
  provider: {
    initializeGraph(input: VersionGraphInitializeInput): Promise<VersionGraphInitializeResult>;
  },
  graphId = 'graph-1',
): Promise<VersionGraphNamespace> {
  const initialized = await provider.initializeGraph(await initializeInput(graphId));
  expectInitializeSuccess(initialized);
  return namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
}

async function initializeInput(graphId: string): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label: 'root',
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        label: 'root',
        changes: [],
      }),
      author: VERSION_AUTHOR,
      createdAt: CREATED_AT,
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
  namespace: VersionGraphNamespace,
  objectType: VersionObjectType,
  payload: unknown,
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

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected version graph initialize success: ${result.diagnostics[0]?.code}`);
  }
}
