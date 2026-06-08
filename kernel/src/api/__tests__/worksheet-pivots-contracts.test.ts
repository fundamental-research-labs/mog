import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';
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
      getAllPivots: jest.fn().mockResolvedValue([config]),
      getPivot: jest.fn().mockResolvedValue(config),
      compute: jest.fn().mockResolvedValue(makePivotResult()),
      updatePivot: jest.fn().mockResolvedValue(config),
      getAllPivotItems: jest.fn().mockResolvedValue(makePivotItems()),
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
