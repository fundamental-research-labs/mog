import {
  DOCUMENT_SCOPE,
  expectPublicDiagnosticsNotToLeak,
  initializeVersionGraph,
  versioningRuntimeForHandle,
} from './version-checkout-provider-lifecycle-test-utils';
import { withVersionManifest } from './version-domain-support-test-utils';
import { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';
import {
  closeProviderIdentityLifecycleWorkbooks,
  createProviderIdentityLifecycleHandles,
  type ProviderIdentityLifecycleWorkbooks,
} from './version-checkout-provider-lifecycle-identity-helpers';

export function registerProviderIdentityReopenScenarios(): void {
  it('keeps dirty and rebound provider identity checkout diagnostics redacted after close and reopen', async () => {
    const { provider, initialized } = await initializeVersionGraph();
    const reboundProvider = createInMemoryVersionStoreProvider({
      documentScope: {
        ...DOCUMENT_SCOPE,
        documentId: 'checkout-provider-lifecycle-rebound-doc',
      },
    });
    const { sourceHandle, checkoutHandle } = await createProviderIdentityLifecycleHandles();
    const workbooks: ProviderIdentityLifecycleWorkbooks = {};

    try {
      workbooks.sourceWb = await sourceHandle.workbook({
        versioning: withVersionManifest({ provider }),
      });
      await workbooks.sourceWb.activeSheet.setCell('A1', 'target-before-provider-rebound');
      const committedResult = await workbooks.sourceWb.version.commit({
        expectedHead: {
          commitId: initialized.rootCommit.id,
          revision: initialized.initialHead.revision,
          symbolicHeadRevision: initialized.symbolicHead.revision,
        },
      });
      if (!committedResult.ok) {
        throw new Error(`expected commit success: ${committedResult.error.code}`);
      }
      const committed = committedResult.value;
      workbooks.sourceWb.markClean();

      workbooks.checkoutWb = await checkoutHandle.workbook({
        versioning: withVersionManifest({ provider }),
      });
      workbooks.checkoutWb.markClean();
      await expect(
        workbooks.checkoutWb.version.checkout({ kind: 'commit', id: committed.id }),
      ).resolves.toMatchObject({
        ok: true,
        value: {
          status: 'success',
          materialization: 'applied',
          mutationGuarantee: 'workbook-state-materialized',
        },
      });
      await workbooks.checkoutWb.close('skipSave');
      workbooks.checkoutWb = undefined;

      workbooks.reopenedWb = await checkoutHandle.workbook({
        versioning: withVersionManifest({ provider }),
      });
      versioningRuntimeForHandle(checkoutHandle).provider = reboundProvider;
      await workbooks.reopenedWb.activeSheet.setCell('B1', 'dirty-after-rebound-reopen');

      const dirtyResult = await workbooks.reopenedWb.version.checkout({
        kind: 'commit',
        id: committed.id,
      });
      expect(dirtyResult).toMatchObject({
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
      expectPublicDiagnosticsNotToLeak(dirtyResult, [
        'checkout-provider-lifecycle-rebound-doc',
        'providerDocumentScopeKey',
      ]);
      await expect(workbooks.reopenedWb.activeSheet.getCell('B1')).resolves.toMatchObject({
        value: 'dirty-after-rebound-reopen',
      });

      workbooks.reopenedWb.markClean();
      const reboundResult = await workbooks.reopenedWb.version.checkout({
        kind: 'commit',
        id: committed.id,
      });
      expect(reboundResult).toMatchObject({
        ok: false,
        error: {
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_CHECKOUT_SNAPSHOT_APPLY_FAILED',
              data: expect.objectContaining({
                redacted: true,
                payload: expect.objectContaining({
                  operation: 'checkout',
                  targetKind: 'commit',
                  commitId: 'redacted',
                  cause: 'VersionCheckoutRebindProviderIdentityError',
                  identityFenceReason: 'providerDocumentMismatch',
                  providerIdentityClass: 'document',
                  mutationGuarantee: 'unknown-after-partial-mutation',
                  rollbackSafe: false,
                  partialSnapshot: true,
                }),
              }),
            }),
          ],
        },
      });
      expectPublicDiagnosticsNotToLeak(reboundResult, [
        'checkout-provider-lifecycle-rebound-doc',
        'providerDocumentScopeKey',
      ]);
      await expect(workbooks.reopenedWb.activeSheet.getCell('B1')).resolves.toMatchObject({
        value: 'dirty-after-rebound-reopen',
      });
    } finally {
      await closeProviderIdentityLifecycleWorkbooks(workbooks);
      await checkoutHandle.dispose();
      await sourceHandle.dispose();
    }
  });
}
