import { expect, it } from '@jest/globals';

import { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';
import {
  createWorkbook,
  DOCUMENT_SCOPE,
  initializeProvider,
  pendingSegmentFixture,
  persistAndReservePendingSegment,
  reserveSyncBatchStatus,
} from './version-checkout-sync-batch-admission-test-utils';

export function registerPendingSyncBatchAdmissionScenarios(): void {
  it('blocks checkout with sync batch backlog diagnostics while the batch status is pending', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const namespace = await initializeProvider(provider, 'graph-sync-batch-pending');
    const graph = await provider.openGraph(namespace);
    const store = await provider.openPendingRemoteSegmentStore(namespace);
    const fixture = await pendingSegmentFixture(namespace);
    await persistAndReservePendingSegment(graph, store, fixture);
    const batchStatusId = await reserveSyncBatchStatus(provider, fixture.input.operationContext);
    const wb = createWorkbook({ versioning: { provider } });

    await expect(wb.version.checkout({ kind: 'head' })).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_CHECKOUT_SYNC_BATCH_STATUS_BLOCKED',
            data: expect.objectContaining({
              recoverability: 'retry',
              payload: expect.objectContaining({
                reason: 'syncBatchStatusBlocked',
                refName: 'redacted',
                pendingRemoteSegmentCount: 1,
                syncBatchStatusPendingCount: 1,
                syncBatchStatusBlockedCount: 1,
                syncBatchStatusFirstState: 'pending',
                syncBatchStatusFirstBatchStatusId: batchStatusId,
              }),
            }),
          }),
        ],
      },
    });
  });
}
