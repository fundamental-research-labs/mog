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
import type {
  VersionObjectType,
  WorkbookCommitId,
} from '../../../document/version-store/object-digest';
import {
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
  type VersionGraphStore,
  type createInMemoryVersionStoreProvider,
} from '../../../document/version-store/provider';
import type { RefVersion } from '../../../document/version-store/ref-store';
import {
  syncBatchStatusKeyMaterialForOperationContext,
  type SyncBatchStatusTerminal,
} from '../../../document/version-store/sync-batch-status-store';

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
export const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};
const VERSION_AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};
const PROMOTION_POLICY = {
  decisions: [
    { capability: 'version:remotePromote', decision: 'allowed' },
    { capability: 'version:provenance', decision: 'allowed' },
  ],
} as const;
export const PROVENANCE_TRUTH_SERVICE = {
  vc09ProvenanceTruthComplete: true,
  vc09ProvenanceTruth: {
    schemaVersion: 1,
    source: 'provider-backed-sync-provenance',
    vc09ProvenanceTruthComplete: true,
    requirements: [],
  },
} as const;
export const SOURCE_BATCH_ID = `batch-digest:sha256:${'4'.repeat(64)}`;

type InMemoryProvider = ReturnType<typeof createInMemoryVersionStoreProvider>;

export type PendingSegmentFixture = {
  readonly input: ReservePendingRemoteSegmentInput;
  readonly objectRecords: readonly VersionObjectRecord<unknown>[];
};

export function createMockEventBus() {
  return {
    on: jest.fn().mockReturnValue(() => undefined),
    onAll: jest.fn().mockReturnValue(() => undefined),
    onMany: jest.fn(),
    emit: jest.fn(),
    emitBatch: jest.fn(),
    clear: jest.fn(),
  };
}

export function createMockCtx(overrides: Record<string, unknown> = {}) {
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

export function createPromotionAuthorizedCtx(overrides: Record<string, unknown> = {}) {
  return createMockCtx({ policySnapshot: PROMOTION_POLICY, ...overrides });
}

export function createWorkbook(overrides?: Partial<WorkbookConfig>) {
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

export function createPromotionAuthorizedWorkbook(
  versioning: NonNullable<WorkbookConfig['versioning']>,
) {
  return createWorkbook({
    ctx: createPromotionAuthorizedCtx(),
    versioning: {
      provenanceTruthService: PROVENANCE_TRUTH_SERVICE,
      ...versioning,
    },
  });
}

export async function pendingSegmentFixture(
  namespace: VersionGraphNamespace,
  options: {
    readonly payloadHash?: string;
    readonly sourceBatch?: boolean;
    readonly updateId?: string;
    readonly collaboration?: Partial<PendingRemoteSegmentOperationContext['collaboration']>;
  } = {},
): Promise<PendingSegmentFixture> {
  const operationContext = syncOperationContext(options);
  const keys = await pendingRemoteSegmentKeyMaterialForOperationContext(operationContext);
  const snapshotRootRecord = await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
    snapshotId: 'remote-boundary-snapshot-1',
    sheets: [],
  });
  const semanticChangeSetRecord = await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
    schemaVersion: 1,
    changes: [{ id: 'remote-change-1' }],
  });
  const mutationSegmentRecord = await objectRecord(namespace, 'workbook.mutationSegment.v1', {
    segmentId: 'remote-segment-1',
    domainId: 'runtime-diagnostics',
  });

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

