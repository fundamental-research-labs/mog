import type { Workbook } from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { DocumentFactory } from '../../document/document-factory';
import type { VersionObjectType } from '../../../document/version-store/object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../../../document/version-store/provider';

const CREATED_AT = '2026-06-20T00:00:00.000Z';
const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'checkout-lifecycle-doc',
  principalScope: 'principal-1',
};
const VERSION_AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

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
    let sourceWb: Workbook | undefined;
    let checkoutWb: Workbook | undefined;

    try {
      sourceWb = await sourceHandle.workbook({ versioning: { provider } });

      await authorVc06State(sourceWb);
      const committed = await sourceWb.version.commit({
        expectedHead: {
          commitId: initialized.rootCommit.id,
          revision: initialized.initialHead.revision,
          symbolicHeadRevision: initialized.symbolicHead.revision,
        },
      });
      sourceWb.markClean();

      checkoutWb = await checkoutHandle.workbook({ versioning: { provider } });
      checkoutWb.markClean();

      const result = await checkoutWb.version.checkout({ kind: 'commit', id: committed.id });

      expect(result).toMatchObject({
        status: 'success',
        materialization: 'applied',
        mutationGuarantee: 'workbook-state-materialized',
        plan: {
          commitId: committed.id,
          strategy: 'fullSnapshot',
        },
        diagnostics: [],
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

  it('rejects dirty post-commit checkout without discarding workbook edits', async () => {
    const { provider, initialized } = await initializeVersionGraph();
    const handle = await DocumentFactory.create({
      documentId: DOCUMENT_SCOPE.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let wb: Workbook | undefined;

    try {
      wb = await handle.workbook({ versioning: { provider } });

      await wb.activeSheet.setCell('A1', 7);
      await wb.activeSheet.setCell('A2', '=A1*6');
      const committed = await wb.version.commit({
        expectedHead: {
          commitId: initialized.rootCommit.id,
          revision: initialized.initialHead.revision,
          symbolicHeadRevision: initialized.symbolicHead.revision,
        },
      });
      wb.markClean();

      await wb.activeSheet.setCell('A1', 99);
      await wb.activeSheet.setCell('A2', '=A1+1');

      const result = await wb.version.checkout({ kind: 'commit', id: committed.id });

      expect(result).toMatchObject({
        status: 'degraded',
        materialization: 'not-applied',
        mutationGuarantee: 'no-workbook-mutation',
        diagnostics: [
          expect.objectContaining({
            issueCode: 'VERSION_CHECKOUT_DIRTY_WORKING_STATE',
            recoverability: 'none',
            redacted: true,
          }),
        ],
      });
      await expect(wb.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 99 });
      await expect(wb.activeSheet.getCell('A2')).resolves.toMatchObject({ value: 100 });
    } finally {
      if (wb) await wb.close('skipSave');
      await handle.dispose();
    }
  });
});

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.code}`);
  }
}

async function initializeVersionGraph(): Promise<{
  provider: ReturnType<typeof createInMemoryVersionStoreProvider>;
  initialized: Extract<VersionGraphInitializeResult, { status: 'success' }>;
}> {
  const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
  const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
  expectInitializeSuccess(initialized);
  return { provider, initialized };
}

async function authorVc06State(wb: Workbook): Promise<void> {
  const sheet = wb.activeSheet;
  await sheet.setCell('A1', 'Region');
  await sheet.setCell('B1', 'Revenue');
  await sheet.setCell('C1', 'Commentary');
  await sheet.setCell('A2', 'West');
  await sheet.setCell('B2', 12);
  await sheet.setCell('C2', 'Needs review');
  await sheet.setCell('A3', 'East');
  await sheet.setCell('B3', 30);
  await sheet.setCell('C3', 'Accepted');
  await sheet.setCell('D1', 7);
  await sheet.setCell('D2', '=D1*6');
  await sheet.setCell('E1', 'Status');
  await sheet.setCell('E2', 'Open');
  await wb.names.add('RevenueCells', 'Sheet1!B2:B3', 'VC-06 named range');
  await sheet.tables.add('A1:B3', {
    name: 'SalesTable',
    hasHeaders: true,
  });
  await sheet.comments.addNote('C2', { text: 'Revenue note', author: 'Analyst' });
  await sheet.comments.add('C3', { text: 'Investigate east result', author: 'Reviewer' });
  await sheet.validations.setList('E2:E3', ['Open', 'Closed'], {
    allowBlank: false,
    showDropdown: true,
    showErrorAlert: true,
    errorStyle: 'stop',
    errorTitle: 'Invalid status',
    errorMessage: 'Pick a status from the list.',
  });
  await sheet.conditionalFormats.addFormula('B2:B3', '=B2>20', {
    backgroundColor: '#fff2cc',
    fontColor: '#9c6500',
    bold: true,
  });
  await sheet.filters.add('A1:B3');
  const filter = (await sheet.filters.list()).find((entry) => entry.filterKind === 'autoFilter');
  const revenueHeader = (await sheet.filters.listHeaderInfo()).find(
    (entry) =>
      entry.filterId === filter?.id && entry.sourceType === 'sheetAutoFilter' && entry.col === 1,
  );
  if (!filter || !revenueHeader) {
    throw new Error('expected auto-filter metadata to be readable before commit');
  }
  await sheet.filters.setSortState(filter.id, {
    column: revenueHeader.headerCellId,
    direction: 'desc',
  });
  await sheet.charts.add({
    type: 'column',
    name: 'RevenueChart',
    title: 'Revenue by Region',
    dataRange: 'A1:B3',
    anchorRow: 4,
    anchorCol: 0,
    width: 360,
    height: 240,
  });
  await sheet.shapes.add({
    type: 'rect',
    name: 'RevenueCallout',
    anchorRow: 4,
    anchorCol: 3,
    width: 160,
    height: 60,
    fill: { type: 'solid', color: '#d9ead3' },
    text: {
      runs: [{ text: 'Tracked in VC-06' }],
    },
  });
}

async function objectRecord(
  namespace: VersionGraphNamespace,
  objectType: VersionObjectType,
  payload: unknown,
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload,
  });
}

async function initializeInput(
  graphId: string,
  label: string,
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label,
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        label,
        changes: [],
      }),
      author: VERSION_AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  };
}
