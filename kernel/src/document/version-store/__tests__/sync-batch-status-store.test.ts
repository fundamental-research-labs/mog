import 'fake-indexeddb/auto';

import type { VersionAuthor, VersionOperationContext } from '@mog-sdk/contracts/versioning';

import {
  syncBatchStatusKeyMaterialForOperationContext,
  type ReserveSyncBatchStatusInput,
  type SyncBatchStatusOperationContext,
} from '../sync-batch-status-store';
import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
  type VersionDocumentScope,
} from '../provider';
import { createIndexedDbVersionStoreProvider } from '../provider-indexeddb-backend';
import { deleteVersionStoreIndexedDbForTesting } from '../provider-indexeddb-schema';

const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};

const OTHER_DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-2',
  principalScope: 'principal-1',
};

const AUTHOR: VersionAuthor = {
  authorId: 'remote-user-1',
  actorKind: 'user',
  displayName: 'Remote User One',
};

const SUB_UPDATE_A = 'a'.repeat(64);
const SUB_UPDATE_B = 'b'.repeat(64);
const DEFAULT_PAYLOAD_HASH = '3'.repeat(64);

beforeEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

afterEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

describe('sync batch status store', () => {
  it('computes stable document-scoped batch status ids from sync batch identity', async () => {
    const first = await syncBatchStatusKeyMaterialForOperationContext(syncOperationContext(), {
      batchId: 'batch-1',
      orderedSubUpdatePayloadHashes: [SUB_UPDATE_A, SUB_UPDATE_B],
    });
    const replay = await syncBatchStatusKeyMaterialForOperationContext(
      syncOperationContext({
        createdAt: '2026-06-21T00:00:02.000Z',
        collaboration: { sourceKind: 'providerReplay', replay: true, system: true },
      }),
      {
        batchId: 'batch-1',
        orderedSubUpdatePayloadHashes: [SUB_UPDATE_A, SUB_UPDATE_B],
      },
    );
    const changedPayload = await syncBatchStatusKeyMaterialForOperationContext(
      syncOperationContext({ collaboration: { payloadHash: '4'.repeat(64) } }),
      {
        batchId: 'batch-1',
        orderedSubUpdatePayloadHashes: [SUB_UPDATE_A, SUB_UPDATE_B],
      },
    );
    const localEchoWithRotatedRawProvider = await syncBatchStatusKeyMaterialForOperationContext(
      syncOperationContext({
        operationId: 'operation-local-echo',
        collaboration: {
          providerId: 'provider-rotated-2',
          providerKind: 'other-provider',
          authorityRef: 'authority-rotated-2',
          remoteSessionId: 'remote-session-rotated-2',
          correlationId: 'correlation-rotated-2',
          causationIds: ['cause-rotated-2'],
        },
      }),
      {
        batchId: 'batch-1',
        orderedSubUpdatePayloadHashes: [SUB_UPDATE_A, SUB_UPDATE_B],
      },
    );
    const changedSubUpdateOrder = await syncBatchStatusKeyMaterialForOperationContext(
      syncOperationContext(),
      {
        batchId: 'batch-1',
        orderedSubUpdatePayloadHashes: [SUB_UPDATE_B, SUB_UPDATE_A],
      },
    );

    expect(first.batchStatusId).toMatch(/^sync-batch-status:sha256:[0-9a-f]{64}$/);
    expect(first).toEqual(replay);
    expect(first.batchStatusId).toBe(changedPayload.batchStatusId);
    expect(first.batchStatusId).toBe(localEchoWithRotatedRawProvider.batchStatusId);
    expect(first.identity.payloadHash).not.toBe(changedPayload.identity.payloadHash);
    expect(first.batchStatusId).not.toBe(changedSubUpdateOrder.batchStatusId);
    expect(first.identity).toEqual({
      schemaVersion: 1,
      originKind: 'provider',
      stableOriginId: 'provider-stable-1',
      epoch: 'epoch-1',
      batchId: 'batch-1',
      payloadHash: DEFAULT_PAYLOAD_HASH,
      orderedSubUpdatePayloadHashes: [SUB_UPDATE_A, SUB_UPDATE_B],
      subUpdateCount: 2,
    });
  });

  it('reserves, reads, completes, conflicts, and snapshots in-memory batch statuses', async () => {
    const backend = new InMemoryVersionDocumentProviderBackend();
    const provider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend,
      durability: 'snapshot-test-double',
    });
    const store = await provider.openSyncBatchStatusStore();
    const input = await syncBatchStatusInput();

    await expect(store.reserveBatchStatus(input)).resolves.toMatchObject({
      status: 'reserved',
      record: { batchStatusId: input.batchStatusId, state: 'pending' },
    });
    const reserved = await store.readByBatchStatusId(input.batchStatusId);
    expect(reserved).toMatchObject({
      status: 'found',
      record: { identity: { subUpdateCount: 2 } },
    });
    if (reserved.status !== 'found') throw new Error('expected reserved batch status');
    expectNoRawProviderIdentity(reserved.record.operationContext.collaboration);
    await expect(
      store.reserveBatchStatus({
        ...input,
        createdAt: '2026-06-21T00:00:02.000Z',
        operationContext: syncOperationContext({
          createdAt: '2026-06-21T00:00:02.000Z',
          operationId: 'operation-local-echo',
          collaboration: {
            sourceKind: 'providerReplay',
            replay: true,
            providerId: 'provider-rotated-2',
            providerKind: 'other-provider',
            authorityRef: 'authority-rotated-2',
            remoteSessionId: 'remote-session-rotated-2',
            correlationId: 'correlation-rotated-2',
            causationIds: ['cause-rotated-2'],
          },
        }),
      }),
    ).resolves.toMatchObject({
      status: 'existing',
      record: { batchStatusId: input.batchStatusId, state: 'pending' },
    });
    await expect(
      store.reserveBatchStatus({
        ...(await syncBatchStatusInput(
          syncOperationContext({
            collaboration: { payloadHash: '4'.repeat(64) },
          }),
        )),
        operationContext: syncOperationContext({
          collaboration: { payloadHash: '4'.repeat(64) },
        }),
      }),
    ).resolves.toMatchObject({
      status: 'conflict',
      diagnostics: [{ code: 'VERSION_SYNC_BATCH_STATUS_CONFLICT' }],
    });

    await expect(
      store.completeBatchStatus({
        batchStatusId: input.batchStatusId,
        payloadHash: DEFAULT_PAYLOAD_HASH,
        orderedSubUpdatePayloadHashes: [SUB_UPDATE_A, SUB_UPDATE_B],
        subUpdateCount: 2,
        completedAt: '2026-06-21T00:00:03.000Z',
        terminal: { status: 'complete' },
      }),
    ).resolves.toMatchObject({
      status: 'completed',
      record: { state: 'complete', terminal: { status: 'complete' } },
    });
    await expect(store.reserveBatchStatus(input)).resolves.toMatchObject({
      status: 'duplicate',
      record: { state: 'complete' },
    });
    await expect(
      store.completeBatchStatus({
        batchStatusId: input.batchStatusId,
        payloadHash: DEFAULT_PAYLOAD_HASH,
        orderedSubUpdatePayloadHashes: [SUB_UPDATE_A, SUB_UPDATE_B],
        subUpdateCount: 2,
        completedAt: '2026-06-21T00:00:04.000Z',
        terminal: { status: 'complete' },
      }),
    ).resolves.toMatchObject({
      status: 'completed',
      record: { updatedAt: '2026-06-21T00:00:03.000Z' },
    });

    const snapshot = await backend.exportSnapshot();
    const reloadedBackend = await InMemoryVersionDocumentProviderBackend.fromSnapshot(snapshot);
    const reloadedProvider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend: reloadedBackend,
      durability: 'snapshot-test-double',
    });
    await expect(
      (await reloadedProvider.openSyncBatchStatusStore()).readByBatchStatusId(input.batchStatusId),
    ).resolves.toMatchObject({
      status: 'found',
      record: { state: 'complete', terminal: { status: 'complete' } },
    });
    const reloadedRead = await (
      await reloadedProvider.openSyncBatchStatusStore()
    ).readByBatchStatusId(input.batchStatusId);
    if (reloadedRead.status !== 'found') throw new Error('expected reloaded batch status');
    expectNoRawProviderIdentity(reloadedRead.record.operationContext.collaboration);
  });

  it('persists terminal IndexedDB statuses and isolates document scopes', async () => {
    const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const store = await provider.openSyncBatchStatusStore();
    const input = await syncBatchStatusInput();

    await expect(store.reserveBatchStatus(input)).resolves.toMatchObject({
      status: 'reserved',
      record: { documentScopeKey: expect.stringContaining(DOCUMENT_SCOPE.documentId) },
    });
    await expect(
      store.completeBatchStatus({
        batchStatusId: input.batchStatusId,
        payloadHash: DEFAULT_PAYLOAD_HASH,
        orderedSubUpdatePayloadHashes: [SUB_UPDATE_A, SUB_UPDATE_B],
        subUpdateCount: 2,
        completedAt: '2026-06-21T00:00:03.000Z',
        terminal: { status: 'failedAfterMutation', reason: 'sub-update-apply-failed' },
      }),
    ).resolves.toMatchObject({
      status: 'completed',
      record: { state: 'failedAfterMutation' },
    });

    const reloadedProvider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const reloadedStore = await reloadedProvider.openSyncBatchStatusStore();
    await expect(reloadedStore.readByBatchStatusId(input.batchStatusId)).resolves.toMatchObject({
      status: 'found',
      record: { state: 'failedAfterMutation' },
    });
    const reloadedStatus = await reloadedStore.readByBatchStatusId(input.batchStatusId);
    if (reloadedStatus.status !== 'found') throw new Error('expected persisted batch status');
    expectNoRawProviderIdentity(reloadedStatus.record.operationContext.collaboration);
    await expect(
      reloadedStore.completeBatchStatus({
        batchStatusId: input.batchStatusId,
        payloadHash: DEFAULT_PAYLOAD_HASH,
        orderedSubUpdatePayloadHashes: [SUB_UPDATE_A, SUB_UPDATE_B],
        subUpdateCount: 2,
        completedAt: '2026-06-21T00:00:04.000Z',
        terminal: { status: 'complete' },
      }),
    ).resolves.toMatchObject({
      status: 'conflict',
      diagnostics: [{ code: 'VERSION_SYNC_BATCH_STATUS_CONFLICT' }],
    });

    const otherProvider = createIndexedDbVersionStoreProvider({
      documentScope: OTHER_DOCUMENT_SCOPE,
    });
    await expect(
      (await otherProvider.openSyncBatchStatusStore()).readByBatchStatusId(input.batchStatusId),
    ).resolves.toMatchObject({
      status: 'missing',
    });
  });

  it('serializes concurrent IndexedDB reservations for the same batch key', async () => {
    const firstProvider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const secondProvider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const firstStore = await firstProvider.openSyncBatchStatusStore();
    const secondStore = await secondProvider.openSyncBatchStatusStore();
    const input = await syncBatchStatusInput();

    const results = await Promise.all([
      firstStore.reserveBatchStatus(input),
      secondStore.reserveBatchStatus(input),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(['existing', 'reserved']);
    await expect(firstStore.readByBatchStatusId(input.batchStatusId)).resolves.toMatchObject({
      status: 'found',
      record: { state: 'pending' },
    });
  });

  it('serializes competing IndexedDB terminal completions as immutable conflicts', async () => {
    const firstProvider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const secondProvider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const firstStore = await firstProvider.openSyncBatchStatusStore();
    const secondStore = await secondProvider.openSyncBatchStatusStore();
    const input = await syncBatchStatusInput();

    await expect(firstStore.reserveBatchStatus(input)).resolves.toMatchObject({
      status: 'reserved',
    });

    const results = await Promise.all([
      firstStore.completeBatchStatus({
        batchStatusId: input.batchStatusId,
        payloadHash: DEFAULT_PAYLOAD_HASH,
        orderedSubUpdatePayloadHashes: [SUB_UPDATE_A, SUB_UPDATE_B],
        subUpdateCount: 2,
        completedAt: '2026-06-21T00:00:03.000Z',
        terminal: { status: 'complete' },
      }),
      secondStore.completeBatchStatus({
        batchStatusId: input.batchStatusId,
        payloadHash: DEFAULT_PAYLOAD_HASH,
        orderedSubUpdatePayloadHashes: [SUB_UPDATE_A, SUB_UPDATE_B],
        subUpdateCount: 2,
        completedAt: '2026-06-21T00:00:04.000Z',
        terminal: { status: 'failedAfterMutation', reason: 'sub-update-apply-failed' },
      }),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(['completed', 'conflict']);
    const completed = results.find((result) => result.status === 'completed');
    if (!completed || completed.status !== 'completed') {
      throw new Error('expected one completed sync batch status result');
    }
    await expect(firstStore.readByBatchStatusId(input.batchStatusId)).resolves.toMatchObject({
      status: 'found',
      record: {
        state: completed.record.state,
        terminal: completed.record.terminal,
        updatedAt: completed.record.updatedAt,
      },
    });
  });

  it('rejects mismatched in-memory batch status high-water ids', async () => {
    const provider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend: new InMemoryVersionDocumentProviderBackend(),
      durability: 'snapshot-test-double',
    });
    const store = await provider.openSyncBatchStatusStore();
    const input = await syncBatchStatusInput();
    const changedOrder = await syncBatchStatusInput(syncOperationContext(), [
      SUB_UPDATE_B,
      SUB_UPDATE_A,
    ]);

    await expect(
      store.reserveBatchStatus({
        ...input,
        batchStatusId: changedOrder.batchStatusId,
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      diagnostics: [{ code: 'VERSION_INVALID_OPTIONS' }],
    });
    await expect(store.readByBatchStatusId(input.batchStatusId)).resolves.toMatchObject({
      status: 'missing',
    });
    await expect(store.readByBatchStatusId(changedOrder.batchStatusId)).resolves.toMatchObject({
      status: 'missing',
    });
  });
});

async function syncBatchStatusInput(
  operationContext: SyncBatchStatusOperationContext = syncOperationContext(),
  orderedSubUpdatePayloadHashes: readonly string[] = [SUB_UPDATE_A, SUB_UPDATE_B],
): Promise<ReserveSyncBatchStatusInput> {
  const keyMaterial = await syncBatchStatusKeyMaterialForOperationContext(operationContext, {
    batchId: 'batch-1',
    orderedSubUpdatePayloadHashes,
  });
  return {
    batchStatusId: keyMaterial.batchStatusId,
    batchId: 'batch-1',
    orderedSubUpdatePayloadHashes,
    operationContext,
    createdAt: operationContext.createdAt,
  };
}

function expectNoRawProviderIdentity(
  collaboration: NonNullable<VersionOperationContext['collaboration']>,
): void {
  expect(collaboration).not.toHaveProperty('providerId');
  expect(collaboration).not.toHaveProperty('providerKind');
  expect(collaboration).not.toHaveProperty('authorityRef');
  expect(collaboration).not.toHaveProperty('remoteSessionId');
  expect(collaboration).not.toHaveProperty('correlationId');
  expect(collaboration).not.toHaveProperty('causationIds');
}

function syncOperationContext(
  overrides: Partial<VersionOperationContext> & {
    readonly collaboration?: Partial<NonNullable<VersionOperationContext['collaboration']>>;
  } = {},
): SyncBatchStatusOperationContext {
  const collaboration = {
    sourceKind: 'providerLiveInbound',
    originKind: 'provider',
    stableOriginId: 'provider-stable-1',
    providerId: 'provider-1',
    providerKind: 'indexeddb',
    authorityRef: 'authority-1',
    epoch: 'epoch-1',
    updateId: 'remote-update-1',
    sequence: '7',
    payloadHash: DEFAULT_PAYLOAD_HASH,
    provenancePayloadHash: '5'.repeat(64),
    trustStatus: 'verified',
    authorState: 'singleRemote',
    remoteSessionId: 'remote-session-1',
    correlationId: 'correlation-1',
    causationIds: ['cause-1'],
    replay: false,
    system: false,
    commitGrouping: 'pendingRemote',
    validationDiagnosticCount: 0,
    ...overrides.collaboration,
  } satisfies NonNullable<VersionOperationContext['collaboration']>;

  return {
    operationId: 'operation-1',
    kind: 'sync-import',
    author: AUTHOR,
    createdAt: '2026-06-21T00:00:01.000Z',
    workbookId: 'workbook-1',
    domainIds: ['cells.values'],
    capturePolicy: 'commitEligible',
    writeAdmissionMode: 'capture',
    ...overrides,
    collaboration,
  };
}
