import { expect, it } from '@jest/globals';

import {
  appendHeadCommit,
  createWorkbook,
  expectHead,
  expectHeadUnchanged,
  failingMaterializer,
  initializeVersionGraph,
  setSurfaceStatusService,
  unsafeAdmissionDirtyStatus,
} from './version-checkout-preconditions-test-utils';

export function registerVersionCheckoutAdmissionDenialScenario(): void {
  it('rejects generic checkout admission denial before materialization and leaves active state unchanged', async () => {
    const graphId = 'graph-generic-admission-denial';
    const { provider, initialized } = await initializeVersionGraph(graphId);
    await appendHeadCommit(provider, graphId, initialized, 'head-before-admission-denial');
    const checkoutSnapshotMaterializer = failingMaterializer();
    const wb = createWorkbook({
      provider,
      checkoutSnapshotMaterializer,
    });

    try {
      await wb.activeSheet.setCell('A1', 'active-before-admission-denial');
      wb.markClean();
      const beforeHead = await expectHead(wb);
      setSurfaceStatusService(wb, {
        readDirtyStatus: async () => unsafeAdmissionDirtyStatus(),
        readActiveCheckoutSession: () => null,
      });

      const result = await wb.version.checkout({
        kind: 'commit',
        id: initialized.rootCommit.id,
      });

      expect(result).toMatchObject({
        ok: false,
        error: {
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_CHECKOUT_WRITE_FENCE_UNAVAILABLE',
              data: expect.objectContaining({
                recoverability: 'retry',
                redacted: true,
                payload: expect.objectContaining({
                  reason: 'checkoutPreflightUnsafe',
                  targetKind: 'commit',
                  commitId: 'redacted',
                }),
              }),
            }),
          ],
        },
      });
      expect(checkoutSnapshotMaterializer.applySnapshot).not.toHaveBeenCalled();
      await expect(wb.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 'active-before-admission-denial',
      });
      await expectHeadUnchanged(wb, beforeHead);
    } finally {
      await wb.close('skipSave');
    }
  });
}
