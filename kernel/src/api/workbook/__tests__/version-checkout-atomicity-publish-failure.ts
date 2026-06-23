import { expect, it } from '@jest/globals';
import type { Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';
import {
  DOCUMENT_SCOPE,
  expectActiveDocumentState,
  initializeVersionGraph,
  readActiveDocumentState,
  versioningRuntimeForHandle,
} from './version-checkout-atomicity-test-utils';
import {
  installVersionDomainDetectorNoopsOnHandles,
  withVersionManifest,
} from './version-domain-support-test-utils';

export function registerVersionCheckoutPublishFailureAtomicityScenario(): void {
  it('keeps the active workbook unchanged when production publish fails after fresh materialization', async () => {
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
    installVersionDomainDetectorNoopsOnHandles(sourceHandle, checkoutHandle);
    let sourceWb: Workbook | undefined;
    let checkoutWb: Workbook | undefined;

    try {
      sourceWb = await sourceHandle.workbook({ versioning: withVersionManifest({ provider }) });
      await sourceWb.activeSheet.setCell('A1', 'target-after-publish-failure');
      await sourceWb.activeSheet.setCell('B1', '=6*7');
      const targetOnly = await sourceWb.sheets.add('TargetOnly');
      await targetOnly.setCell('C1', 'target-only-after-publish-failure');
      const commitResult = await sourceWb.version.commit({
        expectedHead: {
          commitId: initialized.rootCommit.id,
          revision: initialized.initialHead.revision,
          symbolicHeadRevision: initialized.symbolicHead.revision,
        },
      });
      if (!commitResult.ok) throw new Error(`expected commit success: ${commitResult.error.code}`);
      const committed = commitResult.value;
      sourceWb.markClean();

      checkoutWb = await checkoutHandle.workbook({
        versioning: withVersionManifest({ provider }),
      });
      await checkoutWb.activeSheet.setCell('A1', 'active-before-publish-failure');
      await checkoutWb.activeSheet.setCell('B1', '=10+5');
      const localOnly = await checkoutWb.sheets.add('LocalOnly');
      await localOnly.setCell('C1', 'local-only-before-publish-failure');
      checkoutWb.markClean();
      const beforeState = await readActiveDocumentState(checkoutWb);

      versioningRuntimeForHandle(checkoutHandle).provider = createInMemoryVersionStoreProvider({
        documentScope: {
          ...DOCUMENT_SCOPE,
          documentId: 'checkout-atomicity-rebound-doc',
        },
      });

      const result = await checkoutWb.version.checkout({ kind: 'commit', id: committed.id });

      expect(result).toMatchObject({
        ok: false,
        error: {
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_CHECKOUT_SNAPSHOT_APPLY_FAILED',
              data: expect.objectContaining({
                recoverability: 'repair',
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
      expect(JSON.stringify(result)).not.toContain(committed.id);
      expect(JSON.stringify(result)).not.toContain('checkout-atomicity-rebound-doc');
      await expectActiveDocumentState(checkoutWb, beforeState);
    } finally {
      if (checkoutWb) await checkoutWb.close('skipSave');
      if (sourceWb) await sourceWb.close('skipSave');
      await checkoutHandle.dispose();
      await sourceHandle.dispose();
    }
  });
}