export async function initializeProvider(
  provider: {
    initializeGraph(input: VersionGraphInitializeInput): Promise<VersionGraphInitializeResult>;
  },
  graphId = 'graph-1',
): Promise<VersionGraphNamespace> {
  const initialized = await provider.initializeGraph(await initializeInput(graphId));
  expectInitializeSuccess(initialized);
  return namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
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

export async function markSyncBatchTerminal(
  provider: InMemoryProvider,
  operationContext: PendingRemoteSegmentOperationContext,
  terminal: SyncBatchStatusTerminal,
): Promise<string> {
  const store = await provider.openSyncBatchStatusStore();
  const identityInput = syncBatchIdentityInputForOperationContext(operationContext);
  const keyMaterial = await syncBatchStatusKeyMaterialForOperationContext(
    operationContext,
    identityInput,
  );
  await expect(
    store.reserveBatchStatus({
      batchStatusId: keyMaterial.batchStatusId,
      operationContext,
      ...identityInput,
      createdAt: operationContext.createdAt,
    }),
  ).resolves.toMatchObject({ status: 'reserved' });
  await expect(
    store.completeBatchStatus({
      batchStatusId: keyMaterial.batchStatusId,
      payloadHash: operationContext.collaboration.payloadHash,
      ...identityInput,
      completedAt: '2026-06-21T00:00:05.000Z',
      terminal,
    }),
  ).resolves.toMatchObject({ status: 'completed' });
  return keyMaterial.batchStatusId;
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

export async function expectBlockedPromotion(
  result: any,
  graph: VersionGraphStore,
  store: PendingRemoteSegmentStore,
  fixture: PendingSegmentFixture,
  headBefore: { readonly commitId: WorkbookCommitId; readonly revision: RefVersion },
  reason: string,
): Promise<void> {
  expect(result).toMatchObject({
    ok: true,
    value: {
      status: 'failed',
      promotedSegmentIds: [],
      commitIds: [],
      skipped: [{ segmentId: fixture.input.pendingRemoteSegmentId, reason }],
      diagnostics: [expect.objectContaining({ reason })],
    },
  });
  await expectGraphHead(graph, headBefore);
  await expect(store.readBySegmentId(fixture.input.pendingRemoteSegmentId)).resolves.toMatchObject({
    status: 'found',
    record: { state: 'pending' },
  });
}

export function expectSingleCommit(commitIds: readonly WorkbookCommitId[]): WorkbookCommitId {
  expect(commitIds).toHaveLength(1);
  const commitId = commitIds[0];
  if (commitId === undefined) throw new Error('expected single commit id');
  return commitId;
}

export function providerWithStaleHeadCommit(
  provider: InMemoryProvider,
  namespace: VersionGraphNamespace,
) {
  return new Proxy(provider, {
    get(target, property) {
      if (property === 'openGraph') {
        return async (...args: Parameters<InMemoryProvider['openGraph']>) =>
          graphWithStaleHeadCommit(await target.openGraph(...args), namespace);
      }
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as InMemoryProvider;
}

function syncOperationContext(
  options: {
    readonly payloadHash?: string;
    readonly sourceBatch?: boolean;
    readonly updateId?: string;
    readonly collaboration?: Partial<PendingRemoteSegmentOperationContext['collaboration']>;
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
      authorityRef: 'authority-1',
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
      ...(options.sourceBatch
        ? {
            batchId: SOURCE_BATCH_ID,
            subUpdateIndex: 0,
            subUpdateCount: 1,
          }
        : {}),
      validationDiagnosticCount: 0,
      ...options.collaboration,
    },
  };
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

function syncBatchIdentityInputForOperationContext(
  operationContext: PendingRemoteSegmentOperationContext,
): {
  readonly batchId?: string;
} {
  const { collaboration } = operationContext;
  return collaboration.batchId === undefined
    ? {}
    : {
        batchId: collaboration.batchId,
      };
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

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected version graph initialize success: ${result.diagnostics[0]?.code}`);
  }
}

function graphWithStaleHeadCommit(graph: VersionGraphStore, namespace: VersionGraphNamespace) {
  let advanced = false;
  return new Proxy(graph, {
    get(target, property) {
      if (property === 'commit') {
        return async (input: Parameters<VersionGraphStore['commit']>[0]) => {
          if (!advanced) {
            advanced = true;
            await advanceHeadForStalePromotion(target, namespace);
          }
          return target.commit(input);
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as VersionGraphStore;
}

async function advanceHeadForStalePromotion(
  graph: VersionGraphStore,
  namespace: VersionGraphNamespace,
) {
  const head = await expectReadHeadSuccess(graph);
  await graph.commit({
    snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
      label: 'stale-head',
      sheets: [],
    }),
    semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
      label: 'stale-head',
      changes: [],
    }),
    author: VERSION_AUTHOR,
    createdAt: '2026-06-21T00:00:09.000Z',
    completenessDiagnostics: [],
    expectedHeadCommitId: head.commitId,
    expectedTargetRefVersion: head.revision,
    parentCommitIds: [head.commitId],
  });
}
