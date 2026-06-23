import type { Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import {
  DOCUMENT_SCOPE,
  expectPublicDiagnosticsNotToLeak,
  initializeVersionGraph,
  installProviderLifecycleDocumentFactoryHooks,
  versioningRuntimeForHandle,
} from './version-checkout-provider-lifecycle-test-utils';
import { withVersionManifest } from './version-domain-support-test-utils';
import { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';

installProviderLifecycleDocumentFactoryHooks();

describe('WorkbookVersion provider-backed checkout provider identity lifecycle guards', () => {
  it('fails closed when provider identity changes after checkout services are attached', async () => {
    const { provider, initialized } = await initializeVersionGraph();
    const sourceHandle = await DocumentFactory.create({
      documentId: DOCUMENT_SCOPE.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    const checkoutHandle = await DocumentFactory.create({
      documentId: DOCUMENT_SCOPE.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let sourceWb: Workbook | undefined;
    let checkoutWb: Workbook | undefined;

    try {
      sourceWb = await sourceHandle.workbook({ versioning: withVersionManifest({ provider }) });
      await sourceWb.activeSheet.setCell('A1', 'target-provider-identity');
      const committedResult = await sourceWb.version.commit({
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
      sourceWb.markClean();

      checkoutWb = await checkoutHandle.workbook({ versioning: withVersionManifest({ provider }) });
      await checkoutWb.activeSheet.setCell('A1', 'active-before-provider-identity-fence');
      checkoutWb.markClean();

      const runtimeVersioning = versioningRuntimeForHandle(checkoutHandle);
      runtimeVersioning.provider = createInMemoryVersionStoreProvider({
        documentScope: {
          ...DOCUMENT_SCOPE,
          documentId: 'checkout-provider-lifecycle-other-doc',
        },
      });

      const identityResult = await checkoutWb.version.checkout({ kind: 'commit', id: committed.id });
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
      await expect(checkoutWb.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 'active-before-provider-identity-fence',
      });
    } finally {
      if (checkoutWb) await checkoutWb.close('skipSave');
      if (sourceWb) await sourceWb.close('skipSave');
      await checkoutHandle.dispose();
      await sourceHandle.dispose();
    }
  });

  it('keeps dirty and rebound provider identity checkout diagnostics redacted after close and reopen', async () => {
    const { provider, initialized } = await initializeVersionGraph();
    const reboundProvider = createInMemoryVersionStoreProvider({
      documentScope: {
        ...DOCUMENT_SCOPE,
        documentId: 'checkout-provider-lifecycle-rebound-doc',
      },
    });
    const sourceHandle = await DocumentFactory.create({
      documentId: DOCUMENT_SCOPE.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    const checkoutHandle = await DocumentFactory.create({
      documentId: DOCUMENT_SCOPE.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let sourceWb: Workbook | undefined;
    let checkoutWb: Workbook | undefined;
    let reopenedWb: Workbook | undefined;

    try {
      sourceWb = await sourceHandle.workbook({ versioning: withVersionManifest({ provider }) });
      await sourceWb.activeSheet.setCell('A1', 'target-before-provider-rebound');
      const committedResult = await sourceWb.version.commit({
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
      sourceWb.markClean();

      checkoutWb = await checkoutHandle.workbook({ versioning: withVersionManifest({ provider }) });
      checkoutWb.markClean();
      await expect(
        checkoutWb.version.checkout({ kind: 'commit', id: committed.id }),
      ).resolves.toMatchObject({
        ok: true,
        value: {
          status: 'success',
          materialization: 'applied',
          mutationGuarantee: 'workbook-state-materialized',
        },
      });
      await checkoutWb.close('skipSave');
      checkoutWb = undefined;

      reopenedWb = await checkoutHandle.workbook({
        versioning: withVersionManifest({ provider }),
      });
      versioningRuntimeForHandle(checkoutHandle).provider = reboundProvider;
      await reopenedWb.activeSheet.setCell('B1', 'dirty-after-rebound-reopen');

      const dirtyResult = await reopenedWb.version.checkout({ kind: 'commit', id: committed.id });
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
      await expect(reopenedWb.activeSheet.getCell('B1')).resolves.toMatchObject({
        value: 'dirty-after-rebound-reopen',
      });

      reopenedWb.markClean();
      const reboundResult = await reopenedWb.version.checkout({
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
      await expect(reopenedWb.activeSheet.getCell('B1')).resolves.toMatchObject({
        value: 'dirty-after-rebound-reopen',
      });
    } finally {
      if (reopenedWb) await reopenedWb.close('skipSave');
      if (checkoutWb) await checkoutWb.close('skipSave');
      if (sourceWb) await sourceWb.close('skipSave');
      await checkoutHandle.dispose();
      await sourceHandle.dispose();
    }
  });
});
