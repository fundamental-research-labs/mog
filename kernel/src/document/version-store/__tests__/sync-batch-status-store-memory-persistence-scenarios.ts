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
  syncBatchStatusInput,
  syncOperationContext,
} from './sync-batch-status-store-test-helpers';

export function registerSyncBatchStatusStoreMemoryPersistenceTests(): void {
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
        (await reloadedProvider.openSyncBatchStatusStore()).readByBatchStatusId(
          input.batchStatusId,
        ),
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
}
