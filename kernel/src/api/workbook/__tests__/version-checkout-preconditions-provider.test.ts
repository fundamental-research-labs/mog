import { jest } from '@jest/globals';

import {
  appendHeadCommit,
  createWorkbook,
  expectHead,
  expectHeadUnchanged,
  expectPublicDiagnosticsNotToLeak,
  failingMaterializer,
  HISTORY_GAP_SECRET,
  initializeVersionGraph,
  PENDING_PROVIDER_SECRET,
  persistPendingProviderWrite,
  resetCheckoutPreconditionMocks,
  versioningRuntimeForWorkbook,
} from './version-checkout-preconditions-test-utils';

describe('WorkbookVersion checkout provider preconditions', () => {
  beforeEach(() => {
    resetCheckoutPreconditionMocks();
  });

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
                  commitId: initialized.rootCommit.id,
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
                  commitId: initialized.rootCommit.id,
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
});
