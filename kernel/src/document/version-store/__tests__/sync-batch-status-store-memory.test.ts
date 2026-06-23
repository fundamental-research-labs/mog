import 'fake-indexeddb/auto';

import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
} from '../provider';
import {
  DEFAULT_PAYLOAD_HASH,
  DOCUMENT_SCOPE,
  SUB_UPDATE_A,
  SUB_UPDATE_B,
  expectNoRawProviderIdentity,
  installSyncBatchStatusIndexedDbCleanup,
  syncBatchStatusInput,
  syncOperationContext,
} from './sync-batch-status-store-test-helpers';

installSyncBatchStatusIndexedDbCleanup();

describe('sync batch status store in-memory persistence', () => {
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
      pendingBacklogSemantics: {
        pendingForCheckout: true,
        backlogForAdmission: true,
        reason: 'pending',
      },
      record: {
        batchStatusId: input.batchStatusId,
        state: 'pending',
        pendingBacklogSemantics: {
          pendingForCheckout: true,
          backlogForAdmission: true,
          reason: 'pending',
        },
      },
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
      pendingBacklogSemantics: {
        pendingForCheckout: false,
        backlogForAdmission: true,
        reason: 'reservationConflict',
      },
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
      pendingBacklogSemantics: {
        pendingForCheckout: false,
        backlogForAdmission: false,
        reason: 'complete',
      },
      record: {
        state: 'complete',
        terminal: { status: 'complete' },
        pendingBacklogSemantics: {
          pendingForCheckout: false,
          backlogForAdmission: false,
          reason: 'complete',
        },
      },
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
});

describe('sync batch status store in-memory terminal semantics', () => {
  it('classifies terminal and blocked sync batch statuses for checkout and admission callers', async () => {
    const provider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend: new InMemoryVersionDocumentProviderBackend(),
      durability: 'snapshot-test-double',
    });
    const store = await provider.openSyncBatchStatusStore();

    const failedInput = await syncBatchStatusInput(
      syncOperationContext({
        operationId: 'operation-failed-after-mutation',
        collaboration: { updateId: 'remote-update-failed-after-mutation' },
      }),
      [SUB_UPDATE_A],
      'batch-failed-after-mutation',
    );
    await expect(store.reserveBatchStatus(failedInput)).resolves.toMatchObject({
      status: 'reserved',
      pendingBacklogSemantics: {
        pendingForCheckout: true,
        backlogForAdmission: true,
        reason: 'pending',
      },
    });
    await expect(
      store.completeBatchStatus({
        batchStatusId: failedInput.batchStatusId,
        payloadHash: DEFAULT_PAYLOAD_HASH,
        orderedSubUpdatePayloadHashes: [SUB_UPDATE_A],
        subUpdateCount: 1,
        completedAt: '2026-06-21T00:00:03.000Z',
        terminal: { status: 'failedAfterMutation', reason: 'sub-update-apply-failed' },
      }),
    ).resolves.toMatchObject({
      status: 'completed',
      pendingBacklogSemantics: {
        pendingForCheckout: false,
        backlogForAdmission: true,
        reason: 'failedAfterMutation',
      },
      record: {
        state: 'failedAfterMutation',
        pendingBacklogSemantics: {
          pendingForCheckout: false,
          backlogForAdmission: true,
          reason: 'failedAfterMutation',
        },
      },
    });

    const rejectedInput = await syncBatchStatusInput(
      syncOperationContext({
        operationId: 'operation-terminal-rejected',
        collaboration: { updateId: 'remote-update-terminal-rejected' },
      }),
      [SUB_UPDATE_B],
      'batch-terminal-rejected',
    );
    await expect(store.reserveBatchStatus(rejectedInput)).resolves.toMatchObject({
      status: 'reserved',
    });
    await expect(
      store.completeBatchStatus({
        batchStatusId: rejectedInput.batchStatusId,
        payloadHash: DEFAULT_PAYLOAD_HASH,
        orderedSubUpdatePayloadHashes: [SUB_UPDATE_B],
        subUpdateCount: 1,
        completedAt: '2026-06-21T00:00:04.000Z',
        terminal: { status: 'rejected', reason: 'provider-validation-rejected' },
      }),
    ).resolves.toMatchObject({
      status: 'completed',
      pendingBacklogSemantics: {
        pendingForCheckout: false,
        backlogForAdmission: true,
        reason: 'terminalRejected',
      },
      record: {
        state: 'rejected',
        pendingBacklogSemantics: {
          pendingForCheckout: false,
          backlogForAdmission: true,
          reason: 'terminalRejected',
        },
      },
    });
    await expect(store.reserveBatchStatus(rejectedInput)).resolves.toMatchObject({
      status: 'existing',
      pendingBacklogSemantics: {
        pendingForCheckout: false,
        backlogForAdmission: true,
        reason: 'terminalRejected',
      },
    });

    const blockedInput = await syncBatchStatusInput(
      syncOperationContext({
        operationId: 'operation-blocked-batch-failure',
        collaboration: {
          updateId: 'remote-update-blocked-batch-failure',
          commitGrouping: 'blockedBatchFailure',
          exclusionSubreason: 'blockedBatchFailure',
        },
      }),
      [SUB_UPDATE_A, SUB_UPDATE_B],
      'batch-blocked-batch-failure',
    );
    await expect(store.reserveBatchStatus(blockedInput)).resolves.toMatchObject({
      status: 'reserved',
      pendingBacklogSemantics: {
        pendingForCheckout: false,
        backlogForAdmission: true,
        reason: 'blockedBatchFailure',
      },
      record: {
        state: 'pending',
        pendingBacklogSemantics: {
          pendingForCheckout: false,
          backlogForAdmission: true,
          reason: 'blockedBatchFailure',
        },
      },
    });
  });
});

describe('sync batch status store in-memory validation', () => {
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
      pendingBacklogSemantics: {
        pendingForCheckout: false,
        backlogForAdmission: true,
        reason: 'reservationFailure',
      },
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
