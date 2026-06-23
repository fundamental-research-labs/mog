import { expect, it, jest } from '@jest/globals';

import {
  appendHeadCommit,
  cleanDirtyStatus,
  createWorkbook,
  expectHead,
  expectHeadUnchanged,
  failingMaterializer,
  initializeVersionGraph,
  setSurfaceStatusService,
  spyOnCheckoutService,
  versioningRuntimeForWorkbook,
} from './version-checkout-preconditions-test-utils';

export function registerVersionCheckoutStalePreflightTokenScenario(): void {
  it('rejects stale checkout preflight tokens after acquiring the local lease before service entry', async () => {
    const graphId = 'graph-stale-preflight-token';
    const { provider, initialized } = await initializeVersionGraph(graphId);
    await appendHeadCommit(provider, graphId, initialized, 'head-before-stale-token');
    const wb = createWorkbook({ provider, checkoutSnapshotMaterializer: failingMaterializer() });
    const runtime = versioningRuntimeForWorkbook(wb);
    const checkoutSpy = spyOnCheckoutService(runtime);
    const readDirtyStatus = jest
      .fn()
      .mockReturnValueOnce(cleanDirtyStatus('lease-token-before'))
      .mockReturnValueOnce(cleanDirtyStatus('lease-token-after'));

    try {
      await wb.activeSheet.setCell('A1', 'active-before-stale-preflight-token');
      wb.markClean();
      const beforeHead = await expectHead(wb);
      setSurfaceStatusService(wb, { readDirtyStatus, readActiveCheckoutSession: () => null });

      const result = await wb.version.checkout({
        kind: 'commit',
        id: initialized.rootCommit.id,
      });

      expect(result).toMatchObject({
        ok: false,
        error: {
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_CHECKOUT_WRITE_FENCE_STALE',
              data: expect.objectContaining({
                recoverability: 'retry',
                redacted: true,
                payload: expect.objectContaining({
                  reason: 'checkoutPreflightStale',
                  targetKind: 'commit',
                  commitId: 'redacted',
                }),
              }),
            }),
          ],
        },
      });
      expect(readDirtyStatus).toHaveBeenCalledTimes(2);
      expect(checkoutSpy).not.toHaveBeenCalled();
      await expect(wb.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 'active-before-stale-preflight-token',
      });
      await expectHeadUnchanged(wb, beforeHead);
    } finally {
      await wb.close('skipSave');
    }
  });
}
