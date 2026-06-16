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

function createCtx(): any {
  const config = makePivotConfig();
  return {
    pivot: {
      createPivot: jest.fn().mockResolvedValue(config),
      createPivotWithSheet: jest
        .fn()
        .mockResolvedValue({ sheetId: 'sheet-2', config: makePivotConfig() }),
      getAllPivots: jest.fn().mockResolvedValue([config]),
      getPivot: jest.fn().mockResolvedValue(config),
      compute: jest.fn().mockResolvedValue(makePivotResult()),
      updatePivot: jest.fn().mockResolvedValue(config),
      deletePivot: jest.fn().mockResolvedValue(true),
      refresh: jest.fn().mockResolvedValue(makePivotResult()),
      subscribe: jest.fn().mockReturnValue(jest.fn()),
      getAllPivotItems: jest.fn().mockResolvedValue(makePivotItems()),
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
          sheetId: SHEET_ID,
          startRow: 2,
          startCol: 3,
          endRow: 3,
          endCol: 4,
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
          sheetId: SHEET_ID,
          startRow: 2,
          startCol: 3,
          endRow: 3,
          endCol: 4,
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
          sheetId: SHEET_ID,
          startRow: 2,
          startCol: 3,
          endRow: 3,
          endCol: 4,
        },
        result: makePivotResult(),
      }),
    );
  });

  it('getInfo exposes contentArea from rendered bounds', async () => {
    const info = await pivots.getInfo('SalesPivot');

    expect(info).toEqual(
      expect.objectContaining({
        name: 'SalesPivot',
        location: 'D3',
        contentArea: 'D3:E4',
      }),
    );
    expect(ctx.pivot.compute).toHaveBeenCalledWith(SHEET_ID, 'pivot-1');
  });

  it('list exposes contentArea from rendered bounds', async () => {
    const list = await pivots.list();

    expect(list).toEqual([
      expect.objectContaining({
        name: 'SalesPivot',
        location: 'D3',
        contentArea: 'D3:E4',
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
          sheetId: SHEET_ID,
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
          sheetId: SHEET_ID,
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
