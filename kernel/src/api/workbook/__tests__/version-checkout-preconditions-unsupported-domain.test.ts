import {
  appendHeadCommit,
  createWorkbook,
  expectHead,
  expectHeadUnchanged,
  expectPublicDiagnosticsNotToLeak,
  failingMaterializer,
  initializeVersionGraph,
  resetCheckoutPreconditionMocks,
  setSurfaceStatusService,
  unsupportedDomainDirtyStatus,
} from './version-checkout-preconditions-test-utils';

describe('WorkbookVersion checkout unsupported-domain preconditions', () => {
  beforeEach(() => {
    resetCheckoutPreconditionMocks();
  });

  it('rejects unsupported dirty domain admission with redacted diagnostics and no materialization', async () => {
    const graphId = 'graph-unsupported-domain-precondition';
    const { provider, initialized } = await initializeVersionGraph(graphId);
    await appendHeadCommit(provider, graphId, initialized, 'head-before-unsupported-domain');
    const checkoutSnapshotMaterializer = failingMaterializer();
    const wb = createWorkbook({
      provider,
      checkoutSnapshotMaterializer,
    });

    try {
      await wb.activeSheet.setCell('A1', 'active-before-unsupported-domain');
      wb.markClean();
      const beforeHead = await expectHead(wb);
      setSurfaceStatusService(wb, {
        readDirtyStatus: async () => unsupportedDomainDirtyStatus(),
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
      expectPublicDiagnosticsNotToLeak(result, [
        'private-macros',
        'private.unsupported.domains',
        'secret-unsupported-domain-value',
      ]);
      expect(checkoutSnapshotMaterializer.applySnapshot).not.toHaveBeenCalled();
      await expect(wb.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 'active-before-unsupported-domain',
      });
      await expectHeadUnchanged(wb, beforeHead);
    } finally {
      await wb.close('skipSave');
    }
  });
});
