import { expect, it } from '@jest/globals';

import { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';
import {
  createPromotionAuthorizedWorkbook,
  DOCUMENT_SCOPE,
  expectGraphHead,
  expectReadHeadSuccess,
  initializeProvider,
  markSyncBatchTerminal,
  pendingSegmentFixture,
  persistAndReservePendingSegment,
} from './version-pending-remote-promotion-provider-test-utils';

export function registerPendingRemotePromotionProviderBatchStatusBlockingScenarios(): void {
  it.each([
    ['duplicate', { status: 'dropped', reason: 'duplicate-update-id' }, 'dropped'],
    ['gapWaiting', { status: 'rejected', reason: 'source-gap-waiting' }, 'rejected'],
    [
      'failedAfterMutation',
      { status: 'failedAfterMutation', reason: 'remote-import-failed' },
      'failedAfterMutation',
    ],
  ] as const)(
    'blocks %s source sync batches through wb.version.promotePendingRemote',
    async (_label, terminal, batchStatusState) => {
      const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
      const namespace = await initializeProvider(
        provider,
        `graph-blocked-batch-${batchStatusState}`,
      );
      const graph = await provider.openGraph(namespace);
      const store = await provider.openPendingRemoteSegmentStore(namespace);
      const fixture = await pendingSegmentFixture(namespace);
      await persistAndReservePendingSegment(graph, store, fixture);
      await markSyncBatchTerminal(provider, fixture.input.operationContext, terminal);
      const headBefore = await expectReadHeadSuccess(graph);
      const wb = createPromotionAuthorizedWorkbook({ provider });

      const result = await wb.version.promotePendingRemote();

      expect(result).toMatchObject({
        ok: true,
        value: {
          status: 'failed',
          promotedSegmentIds: [],
          commitIds: [],
          skipped: [
            {
              segmentId: fixture.input.pendingRemoteSegmentId,
              reason: 'batch-status-terminal',
            },
          ],
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_PENDING_REMOTE_PROMOTION_BATCH_BLOCKED',
              reason: 'batch-status-terminal',
              segmentId: fixture.input.pendingRemoteSegmentId,
              data: expect.objectContaining({ batchStatusState }),
            }),
          ],
        },
      });
      await expectGraphHead(graph, headBefore);
      await expect(
        store.readBySegmentId(fixture.input.pendingRemoteSegmentId),
      ).resolves.toMatchObject({
        status: 'found',
        record: { state: 'pending' },
      });
    },
  );
}
