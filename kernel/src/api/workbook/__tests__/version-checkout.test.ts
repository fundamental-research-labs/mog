import { jest } from '@jest/globals';

import type { VersionAuthor } from '@mog-sdk/contracts/versioning';
import type { WorkbookConfig } from '../types';
import {
  VERSION_GRAPH_MAIN_REF,
  type VersionGraphWriteResult,
} from '../../../document/version-store/graph-store';
import {
  createCheckoutMaterializationService,
} from '../../../document/version-store/checkout-service';
import {
  createInMemoryWorkbookCommitStore,
  type CreateWorkbookCommitResult,
  type InMemoryWorkbookCommitStore,
} from '../../../document/version-store/commit-store';
import {
  InMemoryVersionObjectStore,
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import type { VersionObjectType } from '../../../document/version-store/object-digest';
import {
  pendingRemoteSegmentKeyMaterialForOperationContext,
  reservePersistedPendingRemoteSegment,
  type PendingRemoteSegmentOperationContext,
  type PendingRemoteSegmentStore,
  type ReservePendingRemoteSegmentInput,
} from '../../../document/version-store/pending-remote-segment-store';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
  type VersionGraphStore,
} from '../../../document/version-store/provider';
import { createVersionProviderWriteActivityTracker } from '../../../document/version-store/provider-write-activity';

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

const NAMESPACE: VersionGraphNamespace = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  graphId: 'graph-1',
  principalScope: 'principal-1',
};
const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};
const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};

type Stores = {
  readonly objectStore: InMemoryVersionObjectStore;
  readonly commitStore: InMemoryWorkbookCommitStore;
};

function createMockEventBus() {
  const allHandlers: Array<(event: unknown) => void> = [];
  return {
    on: jest.fn().mockReturnValue(() => undefined),
    onAll: jest.fn((handler?: unknown) => {
      if (typeof handler === 'function') {
        allHandlers.push(handler as (event: unknown) => void);
      }
      return () => undefined;
    }),
    onMany: jest.fn(),
    emit: jest.fn((event: unknown) => {
      allHandlers.forEach((handler) => handler(event));
    }),
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

function createStores(): Stores {
  const objectStore = new InMemoryVersionObjectStore(NAMESPACE);
  return {
    objectStore,
    commitStore: createInMemoryWorkbookCommitStore(objectStore),
  };
}

function expectCreateSuccess(
  result: CreateWorkbookCommitResult,
): asserts result is Extract<CreateWorkbookCommitResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected commit create success: ${result.diagnostics[0]?.code}`);
  }
}

async function objectRecord(
  stores: Stores,
  objectType: VersionObjectType,
  payload: unknown,
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(stores.objectStore.namespace, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload,
  });
}

async function scopedObjectRecord(
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
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.code}`);
  }
}

