import type { Workbook } from '@mog-sdk/contracts/api';

import { InMemoryVersionDocumentProviderBackend } from '../../../document/version-store/provider';
import { DocumentFactory } from '../../document/document-factory';
import {
  DOCUMENT_SCOPE,
  initializeVersionGraph,
  providerWithStaleRegistryRead,
  replaceVisibleRegistryGraph,
} from './version-checkout-provider-lifecycle-test-utils';
import { withVersionManifest } from './version-domain-support-test-utils';

export function registerProviderCheckoutStaleRegistryScenario(): void {
  it('leaves runtime head unchanged when the provider graph registry is stale during checkout', async () => {
    const backend = new InMemoryVersionDocumentProviderBackend();
    const { provider, initialized } = await initializeVersionGraph({ backend });
    const stale = providerWithStaleRegistryRead(provider, initialized.registry);
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
      await sourceWb.activeSheet.setCell('A1', 'target-before-stale-registry');
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

      checkoutWb = await checkoutHandle.workbook({
        versioning: withVersionManifest({ provider: stale.provider }),
      });
      await checkoutWb.activeSheet.setCell('A1', 'active-before-stale-registry-checkout');
      checkoutWb.markClean();

      await replaceVisibleRegistryGraph(backend, 'graph-2', 'replacement-root');
      stale.useStaleRegistryAfterLiveReads(1);

      const identityResult = await checkoutWb.version.checkout({
        kind: 'commit',
        id: committed.id,
      });
      expect(identityResult).toMatchObject({
        ok: false,
        error: {
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_CHECKOUT_PENDING_PROVIDER_WRITES',
              data: expect.objectContaining({
                redacted: true,
                payload: expect.objectContaining({
                  reason: 'pendingProviderWrites',
                  targetKind: 'commit',
                  commitId: 'redacted',
                }),
              }),
            }),
          ],
        },
      });
      expect(stale.openGraphCalls()).toBe(0);
      await expect(checkoutWb.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 'active-before-stale-registry-checkout',
      });
    } finally {
      if (checkoutWb) await checkoutWb.close('skipSave');
      if (sourceWb) await sourceWb.close('skipSave');
      await checkoutHandle.dispose();
      await sourceHandle.dispose();
    }
  });
}
