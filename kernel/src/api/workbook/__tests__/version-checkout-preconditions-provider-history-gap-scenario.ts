import { expect, it } from '@jest/globals';

import {
  appendHeadCommit,
  createWorkbook,
  expectHead,
  expectHeadUnchanged,
  expectPublicDiagnosticsNotToLeak,
  failingMaterializer,
  HISTORY_GAP_SECRET,
  initializeVersionGraph,
} from './version-checkout-preconditions-test-utils';

export function registerVersionCheckoutProviderHistoryGapScenario(): void {
  it('blocks checkout for history-gap completeness markers with redacted diagnostics and no materialization', async () => {
    const graphId = 'graph-history-gap-precondition';
    const { provider, initialized } = await initializeVersionGraph(graphId, [
      {
        code: 'historyGapMarker',
        severity: 'error',
        message: `Legacy import left a private history gap ${HISTORY_GAP_SECRET}.`,
        path: 'private.history.gaps[0]',
        details: {
          gapId: HISTORY_GAP_SECRET,
          reason: 'secret-legacy-import',
        },
      },
    ]);
    await appendHeadCommit(provider, graphId, initialized, 'head-after-history-gap-root');
    const checkoutSnapshotMaterializer = failingMaterializer();
    const wb = createWorkbook({
      provider,
      checkoutSnapshotMaterializer,
    });

    try {
      await wb.activeSheet.setCell('A1', 'active-before-history-gap-checkout');
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
              code: 'VERSION_CHECKOUT_UNMATERIALIZABLE_COMMIT',
              data: expect.objectContaining({
                recoverability: 'repair',
                redacted: true,
                payload: expect.objectContaining({
                  targetKind: 'commit',
                  commitId: 'redacted',
                  mutationGuarantee: 'no-workbook-mutation',
                  rollbackSafe: true,
                }),
              }),
            }),
          ],
        },
      });
      expectPublicDiagnosticsNotToLeak(result, [
        HISTORY_GAP_SECRET,
        'private.history.gaps',
        'secret-legacy-import',
      ]);
      expect(checkoutSnapshotMaterializer.applySnapshot).not.toHaveBeenCalled();
      await expect(wb.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 'active-before-history-gap-checkout',
      });
      await expectHeadUnchanged(wb, beforeHead);
    } finally {
      await wb.close('skipSave');
    }
  });
}
