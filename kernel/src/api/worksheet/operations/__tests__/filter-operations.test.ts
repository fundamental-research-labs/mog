import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';

import * as FilterOps from '../filter-operations';

const SHEET_ID = sheetId('sheet-1');

function createMockCtx() {
  return {
    computeBridge: {
      getFiltersInSheet: jest.fn().mockResolvedValue([]),
      getAllTablesInSheet: jest.fn().mockResolvedValue([]),
      getCellPosition: jest.fn().mockResolvedValue(null),
    },
  } as any;
}

describe('FilterOps resolved ranges', () => {
  it('returns canonical table ranges from filter detail APIs', async () => {
    const ctx = createMockCtx();
    ctx.computeBridge.getFiltersInSheet.mockResolvedValue([
      {
        id: 'filter-1',
        type: 'autoFilter',
        tableId: 'table-1',
        headerStartCellId: 'header-a',
        headerEndCellId: 'header-b',
        dataEndCellId: 'moved-data-end',
        columnFilters: {},
      },
    ]);
    ctx.computeBridge.getAllTablesInSheet.mockResolvedValue([
      {
        id: 'table-1',
        range: { startRow: 0, startCol: 0, endRow: 3, endCol: 1 },
      },
    ]);
    ctx.computeBridge.getCellPosition
      .mockResolvedValueOnce({ sheetId: SHEET_ID, row: 0, col: 0 })
      .mockResolvedValueOnce({ sheetId: SHEET_ID, row: 0, col: 1 })
      .mockResolvedValueOnce({ sheetId: SHEET_ID, row: 2, col: 1 });

    const info = await FilterOps.getFilterInfo(ctx, SHEET_ID, 'filter-1');
    const details = await FilterOps.listFilterDetails(ctx, SHEET_ID);

    expect(info?.range).toEqual({ startRow: 0, startCol: 0, endRow: 3, endCol: 1 });
    expect(details).toEqual([
      {
        id: 'filter-1',
        range: { startRow: 0, startCol: 0, endRow: 3, endCol: 1 },
        columnFilters: {},
      },
    ]);
    expect(ctx.computeBridge.getCellPosition).not.toHaveBeenCalled();
  });

  it('uses canonical table ranges for overlap checks', async () => {
    const ctx = createMockCtx();
    ctx.computeBridge.getFiltersInSheet.mockResolvedValue([
      {
        id: 'filter-1',
        type: 'autoFilter',
        tableId: 'table-1',
        headerStartCellId: 'header-a',
        headerEndCellId: 'header-b',
        dataEndCellId: 'moved-data-end',
        columnFilters: {},
      },
    ]);
    ctx.computeBridge.getAllTablesInSheet.mockResolvedValue([
      {
        id: 'table-1',
        range: { startRow: 0, startCol: 0, endRow: 3, endCol: 1 },
      },
    ]);
    ctx.computeBridge.getCellPosition
      .mockResolvedValueOnce({ sheetId: SHEET_ID, row: 0, col: 0 })
      .mockResolvedValueOnce({ sheetId: SHEET_ID, row: 0, col: 1 })
      .mockResolvedValueOnce({ sheetId: SHEET_ID, row: 2, col: 1 });

    const result = await FilterOps.getFilterForRange(ctx, SHEET_ID, {
      startRow: 3,
      startCol: 0,
      endRow: 3,
      endCol: 0,
    });

    expect(result).toEqual({ id: 'filter-1' });
    expect(ctx.computeBridge.getCellPosition).not.toHaveBeenCalled();
  });
});
