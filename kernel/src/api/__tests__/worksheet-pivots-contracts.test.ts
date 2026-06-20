import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';
import { createHandleLiveness } from '../lifecycle/handle-liveness';
import { WorksheetPivotsImpl } from '../worksheet/pivots/index';

const SHEET_ID = sheetId('sheet-1');

function makePivotConfig(overrides?: Record<string, any>) {
  return {
    id: 'pivot-1',
    name: 'SalesPivot',
    sourceSheetName: 'Sheet1',
    sourceRange: { startRow: 0, startCol: 0, endRow: 5, endCol: 1 },
    outputSheetName: 'Sheet1',
    outputLocation: { row: 2, col: 3 },
    fields: [
      { id: 'Category', name: 'Category', dataType: 'string' },
      { id: 'Amount', name: 'Amount', dataType: 'number' },
    ],
    placements: [
      { fieldId: 'Category', area: 'row', position: 0 },
      { fieldId: 'Amount', area: 'value', position: 0, aggregateFunction: 'sum' },
    ],
    filters: [],
    calculatedFields: [],
    ...overrides,
  };
}

function makePivotResult() {
  return {
    rows: [],
    columnHeaders: [],
    renderedBounds: {
      totalRows: 2,
      totalCols: 2,
      firstDataRow: 1,
      firstDataCol: 1,
      numDataRows: 1,
      numDataCols: 1,
    },
    sourceRowCount: 1,
  };
}

function makePivotItems() {
  return [
    {
      fieldId: 'Category',
      fieldName: 'Category',
      area: 'row',
      items: [
        {
          key: '\u0000BLANK\u0000',
          value: '(blank)',
          fieldId: 'Category',
          area: 'row',
          depth: 0,
          isExpandable: false,
          isExpanded: true,
          isVisible: true,
          isSubtotal: false,
          isGrandTotal: false,
        },
        {
          key: 'T:(blank)',
          value: '(blank)',
          fieldId: 'Category',
          area: 'row',
          depth: 0,
          isExpandable: false,
          isExpanded: true,
          isVisible: true,
          isSubtotal: false,
          isGrandTotal: false,
        },
        {
          key: 'T:travel',
          value: 'Travel',
          fieldId: 'Category',
          area: 'row',
          depth: 0,
          isExpandable: false,
          isExpanded: true,
          isVisible: true,
          isSubtotal: false,
          isGrandTotal: false,
        },
      ],
    },
  ];
}

function makeUnsupportedImportedPivotRecord() {
  return {
    sourceKind: 'unsupportedImport',
    status: 'unsupported',
    importIdentity: 'xlsx:pivot-cache-1',
    outputSheetId: SHEET_ID,
    config: makePivotConfig({ id: 'imported-pivot-1', name: 'ImportedPivot' }),
    capabilities: {
      canEditFields: false,
      canReorderFields: false,
      canRemoveFields: false,
      canChangeAggregate: false,
      canRefresh: false,
      canDelete: false,
      canExport: true,
      unsupportedReason: 'External cache definition is not supported.',
    },
    unsupportedReason: 'External cache definition is not supported.',
  };
}

function makeKernelReceipt(action: string, placementId?: string) {
  return {
    kernelReceiptId: `receipt-${action}-${placementId ?? 'pivot-1'}`,
    pivotId: 'pivot-1',
    effects: placementId ? [{ type: 'placementUpdated', placementId }] : [],
    mutationResult: { action },
    updateReason: action,
    refreshPolicy: 'refreshAndMaterialize',
    materialized: true,
    configRevision: 1,
    status: 'applied',
  };
}

function expectHandleConfigReceipt(receipt: any, kind: string) {
  expect(receipt).toEqual(
    expect.objectContaining({
      kind,
      status: 'applied',
      sheetId: SHEET_ID,
      pivotId: 'pivot-1',
      diagnostics: [],
      effects: expect.arrayContaining([
        expect.objectContaining({ type: 'updatedConfig', objectId: 'pivot-1' }),
        expect.objectContaining({ type: 'invalidatedCache', objectId: 'pivot-1' }),
      ]),
    }),
  );
}

