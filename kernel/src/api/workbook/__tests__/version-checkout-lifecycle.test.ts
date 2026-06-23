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

describe('WorkbookVersion checkout lifecycle materialization', () => {
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
      await expect(checkoutWb.activeSheet.getCell('D1')).resolves.toMatchObject({ value: 7 });
      await expect(checkoutWb.activeSheet.getCell('D2')).resolves.toMatchObject({ value: 42 });
      expect(checkoutWb.activeSheet.name).toBe('Sheet1');
      expect(checkoutWb.activeSheet.index).toBe(0);
      expect(
        (await checkoutWb.getSheets()).map((sheet) => ({
          name: sheet.name,
          index: sheet.index,
        })),
      ).toEqual([{ name: 'Sheet1', index: 0 }]);

      await expect(checkoutWb.names.get('RevenueCells')).resolves.toMatchObject({
        name: 'RevenueCells',
        reference: 'Sheet1!B2:B3',
        comment: 'VC-06 named range',
      });
      await expect(checkoutWb.names.list()).resolves.toEqual([
        expect.objectContaining({
          name: 'RevenueCells',
          reference: 'Sheet1!B2:B3',
          comment: 'VC-06 named range',
        }),
      ]);

      const table = await checkoutWb.activeSheet.tables.get('SalesTable');
      expect(table).toMatchObject({
        name: 'SalesTable',
        range: 'A1:B3',
        hasHeaderRow: true,
        hasTotalsRow: false,
      });
      expect(table?.columns.map((column) => column.name)).toEqual(['Region', 'Revenue']);

      await expect(checkoutWb.activeSheet.comments.getNote('C2')).resolves.toMatchObject({
        content: 'Revenue note',
        author: 'Analyst',
        cellAddress: 'C2',
      });
      await expect(checkoutWb.activeSheet.comments.noteCount()).resolves.toBe(1);
      await expect(checkoutWb.activeSheet.comments.listNotes()).resolves.toEqual([
        expect.objectContaining({
          content: 'Revenue note',
          author: 'Analyst',
        }),
      ]);
      await expect(checkoutWb.activeSheet.comments.getForCell('C3')).resolves.toEqual([
        expect.objectContaining({
          content: 'Investigate east result',
          author: 'Reviewer',
          commentType: 'threadedComment',
        }),
      ]);

      await expect(checkoutWb.activeSheet.validations.get('E2')).resolves.toMatchObject({
        type: 'list',
        values: ['Open', 'Closed'],
        allowBlank: false,
        showDropdown: true,
        errorStyle: 'stop',
        errorTitle: 'Invalid status',
        errorMessage: 'Pick a status from the list.',
      });
      await expect(checkoutWb.activeSheet.validations.getDropdownItems('E2')).resolves.toEqual([
        'Open',
        'Closed',
      ]);
      await expect(checkoutWb.activeSheet.validations.validate('E2', 'Blocked')).resolves.toEqual({
        valid: false,
        errorStyle: 'stop',
        errorTitle: 'Invalid status',
        errorMessage: 'Pick a status from the list.',
      });

      const conditionalFormats = await checkoutWb.activeSheet.conditionalFormats.list();
      expect(conditionalFormats).toHaveLength(1);
      expect(conditionalFormats[0]).toMatchObject({
        ranges: [{ startRow: 1, startCol: 1, endRow: 2, endCol: 1 }],
        rules: [
          expect.objectContaining({
            type: 'formula',
            formula: '=B2>20',
            style: expect.objectContaining({
              backgroundColor: '#fff2cc',
              fontColor: '#9c6500',
              bold: true,
            }),
          }),
        ],
      });

      const filters = await checkoutWb.activeSheet.filters.list();
      const autoFilter = filters.find((filter) => filter.filterKind === 'autoFilter');
      expect(autoFilter).toEqual(
        expect.objectContaining({
          range: { startRow: 0, startCol: 0, endRow: 2, endCol: 1 },
          columnFilters: {},
        }),
      );
      await expect(checkoutWb.activeSheet.filters.get()).resolves.toEqual({
        range: 'A1:B3',
        columnFilters: {},
      });
      await expect(checkoutWb.activeSheet.filters.getSortState(autoFilter!.id)).resolves.toEqual({
        column: expect.any(String),
        direction: 'desc',
      });

      const chart = await checkoutWb.activeSheet.charts.getByName('RevenueChart');
      expect(chart).toMatchObject({
        type: 'column',
        name: 'RevenueChart',
        title: 'Revenue by Region',
        dataRange: 'A1:B3',
        anchorRow: 4,
        anchorCol: 0,
        width: 360,
        height: 240,
      });
      await expect(checkoutWb.activeSheet.charts.usesRange('A1:B3')).resolves.toBe(true);

      const shape = await checkoutWb.activeSheet.shapes.getItemAt(0);
      expect(shape).toMatchObject({
        type: 'shape',
        shapeType: 'rect',
      });
      await expect(checkoutWb.activeSheet.objects.getInfo(shape!.id)).resolves.toMatchObject({
        type: 'shape',
        name: 'RevenueCallout',
        width: 160,
        height: 60,
      });
      await expect(shape?.getData()).resolves.toMatchObject({
        type: 'shape',
        name: 'RevenueCallout',
        position: expect.objectContaining({
          anchorType: 'oneCell',
          from: expect.objectContaining({
            cellId: expect.any(String),
          }),
        }),
      });
    } finally {
      if (checkoutWb) await checkoutWb.close('skipSave');
      if (sourceWb) await sourceWb.close('skipSave');
      await checkoutHandle.dispose();
      await sourceHandle.dispose();
    }
  });

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

      expect(checkoutWb.activeSheet.name).toBe('Visible Output');
      expect(checkoutWb.activeSheet.index).toBe(1);
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
});
