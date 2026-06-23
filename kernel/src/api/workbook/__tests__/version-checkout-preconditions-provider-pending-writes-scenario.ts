import { expect, it } from '@jest/globals';

import {
  appendHeadCommit,
  createWorkbook,
  expectHead,
  expectHeadUnchanged,
  expectPublicDiagnosticsNotToLeak,
  failingMaterializer,
  initializeVersionGraph,
  PENDING_PROVIDER_SECRET,
  persistPendingProviderWrite,
} from './version-checkout-preconditions-test-utils';

export function registerVersionCheckoutProviderPendingWritesScenario(): void {
  it('blocks checkout while provider writes are pending with redacted diagnostics and no materialization', async () => {
    const graphId = 'graph-pending-provider-precondition';
    const { provider, initialized } = await initializeVersionGraph(graphId);
    await appendHeadCommit(provider, graphId, initialized, 'head-before-pending-provider');
    await persistPendingProviderWrite(provider, graphId);
    const checkoutSnapshotMaterializer = failingMaterializer();
    const wb = createWorkbook({
      provider,
      checkoutSnapshotMaterializer,
    });

    try {
      await wb.activeSheet.setCell('A1', 'active-before-pending-provider');
      wb.markClean();
      const beforeHead = await expectHead(wb);

      const result = await wb.version.checkout({
        kind: 'commit',
        id: initialized.rootCommit.id,
      });

      expect(result).toMatchObject({
        ok: false,
        error: {
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_CHECKOUT_PENDING_PROVIDER_WRITES',
              data: expect.objectContaining({
                recoverability: 'retry',
                redacted: true,
                payload: expect.objectContaining({
                  reason: 'pendingProviderWrites',
                  targetKind: 'commit',
                  commitId: 'redacted',
                  pendingRemoteSegmentCount: 1,
                }),
              }),
            }),
          ],
        },
      });
      expectPublicDiagnosticsNotToLeak(result, [
        PENDING_PROVIDER_SECRET,
        'secret-pending-provider-origin',
        'secret-pending-provider-update',
      ]);
      expect(checkoutSnapshotMaterializer.applySnapshot).not.toHaveBeenCalled();
      await expect(wb.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 'active-before-pending-provider',
      });
      await expectHeadUnchanged(wb, beforeHead);
    } finally {
      await wb.close('skipSave');
    }
  });
}
