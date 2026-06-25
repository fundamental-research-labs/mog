import { expect, it, jest } from '@jest/globals';
import type { Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import type { CheckoutSnapshotMaterializer } from '../../../document/version-store/checkout-apply';
import { DOCUMENT_SCOPE, initializeVersionGraph } from './version-checkout-atomicity-test-utils';
import {
  installVersionDomainDetectorNoopsOnHandles,
  withVersionManifest,
} from './version-domain-support-test-utils';

export function registerVersionCheckoutMaterializerFailureAtomicityScenario(): void {
  it('keeps the active workbook unchanged and reports rollback-safe diagnostics when checkout materialization fails before publish', async () => {
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
    const checkoutSnapshotMaterializer: CheckoutSnapshotMaterializer = {
      applySnapshot: jest.fn(async (input) => ({
        status: 'failed' as const,
        diagnostics: [
          {
            code: 'VERSION_CHECKOUT_SNAPSHOT_APPLY_FAILED' as const,
            severity: 'error' as const,
            message: 'Injected rollback-safe checkout materialization gap.',
            commitId: input.commitId,
            details: { cause: 'rollbackSafeGap' },
          },
        ],
        mutationGuarantee: 'no-workbook-mutation' as const,
      })),
    };

    try {
      sourceWb = await sourceHandle.workbook({ versioning: withVersionManifest({ provider }) });
      await sourceWb.activeSheet.setCell('A1', 'target-commit');
      await sourceWb.activeSheet.setCell('B1', '=6*7');
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
        versioning: withVersionManifest({
          provider,
          checkoutSnapshotMaterializer,
        }),
      });
      await checkoutWb.activeSheet.setCell('A1', 'active-before-checkout');
      await checkoutWb.activeSheet.setCell('B1', '=10+5');
      checkoutWb.markClean();

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
                  cause: 'rollbackSafeGap',
                  mutationGuarantee: 'no-workbook-mutation',
                  rollbackSafe: true,
                }),
              }),
            }),
          ],
        },
      });
      expect(checkoutSnapshotMaterializer.applySnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          commitId: committed.id,
        }),
      );
      expect(JSON.stringify(result)).not.toContain(committed.id);
      await expect(checkoutWb.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 'active-before-checkout',
      });
      await expect(checkoutWb.activeSheet.getCell('B1')).resolves.toMatchObject({ value: 15 });
    } finally {
      if (checkoutWb) await checkoutWb.close('skipSave');
      if (sourceWb) await sourceWb.close('skipSave');
      await checkoutHandle.dispose();
      await sourceHandle.dispose();
    }
  });
}
