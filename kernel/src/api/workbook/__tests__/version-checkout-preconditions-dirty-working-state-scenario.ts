import { expect, it } from '@jest/globals';

import {
  appendHeadCommit,
  createWorkbook,
  expectHead,
  expectHeadUnchanged,
  failingMaterializer,
  initializeVersionGraph,
} from './version-checkout-preconditions-test-utils';

export function registerVersionCheckoutDirtyWorkingStateScenario(): void {
  it('rejects dirty checkout before materialization and leaves the active document and head unchanged', async () => {
    const graphId = 'graph-dirty-precondition';
    const { provider, initialized } = await initializeVersionGraph(graphId);
    const committed = await appendHeadCommit(provider, graphId, initialized, 'head-before-dirty');
    const checkoutSnapshotMaterializer = failingMaterializer();
    const wb = createWorkbook({
      provider,
      checkoutSnapshotMaterializer,
    });

    try {
      await wb.activeSheet.setCell('A1', 'dirty-local-value');
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
              code: 'VERSION_CHECKOUT_DIRTY_WORKING_STATE',
              data: expect.objectContaining({
                redacted: true,
                payload: expect.objectContaining({
                  reason: 'dirtyWorkingState',
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
        value: 'dirty-local-value',
      });
      await expectHeadUnchanged(wb, beforeHead);
      await expect(wb.version.getHead()).resolves.toMatchObject({
        ok: true,
        value: expect.objectContaining({ id: committed.commit.id }),
      });
    } finally {
      await wb.close('skipSave');
    }
  });
}
