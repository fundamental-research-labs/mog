import type { Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import {
  installVersionDomainDetectorNoopsOnHandles,
  installVersionDomainDetectorNoopsOnWorkbook,
  withVersionManifest,
} from './version-domain-support-test-utils';
import {
  DOCUMENT_SCOPE,
  createCellEditNormalCommitCapture,
  initializeVersionGraph,
} from './version-checkout-lifecycle-test-utils';

export function registerVisibleActiveSheetMaterializationScenario(): void {
  it('selects a visible active sheet and refreshes sheet metadata after checkout materialization', async () => {
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
      sourceWb = await sourceHandle.workbook({
        versioning: withVersionManifest({
          provider,
          captureNormalCommit: createCellEditNormalCommitCapture({
            address: 'A1',
            value: 'hidden-source',
            label: 'visible active sheet selection',
          }),
        }),
      });
      installVersionDomainDetectorNoopsOnWorkbook(sourceWb);
      await sourceWb.activeSheet.setName('Hidden Input');
      await sourceWb.activeSheet.setCell('A1', 'hidden-source');
      const visibleSheet = await sourceWb.sheets.add('Visible Output');
      await visibleSheet.setCell('A1', 'visible-output');
      const archiveSheet = await sourceWb.sheets.add('Archive');
      await archiveSheet.setCell('A1', 'archive-output');
      await sourceWb.sheets.hide('Hidden Input');
      await sourceWb.sheets.setActive('Archive');

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
      await checkoutWb.activeSheet.setCell('A1', 'pre-checkout-active');
      expect(checkoutWb.activeSheet.name).toBe('Sheet1');
      checkoutWb.markClean();
      const checkoutMaterializedEvents: unknown[] = [];
      const activeCheckoutStateEvents: unknown[] = [];
      const unsubscribeCheckoutMaterialized = checkoutWb.on(
        'workbook:version-checkout-materialized',
        (event) => {
          checkoutMaterializedEvents.push(event);
        },
      );
      const unsubscribeActiveCheckoutState = checkoutWb.on(
        'workbook:version-active-checkout-state-changed',
        (event) => {
          activeCheckoutStateEvents.push(event);
        },
      );

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
      unsubscribeCheckoutMaterialized();
      unsubscribeActiveCheckoutState();

      expect(checkoutWb.activeSheet.name).toBe('Visible Output');
      expect(checkoutWb.activeSheet.index).toBe(1);
      expect(checkoutWb.isDirty).toBe(false);
      expect(checkoutMaterializedEvents).toEqual([
        expect.objectContaining({
          type: 'workbook:version-checkout-materialized',
          commitId: committed.id,
          targetKind: 'commit',
        }),
      ]);
      expect(activeCheckoutStateEvents).toEqual([
        expect.objectContaining({
          type: 'workbook:version-active-checkout-state-changed',
          activeCheckoutSession: {
            checkedOutCommitId: committed.id,
            detached: true,
          },
          previousActiveCheckoutSession: null,
          statusRevision: 1,
          reason: 'checkout-materialized',
        }),
      ]);
      await expect(checkoutWb.activeSheet.getVisibility()).resolves.toBe('visible');
      await expect(checkoutWb.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 'visible-output',
      });
      await expect(checkoutWb.getSheetNames()).resolves.toEqual([
        'Hidden Input',
        'Visible Output',
        'Archive',
      ]);
      expect(checkoutWb.sheetNames).toEqual(['Hidden Input', 'Visible Output', 'Archive']);

      const sheets = await checkoutWb.getSheets();
      await expect(
        Promise.all(
          sheets.map(async (sheet) => ({
            name: sheet.name,
            index: sheet.index,
            visibility: await sheet.getVisibility(),
          })),
        ),
      ).resolves.toEqual([
        { name: 'Hidden Input', index: 0, visibility: 'hidden' },
        { name: 'Visible Output', index: 1, visibility: 'visible' },
        { name: 'Archive', index: 2, visibility: 'visible' },
      ]);
      const hiddenByIndex = await checkoutWb.getSheetByIndex(0);
      expect(hiddenByIndex.name).toBe('Hidden Input');
      expect(hiddenByIndex.index).toBe(0);
    } finally {
      if (checkoutWb) await checkoutWb.close('skipSave');
      if (sourceWb) await sourceWb.close('skipSave');
      await checkoutHandle.dispose();
      await sourceHandle.dispose();
    }
  });
}
