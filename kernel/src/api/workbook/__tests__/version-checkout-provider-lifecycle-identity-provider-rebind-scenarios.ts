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

export function registerProviderIdentityRebindScenarios(): void {
  it('fails closed when provider identity changes after checkout services are attached', async () => {
    const { provider, initialized } = await initializeVersionGraph();
    const { sourceHandle, checkoutHandle } = await createProviderIdentityLifecycleHandles();
    const workbooks: ProviderIdentityLifecycleWorkbooks = {};

    try {
      workbooks.sourceWb = await sourceHandle.workbook({
        versioning: withVersionManifest({ provider }),
      });
      await workbooks.sourceWb.activeSheet.setCell('A1', 'target-provider-identity');
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
      await workbooks.checkoutWb.activeSheet.setCell('A1', 'active-before-provider-identity-fence');
      workbooks.checkoutWb.markClean();

      const runtimeVersioning = versioningRuntimeForHandle(checkoutHandle);
      runtimeVersioning.provider = createInMemoryVersionStoreProvider({
        documentScope: {
          ...DOCUMENT_SCOPE,
          documentId: 'checkout-provider-lifecycle-other-doc',
        },
      });

      const identityResult = await workbooks.checkoutWb.version.checkout({
        kind: 'commit',
        id: committed.id,
      });
      expect(identityResult).toMatchObject({
        ok: false,
        error: {
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_CHECKOUT_SNAPSHOT_APPLY_FAILED',
              data: expect.objectContaining({
                redacted: true,
                payload: expect.objectContaining({
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
      expectPublicDiagnosticsNotToLeak(identityResult, [
        'checkout-provider-lifecycle-other-doc',
        'providerDocumentScopeKey',
      ]);
      await expect(workbooks.checkoutWb.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 'active-before-provider-identity-fence',
      });
    } finally {
      await closeProviderIdentityLifecycleWorkbooks(workbooks);
      await checkoutHandle.dispose();
      await sourceHandle.dispose();
    }
  });
}