function createCtx(): any {
  const config = makePivotConfig();
  return {
    computeBridge: {
      getAllSheetIds: jest.fn().mockResolvedValue([SHEET_ID]),
      getSheetName: jest.fn().mockResolvedValue('Sheet1'),
      queryRange: jest
        .fn()
        .mockImplementation(async (_sheetId, startRow, startCol, endRow, endCol) => {
          const cells = [];
          if (startRow === 0 && endRow === 0) {
            const headers = ['Category', 'Amount'];
            for (let col = startCol; col <= endCol; col++) {
              cells.push({ row: 0, col, value: headers[col - startCol] ?? `Column${col + 1}` });
            }
          } else {
            for (let col = startCol; col <= endCol; col++) {
              cells.push({ row: startRow, col, value: col === startCol ? 'Travel' : 100 });
            }
          }
          return { cells };
        }),
    },
    pivot: {
      createPivot: jest.fn().mockResolvedValue(config),
      createPivotWithSheet: jest
        .fn()
        .mockResolvedValue({ sheetId: 'sheet-2', config: makePivotConfig() }),
      getAllPivots: jest.fn().mockResolvedValue([config]),
      getImportedPivotViewRecords: jest.fn().mockResolvedValue([]),
      getPivot: jest.fn().mockResolvedValue(config),
      compute: jest.fn().mockResolvedValue(makePivotResult()),
      updatePivot: jest.fn().mockResolvedValue(config),
      deletePivot: jest.fn().mockResolvedValue(true),
      refresh: jest.fn().mockResolvedValue(makePivotResult()),
      subscribe: jest.fn().mockReturnValue(jest.fn()),
      getAllPivotItems: jest.fn().mockResolvedValue(makePivotItems()),
      addPlacement: jest.fn(async (_pivotId: string, spec: any) => ({
        ...makeKernelReceipt('addPlacement', spec.placementId ?? 'row:Category:1'),
        placementId: spec.placementId ?? 'row:Category:1',
      })),
      removePlacement: jest.fn(async (_pivotId: string, placementId: string) => ({
        ...makeKernelReceipt('removePlacement', placementId),
        effects: [{ type: 'placementRemoved', placementId }],
      })),
      movePlacement: jest.fn(async (_pivotId: string, placementId: string) =>
        makeKernelReceipt('movePlacement', placementId),
      ),
      setAggregateFunction: jest.fn(async (_pivotId: string, placementId: string) =>
        makeKernelReceipt('setAggregateFunction', placementId),
      ),
      renameValuePlacement: jest.fn(async (_pivotId: string, placementId: string) =>
        makeKernelReceipt('renameValuePlacement', placementId),
      ),
      setSortOrder: jest.fn(async (_pivotId: string, placementId: string) =>
        makeKernelReceipt('setSortOrder', placementId),
      ),
      setSortByValue: jest.fn(async (_pivotId: string, placementId: string) =>
        makeKernelReceipt('setSortByValue', placementId),
      ),
    },
    pivotExpansionProvider: {
      toggleExpanded: jest.fn().mockReturnValue(false),
      setAllExpanded: jest.fn(),
      getExpansionState: jest.fn().mockReturnValue({ expandedRows: {}, expandedColumns: {} }),
    },
    writeGate: {
      assertWritable: jest.fn(),
    },
  };
}

