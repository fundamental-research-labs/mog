import { expect, it } from '@jest/globals';

import {
  createWorkbook,
  expectHead,
  expectHeadUnchanged,
  failingMaterializer,
  initializeVersionGraph,
} from './version-checkout-preconditions-test-utils';

export function registerVersionCheckoutMissingTargetScenario(): void {
  it('preflights missing target commits before materialization and leaves active state unchanged', async () => {
    const graphId = 'graph-missing-target-preflight';
    const { provider } = await initializeVersionGraph(graphId);
    const checkoutSnapshotMaterializer = failingMaterializer();
    const wb = createWorkbook({ provider, checkoutSnapshotMaterializer });
    const missingCommitId = `commit:sha256:${'9'.repeat(64)}` as const;

    try {
      await wb.activeSheet.setCell('A1', 'active-before-missing-target');
      wb.markClean();
      const beforeHead = await expectHead(wb);

      const result = await wb.version.checkout({ kind: 'commit', id: missingCommitId });

      expect(result).toMatchObject({
        ok: false,
        error: {
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_CHECKOUT_MISSING_COMMIT',
              data: expect.objectContaining({
                recoverability: 'repair',
                redacted: true,
                payload: expect.objectContaining({
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
        value: 'active-before-missing-target',
      });
      await expectHeadUnchanged(wb, beforeHead);
    } finally {
      await wb.close('skipSave');
    }
  });
}
