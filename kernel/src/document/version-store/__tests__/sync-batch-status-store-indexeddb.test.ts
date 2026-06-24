import 'fake-indexeddb/auto';

import { createIndexedDbVersionStoreProvider } from '../provider-indexeddb/backend';
import {
  DEFAULT_PAYLOAD_HASH,
  DOCUMENT_SCOPE,
  OTHER_DOCUMENT_SCOPE,
  SUB_UPDATE_A,
  SUB_UPDATE_B,
  expectNoRawProviderIdentity,
  installSyncBatchStatusIndexedDbCleanup,
  syncBatchStatusInput,
} from './sync-batch-status-store-test-helpers';

installSyncBatchStatusIndexedDbCleanup();

describe('sync batch status store IndexedDB persistence', () => {
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

    const reloadedProvider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const reloadedStore = await reloadedProvider.openSyncBatchStatusStore();
    await expect(reloadedStore.readByBatchStatusId(input.batchStatusId)).resolves.toMatchObject({
      status: 'found',
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
      pendingBacklogSemantics: {
        pendingForCheckout: false,
        backlogForAdmission: true,
        reason: 'reservationConflict',
      },
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
});

describe('sync batch status store IndexedDB concurrency', () => {
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
});