function expectGraphWriteSuccess(
  result: VersionGraphWriteResult,
): asserts result is Extract<VersionGraphWriteResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected graph write success: ${result.diagnostics[0]?.code}`);
  }
}

async function initializeInput(
  graphId: string,
  label: string,
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      snapshotRootRecord: await scopedObjectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label,
        sheets: [],
      }),
      semanticChangeSetRecord: await scopedObjectRecord(
        namespace,
        'workbook.semanticChangeSet.v1',
        {
          label,
          changes: [],
        },
      ),
      author: AUTHOR,
      createdAt: '2026-06-20T00:00:00.000Z',
      completenessDiagnostics: [],
    },
  };
}

async function createCommit(stores: Stores, label: string) {
  const snapshotRootRecord = await objectRecord(stores, 'workbook.snapshotRoot.v1', {
    label,
    sheets: [],
  });
  const semanticChangeSetRecord = await objectRecord(stores, 'workbook.semanticChangeSet.v1', {
    label,
    changes: [],
  });
  const created = await stores.commitStore.createWorkbookCommit({
    documentId: NAMESPACE.documentId,
    parentCommitIds: [],
    snapshotRootRecord,
    semanticChangeSetRecord,
    mutationSegmentRecords: [],
    author: AUTHOR,
    createdAt: '2026-06-20T00:00:00.000Z',
    completenessDiagnostics: [],
  });
  expectCreateSuccess(created);
  return created.commit;
}

function plannedCheckoutResult(commitId: string) {
  return {
    ok: true,
    materialization: 'planned',
    plan: {
      strategy: 'fullSnapshot',
      commitId,
      parentCommitIds: [],
      resolvedTarget: { kind: 'commit', commitId },
      requiredDependencies: [
        { role: 'snapshotRoot', objectType: 'workbook.snapshotRoot.v1' },
      ],
    },
    diagnostics: [],
    mutationGuarantee: 'no-workbook-mutation',
  };
}

type PendingSegmentFixture = {
  readonly input: ReservePendingRemoteSegmentInput;
  readonly objectRecords: readonly VersionObjectRecord<unknown>[];
};

async function pendingSegmentFixture(
  namespace: VersionGraphNamespace,
): Promise<PendingSegmentFixture> {
  const operationContext = syncOperationContext();
  const keys = await pendingRemoteSegmentKeyMaterialForOperationContext(operationContext);
  const snapshotRootRecord = await scopedObjectRecord(
    namespace,
    'workbook.snapshotRoot.v1',
    { snapshotId: 'remote-boundary-snapshot-1', sheets: [] },
  );
  const semanticChangeSetRecord = await scopedObjectRecord(
    namespace,
    'workbook.semanticChangeSet.v1',
    { schemaVersion: 1, changes: [{ id: 'remote-change-1' }] },
  );
  const mutationSegmentRecord = await scopedObjectRecord(
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

function syncOperationContext(): PendingRemoteSegmentOperationContext {
  return {
    operationId: 'sync:providerLiveInbound:remote-update-1',
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
      updateId: 'remote-update-1',
      sequence: '7',
      payloadHash: '3'.repeat(64),
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

describe('WorkbookVersion checkout facade', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('degrades without fabricating workbook state when no checkout service is attached', async () => {
    const wb = createWorkbook();

    await expect(
      wb.version.checkout({ kind: 'commit', id: `commit:sha256:${'1'.repeat(64)}` }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_CHECKOUT_SERVICE_UNAVAILABLE',
            data: expect.objectContaining({
              recoverability: 'unsupported',
              redacted: true,
              payload: expect.objectContaining({ targetKind: 'commit' }),
            }),
          }),
        ],
      },
    });
  });

  it('delegates through an attached CheckoutMaterializationService and returns a public plan', async () => {
    const stores = createStores();
    const commit = await createCommit(stores, 'root');
    const checkoutService = createCheckoutMaterializationService({
      commitReader: stores.commitStore,
      dependencyReader: {
        hasDependency: (dependency) => stores.objectStore.hasObject(dependency),
      },
    });
    const planCheckout = jest.spyOn(checkoutService, 'planCheckout');
    const wb = createWorkbook({
      ctx: createMockCtx({
        versioning: {
          checkoutService,
        },
      }),
    });

    const result = await wb.version.checkout({ kind: 'commit', id: commit.id });

    expect(planCheckout).toHaveBeenCalledWith({ target: 'commit', commitId: commit.id });
    expect(result).toMatchObject({
      ok: true,
      value: {
        status: 'success',
        materialization: 'planned',
        mutationGuarantee: 'no-workbook-mutation',
        plan: {
          strategy: 'fullSnapshot',
          commitId: commit.id,
          parentCommitIds: [],
          target: {
            kind: 'commit',
            commitId: commit.id,
          },
          requiredDependencies: [
            { role: 'snapshotRoot', objectType: 'workbook.snapshotRoot.v1' },
            { role: 'semanticChangeSet', objectType: 'workbook.semanticChangeSet.v1' },
          ],
          requiredDependencyCount: 2,
        },
        diagnostics: [],
      },
    });
    expect(JSON.stringify(result)).not.toContain('digest');
  });

  it('rejects dirty checkout before calling the attached checkout service', async () => {
    const eventBus = createMockEventBus();
    const checkout = jest.fn();
    const planCheckout = jest.fn();
    const wb = createWorkbook({
      eventBus,
      ctx: createMockCtx({
        versioning: {
          checkoutService: { checkout, planCheckout },
        },
      }),
    });

    eventBus.emit({ type: 'test:dirty' });
    const result = await wb.version.checkout({
      kind: 'commit',
      id: `commit:sha256:${'3'.repeat(64)}`,
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_CHECKOUT_DIRTY_WORKING_STATE',
            data: expect.objectContaining({ recoverability: 'none', redacted: true }),
          }),
        ],
      },
    });
    expect(checkout).not.toHaveBeenCalled();
    expect(planCheckout).not.toHaveBeenCalled();
  });

  it('holds the workbook checkout write fence while the service materializes', async () => {
    const commitId = `commit:sha256:${'5'.repeat(64)}`;
    let wb: ReturnType<typeof createWorkbook>;
    const observedStatusRevisions: string[] = [];
    const checkout = jest.fn(async () => {
      const status = await wb.version.getSurfaceStatus();
      observedStatusRevisions.push(status.dirty.statusRevision);
      return plannedCheckoutResult(commitId);
    });
    wb = createWorkbook({
      ctx: createMockCtx({
        versioning: {
          checkoutService: { checkout },
        },
      }),
    });

    const beforeStatus = await wb.version.getSurfaceStatus();
    expect(beforeStatus.dirty.statusRevision).toContain('checkout:idle');
    expect(beforeStatus.dirty.checkoutSafe).toBe(true);

    await expect(wb.version.checkout({ kind: 'commit', id: commitId })).resolves.toMatchObject({
      ok: true,
      value: {
        materialization: 'planned',
        mutationGuarantee: 'no-workbook-mutation',
      },
    });

    expect(observedStatusRevisions).toEqual([expect.stringContaining('checkout:busy')]);
    const afterStatus = await wb.version.getSurfaceStatus();
    expect(afterStatus.dirty.statusRevision).toContain('checkout:idle');
    expect(afterStatus.dirty.checkoutSafe).toBe(true);
  });

  it('releases the workbook checkout write fence when the service throws', async () => {
    const commitId = `commit:sha256:${'6'.repeat(64)}`;
    const checkout = jest
      .fn()
      .mockImplementationOnce(async () => {
        throw new Error('provider unavailable');
      })
      .mockImplementationOnce(async () => plannedCheckoutResult(commitId));
    const wb = createWorkbook({
      ctx: createMockCtx({
        versioning: {
          checkoutService: { checkout },
        },
      }),
    });

    await expect(wb.version.checkout({ kind: 'commit', id: commitId })).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_CHECKOUT_PROVIDER_ERROR',
          }),
        ],
      },
    });
    const afterFailureStatus = await wb.version.getSurfaceStatus();
    expect(afterFailureStatus.dirty.statusRevision).toContain('checkout:idle');
    expect(afterFailureStatus.dirty.checkoutSafe).toBe(true);

    await expect(wb.version.checkout({ kind: 'commit', id: commitId })).resolves.toMatchObject({
      ok: true,
      value: {
        materialization: 'planned',
      },
    });
    expect(checkout).toHaveBeenCalledTimes(2);
  });

  it('fails closed before checkout service calls when the write fence cannot be acquired', async () => {
    const checkout = jest.fn();
    const wb = createWorkbook({
      ctx: createMockCtx({
        writeGate: {
          assertWritable: jest.fn(() => {
            throw new Error('read only');
          }),
        },
        versioning: {
          checkoutService: { checkout },
        },
      }),
    });

    await expect(
      wb.version.checkout({ kind: 'commit', id: `commit:sha256:${'7'.repeat(64)}` }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_CHECKOUT_WRITE_FENCE_UNAVAILABLE',
            data: expect.objectContaining({
              payload: expect.objectContaining({ reason: 'writeGateRejected' }),
            }),
          }),
        ],
      },
    });
    expect(checkout).not.toHaveBeenCalled();
  });

  it('blocks checkout while remote sync changes are waiting for promotion', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const namespace = namespaceForDocumentScope(
      DOCUMENT_SCOPE,
      'graph-pending-remote-checkout',
    );
    const initialized = await provider.initializeGraph(
      await initializeInput('graph-pending-remote-checkout', 'root'),
    );
    expectInitializeSuccess(initialized);
    const graph = await provider.openGraph(namespace);
    const store = await provider.openPendingRemoteSegmentStore(namespace);
    const fixture = await pendingSegmentFixture(namespace);
    await persistAndReservePendingSegment(graph, store, fixture);
    const wb = createWorkbook({ versioning: { provider } });

    await expect(wb.version.getSurfaceStatus()).resolves.toMatchObject({
      dirty: {
        pendingProviderWrites: true,
        checkoutSafe: false,
        unsafeReasons: [
          expect.objectContaining({
            code: 'version.surfaceStatus.pendingProviderWrites',
            data: expect.objectContaining({ pendingRemoteSegmentCount: 1 }),
          }),
        ],
      },
    });

    await expect(wb.version.checkout({ kind: 'head' })).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_CHECKOUT_PENDING_PROVIDER_WRITES',
            data: expect.objectContaining({
              payload: expect.objectContaining({
                reason: 'pendingProviderWrites',
                pendingRemoteSegmentCount: 1,
              }),
            }),
          }),
        ],
      },
    });
  });

  it('blocks checkout while provider write activity is in flight', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(
      await initializeInput('graph-active-provider-writes', 'root'),
    );
    expectInitializeSuccess(initialized);
    const providerWriteActivityTracker = createVersionProviderWriteActivityTracker();
    let releaseActivity!: () => void;
    const activityHold = new Promise<void>((resolve) => {
      releaseActivity = resolve;
    });
    const inFlightActivity = providerWriteActivityTracker.trackRemoteSyncApply(
      async () => activityHold,
    );
    const wb = createWorkbook({
      versioning: {
        provider,
        providerWriteActivityTracker,
      },
    });

    try {
      await expect(wb.version.getSurfaceStatus()).resolves.toMatchObject({
        dirty: {
          pendingProviderWrites: true,
          checkoutSafe: false,
          unsafeReasons: [
            expect.objectContaining({
              code: 'version.surfaceStatus.pendingProviderWrites',
              data: expect.objectContaining({ remoteSyncApplyActiveCount: 1 }),
            }),
          ],
        },
      });

      await expect(wb.version.checkout({ kind: 'head' })).resolves.toMatchObject({
        ok: false,
        error: {
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_CHECKOUT_PENDING_PROVIDER_WRITES',
              data: expect.objectContaining({
                payload: expect.objectContaining({
                  reason: 'pendingProviderWrites',
                  remoteSyncApplyActiveCount: 1,
                }),
              }),
            }),
          ],
        },
      });
    } finally {
      releaseActivity();
      await inFlightActivity;
    }
  });

  it('blocks checkout while pending remote promotion activity is in flight', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(
      await initializeInput('graph-active-promotion', 'root'),
    );
    expectInitializeSuccess(initialized);
    const providerWriteActivityTracker = createVersionProviderWriteActivityTracker();
    let releasePromotion!: () => void;
    let markPromotionStarted!: () => void;
    const promotionHold = new Promise<void>((resolve) => {
      releasePromotion = resolve;
    });
    const promotionStarted = new Promise<void>((resolve) => {
      markPromotionStarted = resolve;
    });
    const inFlightPromotion =
      providerWriteActivityTracker.runExclusivePendingRemotePromotion(async () => {
        markPromotionStarted();
        await promotionHold;
      });
    await promotionStarted;
    const wb = createWorkbook({
      versioning: {
        provider,
        providerWriteActivityTracker,
      },
    });

    try {
      await expect(wb.version.getSurfaceStatus()).resolves.toMatchObject({
        dirty: {
          pendingProviderWrites: true,
          checkoutSafe: false,
          unsafeReasons: [
            expect.objectContaining({
              code: 'version.surfaceStatus.pendingProviderWrites',
              data: expect.objectContaining({ pendingRemotePromotionActiveCount: 1 }),
            }),
          ],
        },
      });

      await expect(wb.version.checkout({ kind: 'head' })).resolves.toMatchObject({
        ok: false,
        error: {
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_CHECKOUT_PENDING_PROVIDER_WRITES',
              data: expect.objectContaining({
                payload: expect.objectContaining({
                  reason: 'pendingProviderWrites',
                  pendingRemotePromotionActiveCount: 1,
                }),
              }),
            }),
          ],
        },
      });
    } finally {
      releasePromotion();
      await inFlightPromotion;
    }
  });

  it('rejects requireClean:false without invoking checkout services', async () => {
    const checkout = jest.fn();
    const planCheckout = jest.fn();
    const wb = createWorkbook({
      ctx: createMockCtx({
        versioning: {
          checkoutService: { checkout, planCheckout },
        },
      }),
    });

    const result = await wb.version.checkout(
      { kind: 'commit', id: `commit:sha256:${'4'.repeat(64)}` },
      { requireClean: false },
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_CHECKOUT_REQUIRE_CLEAN_UNSUPPORTED',
            data: expect.objectContaining({
              recoverability: 'unsupported',
              payload: expect.objectContaining({ option: 'requireClean' }),
            }),
          }),
        ],
      },
    });
    expect(checkout).not.toHaveBeenCalled();
    expect(planCheckout).not.toHaveBeenCalled();
  });

  it('falls back to a public plan when the attached service has no snapshot materializer', async () => {
    const stores = createStores();
    const commit = await createCommit(stores, 'plan-only-root');
    const checkoutService = createCheckoutMaterializationService({
      commitReader: stores.commitStore,
      dependencyReader: {
        hasDependency: (dependency) => stores.objectStore.hasObject(dependency),
      },
    });
    const checkout = jest.spyOn(checkoutService, 'checkout');
    const wb = createWorkbook({
      ctx: createMockCtx({
        versioning: {
          checkoutService,
        },
      }),
    });

    const result = await wb.version.checkout({ kind: 'commit', id: commit.id });

    expect(checkout).toHaveBeenCalledWith({ target: 'commit', commitId: commit.id });
    expect(result).toMatchObject({
      ok: true,
      value: {
        status: 'success',
        materialization: 'planned',
        mutationGuarantee: 'no-workbook-mutation',
        plan: {
          commitId: commit.id,
        },
      },
    });
  });

  it('maps applied checkout results from an attached snapshot materializer', async () => {
    const stores = createStores();
    const commit = await createCommit(stores, 'applied-root');
    const applySnapshot = jest.fn(async () => ({ status: 'applied' as const }));
    const checkoutService = createCheckoutMaterializationService({
      commitReader: stores.commitStore,
      dependencyReader: {
        hasDependency: (dependency) => stores.objectStore.hasObject(dependency),
      },
      snapshotReader: {
        readSnapshotRoot: (dependency) => stores.objectStore.getObjectRecord(dependency),
      },
      snapshotMaterializer: {
        applySnapshot,
      },
    });
    const wb = createWorkbook({
      ctx: createMockCtx({
        versioning: {
          checkoutService,
        },
      }),
    });

    const result = await wb.version.checkout({ kind: 'commit', id: commit.id });

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: 'success',
        materialization: 'applied',
        mutationGuarantee: 'workbook-state-materialized',
        plan: {
          commitId: commit.id,
        },
        diagnostics: [],
      },
    });
    expect(applySnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        commitId: commit.id,
        snapshotRoot: {
          label: 'applied-root',
          sheets: [],
        },
      }),
    );
    expect(JSON.stringify(result)).not.toContain('digest');
  });

  it('routes checkout planning through the provider-backed workbook versioning service', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);
    const wb = createWorkbook({
      versioning: {
        provider,
      },
    });

    await expect(
      wb.version.checkout({ kind: 'commit', id: initialized.rootCommit.id }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'success',
        materialization: 'planned',
        mutationGuarantee: 'no-workbook-mutation',
        plan: {
          strategy: 'fullSnapshot',
          commitId: initialized.rootCommit.id,
          parentCommitIds: [],
          target: {
            kind: 'commit',
            commitId: initialized.rootCommit.id,
          },
          requiredDependencies: [
            { role: 'snapshotRoot', objectType: 'workbook.snapshotRoot.v1' },
            { role: 'semanticChangeSet', objectType: 'workbook.semanticChangeSet.v1' },
          ],
          requiredDependencyCount: 2,
        },
        diagnostics: [],
      },
    });

    await expect(wb.version.getHead()).resolves.toMatchObject({
      ok: true,
      value: {
        id: initialized.rootCommit.id,
        refName: VERSION_GRAPH_MAIN_REF,
        resolvedFrom: 'HEAD',
        refRevision: initialized.initialHead.revision,
      },
    });
  });

  it('resolves provider-backed checkout planning for a non-main live branch ref', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);
    const graph = await provider.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1'));
    const childInput = await initializeInput('graph-1', 'scenario-target');
    const child = await graph.commit({
      ...childInput.rootWrite,
      expectedHeadCommitId: initialized.rootCommit.id,
      expectedMainRefVersion: initialized.initialHead.revision,
    });
    expectGraphWriteSuccess(child);
    const branch = graph.refStore.createBranch({
      name: 'scenario/checkout',
      targetCommitId: child.commit.id,
      expectedAbsent: true,
      baseCommitId: initialized.rootCommit.id,
      createdBy: AUTHOR,
    });
    expect(branch.ok).toBe(true);
    if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);
    const wb = createWorkbook({
      versioning: {
        provider,
      },
    });

    await expect(
      wb.version.checkout({ kind: 'ref', name: 'refs/heads/scenario/checkout' as any }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'success',
        materialization: 'planned',
        mutationGuarantee: 'no-workbook-mutation',
        plan: {
          strategy: 'fullSnapshot',
          commitId: child.commit.id,
          parentCommitIds: [initialized.rootCommit.id],
          target: {
            kind: 'ref',
            refName: 'refs/heads/scenario/checkout',
            commitId: child.commit.id,
            refRevision: branch.ref.refVersion,
            refIncarnationId: branch.ref.refIncarnationId,
          },
          requiredDependencyCount: 2,
        },
        diagnostics: [],
      },
    });
  });
});