describe('WorksheetPivotsImpl contracts', () => {
  let ctx: ReturnType<typeof createCtx>;
  let pivots: WorksheetPivotsImpl;

  beforeEach(() => {
    ctx = createCtx();
    pivots = new WorksheetPivotsImpl(ctx, SHEET_ID);
  });

  it('add returns a define-only operation receipt preserving the created config', async () => {
    const receipt = await pivots.add(makePivotConfig());

    expect(receipt).toEqual(
      expect.objectContaining({
        kind: 'pivot.add',
        status: 'applied',
        pivotId: 'pivot-1',
        config: expect.objectContaining({ id: 'pivot-1', name: 'SalesPivot' }),
        lifecycle: 'defineOnly',
        materialized: false,
        renderedRange: null,
        result: null,
        diagnostics: [],
        effects: expect.arrayContaining([
          expect.objectContaining({ type: 'createdObject', objectId: 'pivot-1' }),
          expect.objectContaining({ type: 'storedMetadata', objectId: 'pivot-1' }),
        ]),
      }),
    );
    expect(ctx.pivot.createPivot).toHaveBeenCalled();
    expect(ctx.pivot.refresh).not.toHaveBeenCalled();
  });

  it('add can request materialization and returns rendered result details', async () => {
    const receipt = await pivots.add(makePivotConfig(), { lifecycle: 'materialize' });

    expect(ctx.pivot.refresh).toHaveBeenCalledWith(SHEET_ID, 'pivot-1');
    expect(receipt).toEqual(
      expect.objectContaining({
        kind: 'pivot.add',
        status: 'applied',
        lifecycle: 'materialize',
        materialized: true,
        renderedRange: {
          startRow: 2,
          startCol: 3,
          endRow: 3,
          endCol: 4,
          address: 'D3:E4',
        },
        result: makePivotResult(),
        diagnostics: [],
        effects: expect.arrayContaining([
          expect.objectContaining({ type: 'storedMetadata', objectId: 'pivot-1' }),
          expect.objectContaining({
            type: 'materializedCells',
            objectId: 'pivot-1',
            range: 'D3:E4',
          }),
        ]),
      }),
    );
  });

  it('addWithSheet returns a receipt preserving sheetId and created config', async () => {
    const receipt = await pivots.addWithSheet('Pivot Output', makePivotConfig());

    expect(ctx.pivot.createPivotWithSheet).toHaveBeenCalledWith(
      'Pivot Output',
      expect.objectContaining({ name: 'SalesPivot' }),
    );
    expect(receipt).toEqual(
      expect.objectContaining({
        kind: 'pivot.addWithSheet',
        status: 'applied',
        sheetId: 'sheet-2',
        pivotId: 'pivot-1',
        config: expect.objectContaining({ id: 'pivot-1', name: 'SalesPivot' }),
        lifecycle: 'defineOnly',
        materialized: false,
        effects: expect.arrayContaining([
          expect.objectContaining({
            type: 'createdObject',
            sheetId: 'sheet-2',
            objectId: 'sheet-2',
          }),
          expect.objectContaining({ type: 'storedMetadata', objectId: 'pivot-1' }),
        ]),
      }),
    );
  });

  it('addWithSheet forwards worksheet insertion options to the pivot bridge', async () => {
    await pivots.addWithSheet('Pivot Output', makePivotConfig(), {
      insertBeforeSheetId: sheetId('source-sheet'),
      insertIndex: 0,
    });

    expect(ctx.pivot.createPivotWithSheet).toHaveBeenCalledWith(
      'Pivot Output',
      expect.objectContaining({ name: 'SalesPivot' }),
      { insertBeforeSheetId: 'source-sheet', insertIndex: 0 },
    );
  });

  it('refresh returns a materialization receipt with result details', async () => {
    const receipt = await pivots.refresh('SalesPivot');

    expect(ctx.pivot.refresh).toHaveBeenCalledWith(SHEET_ID, 'pivot-1');
    expect(receipt).toEqual(
      expect.objectContaining({
        kind: 'pivot.refresh',
        status: 'applied',
        pivotId: 'pivot-1',
        config: expect.objectContaining({ id: 'pivot-1', name: 'SalesPivot' }),
        materialized: true,
        renderedRange: {
          startRow: 2,
          startCol: 3,
          endRow: 3,
          endCol: 4,
          address: 'D3:E4',
        },
        result: makePivotResult(),
        diagnostics: [],
        effects: expect.arrayContaining([
          expect.objectContaining({
            type: 'materializedCells',
            objectId: 'pivot-1',
            range: 'D3:E4',
          }),
          expect.objectContaining({ type: 'refreshedViewport', objectId: 'pivot-1' }),
        ]),
      }),
    );
  });

  it('compute returns a read-only operation receipt with result details', async () => {
    const receipt = await pivots.compute('SalesPivot', true);

    expect(ctx.pivot.compute).toHaveBeenCalledWith(SHEET_ID, 'pivot-1', true);
    expect(receipt).toEqual(
      expect.objectContaining({
        kind: 'pivot.compute',
        status: 'completed',
        sheetId: SHEET_ID,
        pivotId: 'pivot-1',
        result: makePivotResult(),
        diagnostics: [],
        effects: expect.arrayContaining([
          expect.objectContaining({ type: 'computedGrid', objectId: 'pivot-1' }),
          expect.objectContaining({ type: 'worksheetUnchanged', objectId: 'pivot-1' }),
        ]),
      }),
    );
  });

  it('compute returns a failed receipt when pure compute produces no result', async () => {
    ctx.pivot.compute.mockResolvedValue(null);

    const receipt = await pivots.compute('SalesPivot');

    expect(receipt).toEqual(
      expect.objectContaining({
        kind: 'pivot.compute',
        status: 'failed',
        sheetId: SHEET_ID,
        pivotId: 'pivot-1',
        result: null,
        effects: [],
        diagnostics: [
          expect.objectContaining({
            code: 'PIVOT_COMPUTE_FAILED',
            target: expect.objectContaining({ sheetId: SHEET_ID, pivotId: 'pivot-1' }),
          }),
        ],
      }),
    );
  });

  it('compute returns a failed receipt when the pivot is missing', async () => {
    ctx.pivot.getAllPivots.mockResolvedValue([]);

    const receipt = await pivots.compute('MissingPivot');

    expect(ctx.pivot.compute).not.toHaveBeenCalled();
    expect(receipt).toEqual(
      expect.objectContaining({
        kind: 'pivot.compute',
        status: 'failed',
        sheetId: SHEET_ID,
        pivotId: 'MissingPivot',
        result: null,
        effects: [],
        diagnostics: [
          expect.objectContaining({
            code: 'PIVOT_COMPUTE_PIVOT_NOT_FOUND',
            target: expect.objectContaining({ sheetId: SHEET_ID, pivotId: 'MissingPivot' }),
          }),
        ],
      }),
    );
  });

  it('compute returns an unsupported receipt for unsupported imported pivots', async () => {
    ctx.pivot.getAllPivots.mockResolvedValue([]);
    ctx.pivot.getImportedPivotViewRecords.mockResolvedValue([makeUnsupportedImportedPivotRecord()]);

    const receipt = await pivots.compute('ImportedPivot');

    expect(ctx.pivot.compute).not.toHaveBeenCalled();
    expect(receipt).toEqual(
      expect.objectContaining({
        kind: 'pivot.compute',
        status: 'unsupported',
        sheetId: SHEET_ID,
        pivotId: 'imported-pivot-1',
        result: null,
        effects: [],
        diagnostics: [
          expect.objectContaining({
            code: 'PIVOT_COMPUTE_UNSUPPORTED_PIVOT',
            target: expect.objectContaining({ pivotId: 'imported-pivot-1' }),
          }),
        ],
      }),
    );
  });

  it('queryPivot returns a read-only operation receipt with flat query result', async () => {
    const receipt = await pivots.queryPivot('SalesPivot');

    expect(ctx.pivot.compute).toHaveBeenCalledWith(SHEET_ID, 'pivot-1');
    expect(receipt).toEqual(
      expect.objectContaining({
        kind: 'pivot.query',
        status: 'completed',
        sheetId: SHEET_ID,
        pivotId: 'pivot-1',
        result: expect.objectContaining({
          pivotName: 'SalesPivot',
          rowFields: ['Category'],
          valueFields: ['Sum of Amount'],
        }),
        diagnostics: [],
        effects: [expect.objectContaining({ type: 'worksheetUnchanged', objectId: 'pivot-1' })],
      }),
    );
  });

  it('queryPivot returns a failed receipt when the query has no result', async () => {
    ctx.pivot.compute.mockResolvedValue(null);

    const receipt = await pivots.queryPivot('SalesPivot');

    expect(receipt).toEqual(
      expect.objectContaining({
        kind: 'pivot.query',
        status: 'failed',
        sheetId: SHEET_ID,
        pivotId: 'pivot-1',
        result: null,
        effects: [],
        diagnostics: [
          expect.objectContaining({
            code: 'PIVOT_QUERY_FAILED',
            target: expect.objectContaining({ sheetId: SHEET_ID, pivotId: 'pivot-1' }),
          }),
        ],
      }),
    );
  });

  it('queryPivot returns a failed receipt when the pivot is missing', async () => {
    ctx.pivot.getAllPivots.mockResolvedValue([]);

    const receipt = await pivots.queryPivot('MissingPivot');

    expect(ctx.pivot.compute).not.toHaveBeenCalled();
    expect(receipt).toEqual(
      expect.objectContaining({
        kind: 'pivot.query',
        status: 'failed',
        sheetId: SHEET_ID,
        pivotId: 'MissingPivot',
        result: null,
        effects: [],
        diagnostics: [
          expect.objectContaining({
            code: 'PIVOT_QUERY_PIVOT_NOT_FOUND',
            target: expect.objectContaining({ sheetId: SHEET_ID, pivotId: 'MissingPivot' }),
          }),
        ],
      }),
    );
  });

  it('queryPivot returns an unsupported receipt for unsupported imported pivots', async () => {
    ctx.pivot.getAllPivots.mockResolvedValue([]);
    ctx.pivot.getImportedPivotViewRecords.mockResolvedValue([makeUnsupportedImportedPivotRecord()]);

    const receipt = await pivots.queryPivot('ImportedPivot');

    expect(ctx.pivot.compute).not.toHaveBeenCalled();
    expect(receipt).toEqual(
      expect.objectContaining({
        kind: 'pivot.query',
        status: 'unsupported',
        sheetId: SHEET_ID,
        pivotId: 'imported-pivot-1',
        result: null,
        effects: [],
        diagnostics: [
          expect.objectContaining({
            code: 'PIVOT_QUERY_UNSUPPORTED_PIVOT',
            target: expect.objectContaining({ pivotId: 'imported-pivot-1' }),
          }),
        ],
      }),
    );
  });

  it('refreshAll returns an aggregate receipt with per-pivot materialization receipts', async () => {
    const config1 = makePivotConfig();
    const config2 = makePivotConfig({
      id: 'pivot-2',
      name: 'RevenuePivot',
      outputLocation: { row: 5, col: 1 },
    });
    ctx.pivot.getAllPivots.mockResolvedValue([config1, config2]);
    ctx.pivot.getPivot.mockImplementation(async (_sheetId: string, pivotId: string) =>
      pivotId === 'pivot-2' ? config2 : config1,
    );

    const receipt = await pivots.refreshAll();

    expect(ctx.pivot.refresh).toHaveBeenCalledTimes(2);
    expect(ctx.pivot.refresh).toHaveBeenCalledWith(SHEET_ID, 'pivot-1');
    expect(ctx.pivot.refresh).toHaveBeenCalledWith(SHEET_ID, 'pivot-2');
    expect(receipt).toEqual(
      expect.objectContaining({
        kind: 'pivot.refreshAll',
        status: 'applied',
        sheetId: SHEET_ID,
        pivotIds: ['pivot-1', 'pivot-2'],
        materialized: true,
        materializedCount: 2,
        failedCount: 0,
        renderedRanges: [
          { startRow: 2, startCol: 3, endRow: 3, endCol: 4, address: 'D3:E4' },
          { startRow: 5, startCol: 1, endRow: 6, endCol: 2, address: 'B6:C7' },
        ],
        diagnostics: [],
      }),
    );
    expect(receipt.receipts).toHaveLength(2);
    expect(receipt.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'materializedCells', objectId: 'pivot-1' }),
        expect.objectContaining({ type: 'materializedCells', objectId: 'pivot-2' }),
      ]),
    );
  });

  it('refreshAll reports a no-op aggregate receipt when the worksheet has no pivots', async () => {
    ctx.pivot.getAllPivots.mockResolvedValue([]);

    const receipt = await pivots.refreshAll();

    expect(ctx.pivot.refresh).not.toHaveBeenCalled();
    expect(receipt).toEqual(
      expect.objectContaining({
        kind: 'pivot.refreshAll',
        status: 'noOp',
        sheetId: SHEET_ID,
        pivotIds: [],
        receipts: [],
        materialized: false,
        materializedCount: 0,
        failedCount: 0,
        renderedRanges: [],
        diagnostics: [],
        effects: [{ type: 'worksheetUnchanged', sheetId: SHEET_ID }],
      }),
    );
  });

  it('refreshAll reports partial when one pivot fails to materialize', async () => {
    const config1 = makePivotConfig();
    const config2 = makePivotConfig({ id: 'pivot-2', name: 'RevenuePivot' });
    ctx.pivot.getAllPivots.mockResolvedValue([config1, config2]);
    ctx.pivot.getPivot.mockImplementation(async (_sheetId: string, pivotId: string) =>
      pivotId === 'pivot-2' ? config2 : config1,
    );
    ctx.pivot.refresh.mockImplementation(async (_sheetId: string, pivotId: string) =>
      pivotId === 'pivot-2' ? null : makePivotResult(),
    );

    const receipt = await pivots.refreshAll();

    expect(receipt).toEqual(
      expect.objectContaining({
        kind: 'pivot.refreshAll',
        status: 'partial',
        pivotIds: ['pivot-1', 'pivot-2'],
        materialized: false,
        materializedCount: 1,
        failedCount: 1,
      }),
    );
    expect(receipt.receipts.map((child) => child.status)).toEqual(['applied', 'failed']);
    expect(receipt.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PIVOT_MATERIALIZATION_FAILED',
          target: expect.objectContaining({ pivotId: 'pivot-2' }),
        }),
      ]),
    );
  });

  it('field mutations return applied operation receipts without materialized cell claims', async () => {
    const receipt = await pivots.addField('SalesPivot', 'Amount', 'column');

    expect(receipt).toEqual(
      expect.objectContaining({
        kind: 'pivot.addField',
        status: 'applied',
        pivotId: 'pivot-1',
        pivotName: 'SalesPivot',
        diagnostics: [],
        effects: expect.arrayContaining([
          expect.objectContaining({ type: 'updatedConfig', objectId: 'pivot-1' }),
          expect.objectContaining({ type: 'storedMetadata', objectId: 'pivot-1' }),
          expect.objectContaining({ type: 'invalidatedCache', objectId: 'pivot-1' }),
        ]),
      }),
    );
    expect(receipt.effects).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'materializedCells' })]),
    );
  });

  it('valid unchanged worksheet pivot mutations return no-op receipts', async () => {
    const receipt = await pivots.removeFilter('SalesPivot', 'Category');

    expect(receipt).toEqual(
      expect.objectContaining({
        kind: 'pivot.removeFilter',
        status: 'noOp',
        effects: [
          expect.objectContaining({
            type: 'worksheetUnchanged',
            sheetId: SHEET_ID,
            objectId: 'pivot-1',
          }),
        ],
        diagnostics: [],
      }),
    );
    expect(ctx.pivot.updatePivot).not.toHaveBeenCalled();
  });

  it('bridge failures return failed worksheet pivot receipts with diagnostics', async () => {
    ctx.pivot.updatePivot.mockRejectedValueOnce(new Error('write failed'));

    const receipt = await pivots.setFilter('SalesPivot', 'Category', { includeValues: ['Travel'] });

    expect(receipt).toEqual(
      expect.objectContaining({
        kind: 'pivot.setFilter',
        status: 'failed',
        effects: [],
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'PIVOT_MUTATION_FAILED',
            message: 'write failed',
            target: expect.objectContaining({ sheetId: SHEET_ID, pivotId: 'pivot-1' }),
          }),
        ]),
      }),
    );
  });

  it('handle refresh returns the same materialization receipt shape', async () => {
    const handle = await pivots.get('SalesPivot');

    const receipt = await handle!.refresh();

    expect(ctx.pivot.refresh).toHaveBeenCalledWith(SHEET_ID, 'pivot-1');
    expect(receipt).toEqual(
      expect.objectContaining({
        kind: 'pivot.refresh',
        status: 'applied',
        pivotId: 'pivot-1',
        materialized: true,
        renderedRange: {
          startRow: 2,
          startCol: 3,
          endRow: 3,
          endCol: 4,
          address: 'D3:E4',
        },
        result: makePivotResult(),
      }),
    );
  });

  it('handle config mutators return base operation receipts with useful fields', async () => {
    const handle = await pivots.get('SalesPivot');

    const updateReceipt = await handle!.update({ name: 'RenamedPivot' });
    expectHandleConfigReceipt(updateReceipt, 'pivot.handle.update');
    expect(updateReceipt.config).toEqual(expect.objectContaining({ id: 'pivot-1' }));

    const addFieldReceipt = await handle!.addField('Category', 'column', 0);
    expectHandleConfigReceipt(addFieldReceipt, 'pivot.handle.addField');
    expect(addFieldReceipt).toEqual(
      expect.objectContaining({
        fieldId: 'Category',
        area: 'column',
        placement: expect.objectContaining({ fieldId: 'Category', area: 'column' }),
      }),
    );

    const addValueReceipt = await handle!.addValueField('Amount', 'sum', 'Total Amount');
    expectHandleConfigReceipt(addValueReceipt, 'pivot.handle.addValueField');
    expect(addValueReceipt.placement).toEqual(
      expect.objectContaining({ fieldId: 'Amount', area: 'value' }),
    );

    const removeFieldReceipt = await handle!.removeField('Category', 'row');
    expectHandleConfigReceipt(removeFieldReceipt, 'pivot.handle.removeField');
    expect(removeFieldReceipt).toEqual(expect.objectContaining({ fieldId: 'Category' }));

    const renameReceipt = await handle!.renameValueField('Amount', 'Total Amount');
    expectHandleConfigReceipt(renameReceipt, 'pivot.handle.renameValueField');
    expect(renameReceipt.placement).toEqual(
      expect.objectContaining({ fieldId: 'Amount', displayName: 'Total Amount' }),
    );

    const aggregationReceipt = await handle!.changeAggregation('Amount', 'average');
    expectHandleConfigReceipt(aggregationReceipt, 'pivot.handle.changeAggregation');
    expect(aggregationReceipt.placement).toEqual(
      expect.objectContaining({ fieldId: 'Amount', aggregateFunction: 'average' }),
    );

    const showValuesReceipt = await handle!.setShowValuesAs('Amount', {
      type: 'percentOfGrandTotal',
    });
    expectHandleConfigReceipt(showValuesReceipt, 'pivot.handle.setShowValuesAs');
    expect(showValuesReceipt.placement).toEqual(
      expect.objectContaining({ showValuesAs: { type: 'percentOfGrandTotal' } }),
    );

    const filterReceipt = await handle!.setFilter('Category', { excludeValues: ['Travel'] });
    expectHandleConfigReceipt(filterReceipt, 'pivot.handle.setFilter');
    expect(filterReceipt).toEqual(expect.objectContaining({ fieldId: 'Category' }));

    const removeFilterReceipt = await handle!.removeFilter('Category');
    expectHandleConfigReceipt(removeFilterReceipt, 'pivot.handle.removeFilter');

    const layoutReceipt = await handle!.setLayout({ showRowGrandTotals: false });
    expectHandleConfigReceipt(layoutReceipt, 'pivot.handle.setLayout');

    const styleReceipt = await handle!.setStyle({ styleName: 'PivotStyleMedium2' });
    expectHandleConfigReceipt(styleReceipt, 'pivot.handle.setStyle');

    const visibilityReceipt = await handle!.setItemVisibility('Category', {
      ['\u0000BLANK\u0000']: false,
    });
    expectHandleConfigReceipt(visibilityReceipt, 'pivot.handle.setItemVisibility');
    expect(visibilityReceipt).toEqual(expect.objectContaining({ fieldId: 'Category' }));

    const dataSourceReceipt = await handle!.setDataSource('Sheet1!A1:B5');
    expectHandleConfigReceipt(dataSourceReceipt, 'pivot.handle.setDataSource');
  });

  it('handle placement and calculated-field mutators expose base fields', async () => {
    const handle = await pivots.get('SalesPivot');

    const addPlacementReceipt = await handle!.addPlacement({
      placementId: 'row:Category:1' as any,
      fieldId: 'Category',
      area: 'row',
    });
    expectHandleConfigReceipt(addPlacementReceipt, 'pivot.handle.addPlacement');
    expect(addPlacementReceipt).toEqual(
      expect.objectContaining({
        placementId: 'row:Category:1',
        placement: expect.objectContaining({ fieldId: 'Category', area: 'row', position: 1 }),
      }),
    );
    expect(addPlacementReceipt).not.toHaveProperty('kernelReceipt');
    expect(ctx.pivot.addPlacement).not.toHaveBeenCalled();

    const moveFieldReceipt = await handle!.moveField('Category', 'row', 'column', 0);
    expectHandleConfigReceipt(moveFieldReceipt, 'pivot.handle.moveField');
    expect(moveFieldReceipt).toEqual(expect.objectContaining({ fieldId: 'Category' }));

    const removePlacementReceipt = await handle!.removePlacement('row:Category:0' as any);
    expectHandleConfigReceipt(removePlacementReceipt, 'pivot.handle.removePlacement');

    const movePlacementReceipt = await handle!.movePlacement('row:Category:0' as any, 'column', 0);
    expectHandleConfigReceipt(movePlacementReceipt, 'pivot.handle.movePlacement');

    const aggregateReceipt = await handle!.setPlacementAggregateFunction(
      'value:Amount:0' as any,
      'average',
    );
    expectHandleConfigReceipt(aggregateReceipt, 'pivot.handle.setPlacementAggregateFunction');

    const renamePlacementReceipt = await handle!.renameValuePlacement(
      'value:Amount:0' as any,
      'Average Amount',
    );
    expectHandleConfigReceipt(renamePlacementReceipt, 'pivot.handle.renameValuePlacement');

    const sortReceipt = await handle!.setSortOrder('Category', 'desc');
    expectHandleConfigReceipt(sortReceipt, 'pivot.handle.setSortOrder');

    const placementSortReceipt = await handle!.setPlacementSortOrder(
      'row:Category:0' as any,
      'asc',
    );
    expectHandleConfigReceipt(placementSortReceipt, 'pivot.handle.setPlacementSortOrder');

    const sortByValueReceipt = await handle!.setSortByValue(
      'row:Category:0' as any,
      'value:Amount:0' as any,
      { order: 'desc' },
    );
    expectHandleConfigReceipt(sortByValueReceipt, 'pivot.handle.setSortByValue');

    const calculatedReceipt = await handle!.addCalculatedField({
      fieldId: 'Margin',
      name: 'Margin',
      formula: '=Amount',
    });
    expectHandleConfigReceipt(calculatedReceipt, 'pivot.handle.addCalculatedField');
    expect(calculatedReceipt).toEqual(
      expect.objectContaining({
        calculatedFieldId: 'Margin',
        kernelReceipt: expect.objectContaining({ calculatedFieldId: 'Margin' }),
      }),
    );
  });

  it('handle expansion and delete mutators preserve old return values on receipts', async () => {
    const handle = await pivots.get('SalesPivot');

    const toggleReceipt = await handle!.toggleExpanded('Category:Travel', true);
    expect(toggleReceipt).toEqual(
      expect.objectContaining({
        kind: 'pivot.handle.toggleExpanded',
        status: 'applied',
        expanded: false,
        effects: expect.arrayContaining([
          expect.objectContaining({ type: 'updatedExpansionState' }),
          expect.objectContaining({ type: 'invalidatedCache' }),
        ]),
        diagnostics: [],
      }),
    );

    const allExpandedReceipt = await handle!.setAllExpanded(true);
    expect(allExpandedReceipt).toEqual(
      expect.objectContaining({
        kind: 'pivot.handle.setAllExpanded',
        status: 'applied',
        expanded: true,
      }),
    );

    const deleteReceipt = await handle!.delete();
    expect(deleteReceipt).toEqual(
      expect.objectContaining({
        kind: 'pivot.handle.delete',
        status: 'applied',
        deleted: true,
        effects: expect.arrayContaining([
          expect.objectContaining({ type: 'removedObject', objectId: 'pivot-1' }),
          expect.objectContaining({ type: 'invalidatedCache', objectId: 'pivot-1' }),
        ]),
        diagnostics: [],
      }),
    );
  });

  it('getInfo exposes contentArea from rendered bounds', async () => {
    ctx.pivot.getAllPivots.mockResolvedValueOnce([
      makePivotConfig({ layout: { layoutForm: 'tabular' } }),
    ]);

    const info = await pivots.getInfo('SalesPivot');

    expect(info).toEqual(
      expect.objectContaining({
        name: 'SalesPivot',
        location: 'D3',
        contentArea: 'D3:E4',
        layout: { layoutForm: 'tabular' },
      }),
    );
    expect(ctx.pivot.compute).toHaveBeenCalledWith(SHEET_ID, 'pivot-1');
  });

  it('list exposes contentArea from rendered bounds', async () => {
    ctx.pivot.getAllPivots.mockResolvedValueOnce([
      makePivotConfig({ layout: { layoutForm: 'tabular' } }),
    ]);

    const list = await pivots.list();

    expect(list).toEqual([
      expect.objectContaining({
        name: 'SalesPivot',
        location: 'D3',
        contentArea: 'D3:E4',
        layout: { layoutForm: 'tabular' },
      }),
    ]);
    expect(ctx.pivot.compute).toHaveBeenCalledWith(SHEET_ID, 'pivot-1');
  });

  it('collection visibility treats the semantic blank item key as a blank value', async () => {
    await pivots.setPivotItemVisibility('SalesPivot', 'Category', {
      ['\u0000BLANK\u0000']: false,
    });

    expect(ctx.pivot.updatePivot).toHaveBeenCalledWith(
      SHEET_ID,
      'pivot-1',
      { filters: [{ fieldId: 'Category', excludeValues: [null] }] },
      { reason: 'filterChanged', refreshPolicy: 'refreshAndMaterialize' },
    );
  });

  it('handle visibility uses the same semantic blank item-key translation', async () => {
    const handle = await pivots.get('SalesPivot');

    await handle!.setItemVisibility('Category', {
      ['\u0000BLANK\u0000']: false,
    });

    expect(ctx.pivot.updatePivot).toHaveBeenCalledWith(
      SHEET_ID,
      'pivot-1',
      { filters: [{ fieldId: 'Category', excludeValues: [null] }] },
      { reason: 'filterChanged', refreshPolicy: 'refreshAndMaterialize' },
    );
  });

  it('collection setItemVisibility alias shares canonical visibility behavior', async () => {
    await pivots.setItemVisibility('SalesPivot', 'Category', {
      ['\u0000BLANK\u0000']: false,
    });

    expect(ctx.pivot.updatePivot).toHaveBeenCalledWith(
      SHEET_ID,
      'pivot-1',
      { filters: [{ fieldId: 'Category', excludeValues: [null] }] },
      { reason: 'filterChanged', refreshPolicy: 'refreshAndMaterialize' },
    );
  });

  it('handle getInfo is own-key visible and bound to pivot id', async () => {
    const handle = await pivots.get('SalesPivot');

    expect(Object.keys(handle!)).toContain('getInfo');
    const info = await handle!.getInfo({ includeItems: true });

    expect(info).toEqual(
      expect.objectContaining({
        id: 'pivot-1',
        name: 'SalesPivot',
        dataSource: 'Sheet1!A1:B6',
        contentArea: 'D3:E4',
        location: 'D3',
        rowFields: ['Category'],
        columnFields: [],
        valueFields: [expect.objectContaining({ field: 'Amount', aggregation: 'sum' })],
        filterFields: [],
        dataSourceType: 'range',
        renderedRange: {
          startRow: 2,
          startCol: 3,
          endRow: 3,
          endCol: 4,
          address: 'D3:E4',
        },
        availableMethods: expect.arrayContaining(['getInfo', 'setItemVisibility']),
        items: makePivotItems(),
      }),
    );
    expect(ctx.pivot.getPivot).toHaveBeenCalledWith(SHEET_ID, 'pivot-1');
  });

  it('handle getInfo defaults to range identity without item lists', async () => {
    const handle = await pivots.get('SalesPivot');

    const info = await handle!.getInfo();

    expect(info).toEqual(
      expect.objectContaining({
        contentArea: 'D3:E4',
        renderedRange: {
          startRow: 2,
          startCol: 3,
          endRow: 3,
          endCol: 4,
          address: 'D3:E4',
        },
      }),
    );
    expect(info).not.toHaveProperty('items');
  });

  it('multiple handles share the latest current config snapshot', async () => {
    const handleA = await pivots.get('SalesPivot');
    const handleB = await pivots.get('SalesPivot');
    ctx.pivot.updatePivot.mockImplementation(async (_sheetId, _pivotId, updates) =>
      makePivotConfig(updates),
    );

    await handleA!.update({ name: 'RenamedPivot' });

    expect(handleB!.getName()).toBe('RenamedPivot');
    expect(handleB!.getConfig()).toEqual(expect.objectContaining({ name: 'RenamedPivot' }));
  });

  it('deleted handles reject sync cached readback instead of returning stale config', async () => {
    const handle = await pivots.get('SalesPivot');

    await handle!.delete();

    expect(() => handle!.getConfig()).toThrow(/stale|invalidated/i);
  });

  it('pivot result subscriptions unregister when owner liveness invalidates', async () => {
    const liveness = createHandleLiveness({ label: 'Workbook' });
    pivots = new WorksheetPivotsImpl(ctx, SHEET_ID, null, liveness);
    const unsubscribe = jest.fn();
    ctx.pivot.subscribe.mockReturnValue(unsubscribe);
    const handle = await pivots.get('SalesPivot');

    handle!.subscribeResult(jest.fn());
    liveness.invalidate({ operation: 'test.close' });

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(() => handle!.subscribeResult(jest.fn())).toThrow(/disposed|closed|invalidated/i);
  });

  it('literal "(blank)" item keys remain text values distinct from semantic blanks', async () => {
    await pivots.setPivotItemVisibility('SalesPivot', 'Category', {
      ['T:(blank)']: false,
    });

    expect(ctx.pivot.updatePivot).toHaveBeenCalledWith(
      SHEET_ID,
      'pivot-1',
      { filters: [{ fieldId: 'Category', excludeValues: ['(blank)'] }] },
      { reason: 'filterChanged', refreshPolicy: 'refreshAndMaterialize' },
    );
  });
});
