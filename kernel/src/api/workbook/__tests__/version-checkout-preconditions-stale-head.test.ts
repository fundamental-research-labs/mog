import {
  appendHeadCommit,
  cleanDirtyStatus,
  createWorkbook,
  expectProviderHead,
  expectProviderHeadUnchanged,
  failingMaterializer,
  initializeVersionGraph,
  resetCheckoutPreconditionMocks,
  setSurfaceStatusService,
  spyOnCheckoutService,
  versioningRuntimeForWorkbook,
} from './version-checkout-preconditions-test-utils';

describe('WorkbookVersion checkout stale-head preconditions', () => {
  beforeEach(() => {
    resetCheckoutPreconditionMocks();
  });

  it('rejects stale target ref admission before checkout service entry and leaves state unchanged', async () => {
    const graphId = 'graph-stale-target-ref-precondition';
    const { provider, initialized } = await initializeVersionGraph(graphId);
    const moved = await appendHeadCommit(provider, graphId, initialized, 'head-after-stale-ref');
    const checkoutSnapshotMaterializer = failingMaterializer();
    const wb = createWorkbook({
      provider,
      checkoutSnapshotMaterializer,
    });
    const runtime = versioningRuntimeForWorkbook(wb);
    const checkoutSpy = spyOnCheckoutService(runtime);

    try {
      await wb.activeSheet.setCell('A1', 'active-before-stale-ref');
      wb.markClean();
      const beforeProviderHead = await expectProviderHead(provider, graphId);
      delete runtime.readService;
      delete runtime.writeService;
      delete runtime.commitService;
      delete runtime.versionReadService;
      delete runtime.publicService;
      setSurfaceStatusService(wb, {
        readDirtyStatus: async () => cleanDirtyStatus('stale-ref-clean'),
        readActiveCheckoutSession: () => ({
          checkedOutCommitId: initialized.rootCommit.id,
          branchName: 'main',
          refHeadAtMaterialization: initialized.rootCommit.id,
          detached: false,
        }),
      });

      const result = await wb.version.checkout({
        kind: 'ref',
        name: 'refs/heads/main' as any,
      });

      expect(result).toMatchObject({
        ok: false,
        error: {
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_CHECKOUT_STALE_WORKSPACE_HEAD',
              data: expect.objectContaining({
                recoverability: 'retry',
                redacted: true,
                payload: expect.objectContaining({
                  reason: 'staleWorkspaceHead',
                  staleReason: 'refMoved',
                  targetKind: 'ref',
                  refName: 'redacted',
                  branchName: 'redacted',
                  checkedOutCommitId: 'redacted',
                  refHeadAtMaterialization: 'redacted',
                  currentRefHeadId: 'redacted',
                }),
              }),
            }),
          ],
        },
      });
      expect(checkoutSpy).not.toHaveBeenCalled();
      expect(checkoutSnapshotMaterializer.applySnapshot).not.toHaveBeenCalled();
      await expect(wb.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 'active-before-stale-ref',
      });
      await expectProviderHeadUnchanged(provider, graphId, beforeProviderHead);
    } finally {
      await wb.close('skipSave');
    }
  });
});
