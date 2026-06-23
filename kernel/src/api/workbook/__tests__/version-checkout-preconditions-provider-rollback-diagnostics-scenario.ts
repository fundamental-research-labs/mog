import { expect, it, jest } from '@jest/globals';

import {
  createWorkbook,
  failingMaterializer,
  initializeVersionGraph,
  versioningRuntimeForWorkbook,
} from './version-checkout-preconditions-test-utils';

export function registerVersionCheckoutProviderRollbackDiagnosticsScenario(): void {
  it('reports rollback-degraded and stale token diagnostics as redacted retryable checkout failures', async () => {
    const graphId = 'graph-rollback-degraded-diagnostics';
    const { provider, initialized } = await initializeVersionGraph(graphId);
    const wb = createWorkbook({ provider, checkoutSnapshotMaterializer: failingMaterializer() });
    const runtime = versioningRuntimeForWorkbook(wb);
    const diagnostics = [
      {
        code: 'VERSION_CHECKOUT_ROLLBACK_DEGRADED',
        severity: 'error',
        message: 'private rollback degraded detail',
        details: { cause: 'leaseReleaseFailed', tokenId: 'secret-runtime-token' },
      },
      {
        code: 'VERSION_CHECKOUT_STALE_SAVE_TOKEN',
        severity: 'error',
        message: 'private stale save token detail',
        details: { cause: 'staleSaveToken', tokenId: 'secret-save-token' },
      },
    ];
    runtime.checkoutService = {
      checkout: jest.fn(async () => ({
        ok: false,
        error: { diagnostics },
        diagnostics,
        mutationGuarantee: 'unknown-after-partial-mutation',
      })),
    };

    try {
      await wb.activeSheet.setCell('A1', 'active-before-rollback-degraded');
      wb.markClean();

      const result = await wb.version.checkout({
        kind: 'commit',
        id: initialized.rootCommit.id,
      });

      expect(result).toMatchObject({
        ok: false,
        error: {
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_CHECKOUT_ROLLBACK_DEGRADED',
              data: expect.objectContaining({
                recoverability: 'retry',
                payload: expect.objectContaining({
                  cause: 'leaseReleaseFailed',
                  mutationGuarantee: 'unknown-after-partial-mutation',
                  rollbackSafe: false,
                }),
              }),
            }),
            expect.objectContaining({
              code: 'VERSION_CHECKOUT_STALE_SAVE_TOKEN',
              data: expect.objectContaining({ recoverability: 'retry' }),
            }),
          ],
        },
      });
      expect(JSON.stringify(result)).not.toContain('secret-runtime-token');
      expect(JSON.stringify(result)).not.toContain('secret-save-token');
      await expect(wb.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 'active-before-rollback-degraded',
      });
    } finally {
      await wb.close('skipSave');
    }
  });
}
