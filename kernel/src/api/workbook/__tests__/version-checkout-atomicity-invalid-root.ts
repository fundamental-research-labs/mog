import { expect, it } from '@jest/globals';
import type { Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import {
  DOCUMENT_SCOPE,
  expectActiveDocumentState,
  initializeVersionGraph,
  readActiveDocumentState,
} from './version-checkout-atomicity-test-utils';
import {
  installVersionDomainDetectorNoopsOnHandles,
  withVersionManifest,
} from './version-domain-support-test-utils';

export function registerVersionCheckoutInvalidRootAtomicityScenario(): void {
  it('does not publish a partial workbook when the target snapshot root cannot be reloaded', async () => {
    const { provider, initialized } = await initializeVersionGraph();
    const checkoutHandle = await DocumentFactory.create({
      documentId: DOCUMENT_SCOPE.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    installVersionDomainDetectorNoopsOnHandles(checkoutHandle);
    let checkoutWb: Workbook | undefined;

    try {
      checkoutWb = await checkoutHandle.workbook({
        versioning: withVersionManifest({ provider }),
      });
      await checkoutWb.activeSheet.setCell('A1', 'active-before-invalid-root');
      await checkoutWb.activeSheet.setCell('B1', '=10+5');
      const localOnly = await checkoutWb.sheets.add('LocalOnly');
      await localOnly.setCell('C1', 'local-only-before-invalid-root');
      checkoutWb.markClean();
      const beforeState = await readActiveDocumentState(checkoutWb);

      const result = await checkoutWb.version.checkout({
        kind: 'commit',
        id: initialized.rootCommit.id,
      });

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
                  cause: 'VERSION_SNAPSHOT_ROOT_RELOAD_INVALID_ROOT',
                  mutationGuarantee: 'no-workbook-mutation',
                  rollbackSafe: true,
                }),
              }),
            }),
          ],
        },
      });
      expect(JSON.stringify(result)).not.toContain(initialized.rootCommit.id);
      await expectActiveDocumentState(checkoutWb, beforeState);
    } finally {
      if (checkoutWb) await checkoutWb.close('skipSave');
      await checkoutHandle.dispose();
    }
  });
}
