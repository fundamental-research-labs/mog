import { expect, it } from '@jest/globals';

import { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';
import {
  createMockEventBus,
  createWorkbook,
  DOCUMENT_SCOPE,
  initializeProvider,
  pendingSegmentFixture,
  persistAndReservePendingSegment,
  reserveSyncBatchStatus,
} from './version-checkout-sync-batch-admission-test-utils';

export function registerTerminalSyncBatchAdmissionScenarios(): void {
  it('reports failed-after-mutation sync batch status instead of ordinary dirty checkout', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const namespace = await initializeProvider(provider, 'graph-sync-batch-failed');
    const graph = await provider.openGraph(namespace);
    const store = await provider.openPendingRemoteSegmentStore(namespace);
    const fixture = await pendingSegmentFixture(namespace);
    await persistAndReservePendingSegment(graph, store, fixture);
    await reserveSyncBatchStatus(provider, fixture.input.operationContext, {
      status: 'failedAfterMutation',
      reason: 'sync-apply-failed',
    });
    const eventBus = createMockEventBus();
    const wb = createWorkbook({ eventBus, versioning: { provider } });
    eventBus.emit({ type: 'test:dirty' });

    const result = await wb.version.checkout({ kind: 'head' });

    expect(result).toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_CHECKOUT_SYNC_BATCH_STATUS_BLOCKED',
            data: expect.objectContaining({
              payload: expect.objectContaining({
                reason: 'syncBatchStatusBlocked',
                syncBatchStatusTerminalCount: 1,
                syncBatchStatusFailedAfterMutationCount: 1,
                syncBatchStatusBlockedCount: 1,
                syncBatchStatusFirstState: 'failedAfterMutation',
                syncBatchStatusFirstReason: 'sync-apply-failed',
              }),
            }),
          }),
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain('VERSION_CHECKOUT_DIRTY_WORKING_STATE');
  });
}
