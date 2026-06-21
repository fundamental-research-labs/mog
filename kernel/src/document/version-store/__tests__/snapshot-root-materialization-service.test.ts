import type { VersionAuthor } from '@mog-sdk/contracts/versioning';
import { jest } from '@jest/globals';

import { DocumentFactory } from '../../../api/document/document-factory';
import {
  createDocumentLifecycleSnapshotRootHydrator,
  type SnapshotRootFreshLifecycleMaterialization,
} from '../../../api/document/snapshot-root-lifecycle-hydrator';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';
import type { VersionObjectType } from '../object-digest';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../provider';
import {
  createWorkbookSnapshotRootRecord,
  createYrsFullStateSnapshotRootPayload,
} from '../snapshot-root-capture';
import { createSnapshotRootMaterializationService } from '../snapshot-root-materialization-service';

const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};
const CREATED_AT = '2026-06-20T00:00:00.000Z';
const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

describe('SnapshotRootMaterializationService', () => {
  it('reads a committed snapshot root and materializes it through a fresh lifecycle', async () => {
    const sourceHandle = await DocumentFactory.create({
      documentId: 'stored-source-doc',
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let materialized: SnapshotRootFreshLifecycleMaterialization | undefined;

    try {
      const sourceWorkbook = await sourceHandle.workbook();
      await sourceWorkbook.activeSheet.setCell('A1', 7);
      await sourceWorkbook.activeSheet.setCell('A2', '=A1*6');
      await sourceWorkbook.names.add('ReplayRevenue', 'Sheet1!A1:A2', 'VC-06 replay range');
      await sourceWorkbook.activeSheet.comments.setNote('B1', 'Replay note', 'VC Agent');
      await sourceWorkbook.activeSheet.setCell('D1', 'Region');
      await sourceWorkbook.activeSheet.setCell('E1', 'Revenue');
      await sourceWorkbook.activeSheet.setCell('D2', 'West');
      await sourceWorkbook.activeSheet.setCell('E2', 12);
      await sourceWorkbook.activeSheet.setCell('D3', 'East');
      await sourceWorkbook.activeSheet.setCell('E3', 30);
      await sourceWorkbook.activeSheet.setCell('D4', 'North');
      await sourceWorkbook.activeSheet.setCell('E4', 18);
      await sourceWorkbook.activeSheet.tables.add('D1:E4', {
        name: 'ReplaySales',
        hasHeaders: true,
        style: 'TableStyleMedium2',
      });
      await sourceWorkbook.activeSheet.validations.setList('G1:G3', ['Open', 'Closed'], {
        allowBlank: false,
        showDropdown: true,
        showInputMessage: true,
        inputTitle: 'Replay status',
        inputMessage: 'Choose a replay status',
        errorTitle: 'Invalid status',
        errorMessage: 'Status must come from the replay list.',
      });
      await sourceWorkbook.activeSheet.setCell('I1', 1);
      await sourceWorkbook.activeSheet.setCell('I2', 2);
      await sourceWorkbook.activeSheet.setCell('I3', 3);
      const conditionalFormat = await sourceWorkbook.activeSheet.conditionalFormats.addFormula(
        'I1:I3',
        '=I1>1',
        { backgroundColor: '#fff2cc' },
      );
      await sourceWorkbook.activeSheet.setCell('K1', 'Task');
      await sourceWorkbook.activeSheet.setCell('L1', 'Status');
      await sourceWorkbook.activeSheet.setCell('K2', 'Import');
      await sourceWorkbook.activeSheet.setCell('L2', 'Open');
      await sourceWorkbook.activeSheet.setCell('K3', 'Export');
      await sourceWorkbook.activeSheet.setCell('L3', 'Closed');
      await sourceWorkbook.activeSheet.setCell('K4', 'Replay');
      await sourceWorkbook.activeSheet.setCell('L4', 'Open');
      const autoFilter = await sourceWorkbook.activeSheet.filters.add('K1:L4');
      const autoFilterDetail = (await sourceWorkbook.activeSheet.filters.list()).find(
        (filter) =>
          filter.filterKind === 'autoFilter' && cellRangeEquals(filter.range, 0, 10, 3, 11),
      );
      if (!autoFilterDetail) throw new Error('expected authored auto-filter detail');
      await sourceWorkbook.activeSheet.filters.setColumnFilter(
        11,
        { type: 'value', values: ['Open'] },
        autoFilterDetail.id,
      );
      await sourceWorkbook.activeSheet.setCell('N1', 'Name');
      await sourceWorkbook.activeSheet.setCell('O1', 'Score');
      await sourceWorkbook.activeSheet.setCell('N2', 'Beta');
      await sourceWorkbook.activeSheet.setCell('O2', 20);
      await sourceWorkbook.activeSheet.setCell('N3', 'Alpha');
      await sourceWorkbook.activeSheet.setCell('O3', 40);
      await sourceWorkbook.activeSheet.setCell('N4', 'Gamma');
      await sourceWorkbook.activeSheet.setCell('O4', 10);
      await sourceWorkbook.activeSheet.sortRange('N1:O4', {
        hasHeaders: true,
        columns: [{ column: 1, direction: 'desc' }],
      });
      await sourceWorkbook.activeSheet.setCell('Q1', 'Quarter');
      await sourceWorkbook.activeSheet.setCell('R1', 'Bookings');
      await sourceWorkbook.activeSheet.setCell('Q2', 'Q1');
      await sourceWorkbook.activeSheet.setCell('R2', 10);
      await sourceWorkbook.activeSheet.setCell('Q3', 'Q2');
      await sourceWorkbook.activeSheet.setCell('R3', 16);
      await sourceWorkbook.activeSheet.setCell('Q4', 'Q3');
      await sourceWorkbook.activeSheet.setCell('R4', 12);
      const chartReceipt = await sourceWorkbook.activeSheet.charts.add({
        type: 'column',
        title: 'Replay Bookings',
        dataRange: 'Q1:R4',
        anchorRow: 5,
        anchorCol: 16,
        width: 360,
        height: 240,
      });
      const shapeReceipt = await sourceWorkbook.activeSheet.shapes.add({
        type: 'rect',
        name: 'Replay Anchor',
        anchorRow: 7,
        anchorCol: 3,
        xOffset: 8,
        yOffset: 12,
        width: 96,
        height: 48,
        anchorMode: 'oneCell',
      });

      const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1');
      const snapshotRootPayload = createYrsFullStateSnapshotRootPayload(
        await sourceHandle.createSyncPort().encodeDiff(new Uint8Array([0])),
      );
      const snapshotRootRecord = await createWorkbookSnapshotRootRecord(
        namespace,
        snapshotRootPayload,
      );
      const semanticChangeSetRecord = await objectRecord(
        namespace,
        'workbook.semanticChangeSet.v1',
        { schemaVersion: 1, changes: [] },
      );
      const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
      const initialized = await provider.initializeGraph({
        expectedRegistryRevision: null,
        graphId: 'graph-1',
        rootWrite: {
          snapshotRootRecord,
          semanticChangeSetRecord,
          author: AUTHOR,
          createdAt: CREATED_AT,
          completenessDiagnostics: [],
        },
      });
      expectInitializeSuccess(initialized);

      const lifecycleHydrator = createDocumentLifecycleSnapshotRootHydrator({
        userTimezone: 'UTC',
        documentIdFactory: () => 'stored-materialized-doc',
      });
      const hydrateYrsFullState = jest.fn(
        lifecycleHydrator.hydrateYrsFullState.bind(lifecycleHydrator),
      );
      const service = createSnapshotRootMaterializationService({
        provider,
        hydrator: { hydrateYrsFullState },
      });

      const result = await service.materializeSnapshotRoot({ target: 'ref', refName: 'main' });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`expected materialization success: ${result.error.code}`);
      materialized = result.materialized;
      expect(result.commitId).toBe(initialized.rootCommit.id);
      expect(result.snapshotRootDigest).toEqual(snapshotRootRecord.digest);
      expect(result.snapshotRootRecord.digest).toEqual(snapshotRootRecord.digest);
      expect(result.mutationGuarantee).toBe('no-current-workbook-mutation');
      expect(hydrateYrsFullState).toHaveBeenCalledTimes(1);
      const hydrationInput = hydrateYrsFullState.mock.calls[0]?.[0];
      expect(hydrationInput).toMatchObject({
        source: 'record',
        objectDigest: snapshotRootRecord.digest,
        byteLength: snapshotRootPayload.byteLength,
      });
      expect(hydrationInput?.yrsFullStateBytes.byteLength).toBe(snapshotRootPayload.byteLength);
      expect(materialized.documentId).toBe('stored-materialized-doc');
      await expect(materialized.workbook.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 7,
      });
      await expect(materialized.workbook.activeSheet.getCell('A2')).resolves.toMatchObject({
        value: 42,
      });
      await expect(materialized.workbook.names.get('ReplayRevenue')).resolves.toMatchObject({
        name: 'ReplayRevenue',
        reference: 'Sheet1!A1:A2',
        comment: 'VC-06 replay range',
      });
      await expect(materialized.workbook.activeSheet.comments.getNote('B1')).resolves.toMatchObject({
        content: 'Replay note',
        author: 'VC Agent',
        cellAddress: 'B1',
      });
      const materializedTable = await materialized.workbook.activeSheet.tables.get('ReplaySales');
      expect(materializedTable).toMatchObject({
        name: 'ReplaySales',
        range: 'D1:E4',
        hasHeaderRow: true,
        hasTotalsRow: false,
        style: 'TableStyleMedium2',
      });
      expect(materializedTable?.columns.map((column) => column.name)).toEqual([
        'Region',
        'Revenue',
      ]);
      await expect(materialized.workbook.activeSheet.tables.getAtCell('E3')).resolves.toMatchObject({
        name: 'ReplaySales',
      });

      await expect(materialized.workbook.activeSheet.validations.get('G2')).resolves.toMatchObject({
        type: 'list',
        range: 'G1:G3',
        values: ['Open', 'Closed'],
        allowBlank: false,
        showDropdown: true,
        inputTitle: 'Replay status',
        inputMessage: 'Choose a replay status',
        errorTitle: 'Invalid status',
        errorMessage: 'Status must come from the replay list.',
      });
      await expect(materialized.workbook.activeSheet.validations.getCount()).resolves.toBe(1);

      await expect(
        materialized.workbook.activeSheet.conditionalFormats.get(conditionalFormat.id),
      ).resolves.toMatchObject({
        id: conditionalFormat.id,
        ranges: [{ startRow: 0, startCol: 8, endRow: 2, endCol: 8 }],
        rules: [
          expect.objectContaining({
            type: 'formula',
            formula: '=I1>1',
            style: expect.objectContaining({ backgroundColor: '#fff2cc' }),
          }),
        ],
      });
      await expect(materialized.workbook.activeSheet.conditionalFormats.getCount()).resolves.toBe(
        1,
      );

      expect(autoFilter.range).toBe('K1:L4');
      const materializedAutoFilter = (await materialized.workbook.activeSheet.filters.list()).find(
        (filter) =>
          filter.filterKind === 'autoFilter' && cellRangeEquals(filter.range, 0, 10, 3, 11),
      );
      expect(materializedAutoFilter).toBeDefined();
      expect(Object.values(materializedAutoFilter?.columnFilters ?? {})).toEqual([
        expect.objectContaining({ type: 'value', values: ['Open'] }),
      ]);
      await expect(materialized.workbook.activeSheet.filters.isDataFiltered()).resolves.toBe(true);

      await expect(materialized.workbook.activeSheet.getCell('N2')).resolves.toMatchObject({
        value: 'Alpha',
      });
      await expect(materialized.workbook.activeSheet.getCell('O2')).resolves.toMatchObject({
        value: 40,
      });
      await expect(materialized.workbook.activeSheet.getCell('N4')).resolves.toMatchObject({
        value: 'Gamma',
      });
      await expect(materialized.workbook.activeSheet.getCell('O4')).resolves.toMatchObject({
        value: 10,
      });

      await expect(
        materialized.workbook.activeSheet.charts.get(chartReceipt.chart.id),
      ).resolves.toMatchObject({
        id: chartReceipt.chart.id,
        type: 'column',
        title: 'Replay Bookings',
        dataRange: 'Q1:R4',
        anchorRow: 5,
        anchorCol: 16,
        width: 360,
        height: 240,
      });
      await expect(
        materialized.workbook.activeSheet.charts.findBySourceRange('Q1:R4'),
      ).resolves.toEqual([
        expect.objectContaining({
          chartId: chartReceipt.chart.id,
          rangeKind: 'dataRange',
        }),
      ]);

      await expect(
        materialized.workbook.activeSheet.objects.getInfo(shapeReceipt.id),
      ).resolves.toMatchObject({
        id: shapeReceipt.id,
        type: 'shape',
        name: 'Replay Anchor',
        width: 96,
        height: 48,
        anchorType: 'oneCell',
      });
      await expect(
        materialized.workbook.activeSheet.objects.getFullObject(shapeReceipt.id),
      ).resolves.toMatchObject({
        id: shapeReceipt.id,
        type: 'shape',
        name: 'Replay Anchor',
        position: expect.objectContaining({
          anchorType: 'oneCell',
          width: 96,
          height: 48,
          from: expect.objectContaining({
            xOffset: 8,
            yOffset: 12,
          }),
        }),
      });

      await sourceWorkbook.activeSheet.setCell('A1', 99);
      await sourceWorkbook.names.add('SourceOnly', 'Sheet1!A1', 'not in materialized replay');
      await sourceWorkbook.activeSheet.comments.setNote('B1', 'Source-only note', 'VC Agent');
      await sourceWorkbook.activeSheet.tables.add('T1:U2', {
        name: 'SourceOnlyTable',
        hasHeaders: false,
      });
      await sourceWorkbook.activeSheet.validations.setList('G1:G3', ['SourceOnly']);
      await sourceWorkbook.activeSheet.conditionalFormats.clear();
      await sourceWorkbook.activeSheet.filters.clear();
      await sourceWorkbook.activeSheet.charts.clear();
      const sourceObjects = await sourceWorkbook.activeSheet.objects.list();
      await sourceWorkbook.activeSheet.objects.removeMany(sourceObjects.map((object) => object.id));
      await expect(materialized.workbook.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 7,
      });
      await expect(materialized.workbook.names.get('SourceOnly')).resolves.toBeNull();
      await expect(materialized.workbook.activeSheet.comments.getNote('B1')).resolves.toMatchObject({
        content: 'Replay note',
      });
      await expect(
        materialized.workbook.activeSheet.tables.get('SourceOnlyTable'),
      ).resolves.toBeNull();
      await expect(materialized.workbook.activeSheet.validations.get('G2')).resolves.toMatchObject({
        values: ['Open', 'Closed'],
      });
      await expect(
        materialized.workbook.activeSheet.conditionalFormats.get(conditionalFormat.id),
      ).resolves.toMatchObject({
        id: conditionalFormat.id,
      });
      await expect(materialized.workbook.activeSheet.filters.list()).resolves.toContainEqual(
        expect.objectContaining({
          id: materializedAutoFilter?.id,
        }),
      );
      await expect(
        materialized.workbook.activeSheet.charts.get(chartReceipt.chart.id),
      ).resolves.toMatchObject({
        id: chartReceipt.chart.id,
      });
      await expect(
        materialized.workbook.activeSheet.objects.getInfo(shapeReceipt.id),
      ).resolves.toMatchObject({
        id: shapeReceipt.id,
      });
    } finally {
      if (materialized) await materialized.dispose();
      await sourceHandle.dispose();
    }
  });

  it('fails closed before hydration for legacy synthetic sheet-list snapshot roots', async () => {
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1');
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const snapshotRootRecord = await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
      sheets: [],
    });
    const initialized = await provider.initializeGraph({
      expectedRegistryRevision: null,
      graphId: 'graph-1',
      rootWrite: {
        snapshotRootRecord,
        semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
          schemaVersion: 1,
          changes: [],
        }),
        author: AUTHOR,
        createdAt: CREATED_AT,
        completenessDiagnostics: [],
      },
    });
    expectInitializeSuccess(initialized);
    const hydrateYrsFullState = jest.fn();
    const service = createSnapshotRootMaterializationService({
      provider,
      hydrator: { hydrateYrsFullState },
    });

    const result = await service.materializeCommitSnapshotRoot(initialized.rootCommit.id);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected materialization failure');
    expect(result.error.code).toBe('VERSION_SNAPSHOT_ROOT_MATERIALIZATION_RELOAD_FAILED');
    expect(result.snapshotRootDigest).toEqual(snapshotRootRecord.digest);
    expect(result.mutationGuarantee).toBe('no-current-workbook-mutation');
    expect(hydrateYrsFullState).not.toHaveBeenCalled();
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VERSION_SNAPSHOT_ROOT_MATERIALIZATION_RELOAD_FAILED',
        sourceDiagnostics: [
          expect.objectContaining({
            code: 'VERSION_SNAPSHOT_ROOT_RELOAD_INVALID_ROOT',
          }),
        ],
      }),
    ]);
  });
});

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

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.code}`);
  }
}

function cellRangeEquals(
  range: { startRow: number; startCol: number; endRow: number; endCol: number },
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
): boolean {
  return (
    range.startRow === startRow &&
    range.startCol === startCol &&
    range.endRow === endRow &&
    range.endCol === endCol
  );
}
