import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
} from '../provider';
import {
  DOCUMENT_SCOPE,
  SUB_UPDATE_A,
  SUB_UPDATE_B,
  syncBatchStatusInput,
  syncOperationContext,
} from './sync-batch-status-store-test-helpers';

export function registerSyncBatchStatusStoreMemoryValidationTests(): void {
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
}
