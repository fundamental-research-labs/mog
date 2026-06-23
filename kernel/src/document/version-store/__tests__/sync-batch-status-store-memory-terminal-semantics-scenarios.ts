import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
} from '../provider';
import {
  DEFAULT_PAYLOAD_HASH,
  DOCUMENT_SCOPE,
  SUB_UPDATE_A,
  SUB_UPDATE_B,
  syncBatchStatusInput,
  syncOperationContext,
} from './sync-batch-status-store-test-helpers';

export function registerSyncBatchStatusStoreMemoryTerminalSemanticsTests(): void {
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
}
