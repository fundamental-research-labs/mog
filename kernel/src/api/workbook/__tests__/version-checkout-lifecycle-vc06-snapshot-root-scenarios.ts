import type { Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import {
  installVersionDomainDetectorNoopsOnHandles,
  installVersionDomainDetectorNoopsOnWorkbook,
  withVersionManifest,
} from './version-domain-support-test-utils';
import {
  DOCUMENT_SCOPE,
  authorVc06State,
  createCellEditNormalCommitCapture,
  initializeVersionGraph,
} from './version-checkout-lifecycle-test-utils';
import { expectVc06SnapshotRootDomains } from './version-checkout-lifecycle-vc06-snapshot-root-assertions';

export function registerVc06SnapshotRootMaterializationScenario(): void {
  it('publishes VC-06 domains from a real snapshot-root checkout into a clean active workbook facade', async () => {
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
    installVersionDomainDetectorNoopsOnHandles(checkoutHandle);
    let sourceWb: Workbook | undefined;
    let checkoutWb: Workbook | undefined;

    try {
      sourceWb = await sourceHandle.workbook({
        versioning: withVersionManifest({
          provider,
          captureNormalCommit: createCellEditNormalCommitCapture({
            address: 'A1',
            value: 'vc06-snapshot-root-capture',
            label: 'vc06 snapshot root materialization',
          }),
        }),
      });

      await authorVc06State(sourceWb);
      await sourceWb.activeSheet.view.freezePanes(2, 1);
      installVersionDomainDetectorNoopsOnWorkbook(sourceWb);
      const commitResult = await sourceWb.version.commit({
        expectedHead: {
          commitId: initialized.rootCommit.id,
          revision: initialized.initialHead.revision,
          symbolicHeadRevision: initialized.symbolicHead.revision,
        },
      });
      if (!commitResult.ok) {
        throw new Error(`expected commit success: ${JSON.stringify(commitResult.error)}`);
      }
      const committed = commitResult.value;
      sourceWb.markClean();

      checkoutWb = await checkoutHandle.workbook({ versioning: withVersionManifest({ provider }) });
      checkoutWb.markClean();

      const result = await checkoutWb.version.checkout({ kind: 'commit', id: committed.id });

      expect(result).toMatchObject({
        ok: true,
        value: {
          status: 'success',
          materialization: 'applied',
          mutationGuarantee: 'workbook-state-materialized',
          plan: {
            commitId: committed.id,
            strategy: 'fullSnapshot',
          },
          diagnostics: [],
        },
      });
      await expectVc06SnapshotRootDomains(checkoutWb);
    } finally {
      if (checkoutWb) await checkoutWb.close('skipSave');
      if (sourceWb) await sourceWb.close('skipSave');
      await checkoutHandle.dispose();
      await sourceHandle.dispose();
    }
  });
}
