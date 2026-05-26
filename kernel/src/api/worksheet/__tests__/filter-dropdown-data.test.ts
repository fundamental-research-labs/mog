import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';
import { WorksheetFiltersImpl } from '../filters';

const SHEET_ID = sheetId('sheet-1');

function createMockCtx(): any {
  return {
    writeGate: {
      assertWritable: jest.fn(),
    },
    computeBridge: {
      getFiltersInSheet: jest.fn().mockResolvedValue([]),
      getCellPosition: jest.fn().mockResolvedValue(null),
      getCellIdAt: jest.fn().mockResolvedValue(null),
      getCellValue: jest.fn().mockResolvedValue(null),
      tableEvaluateColumnFilter: jest.fn().mockResolvedValue(new Uint8Array()),
      tableBuildFilterDropdown: jest.fn().mockResolvedValue({
        items: [],
        hasBlank: false,
        blankCount: 0,
        blankSelected: true,
        totalRowCount: 0,
      }),
    },
  };
}

describe('WorksheetFiltersImpl.getFilterDropdownData', () => {
  let ctx: any;
  let filters: WorksheetFiltersImpl;

  beforeEach(() => {
    jest.clearAllMocks();
    ctx = createMockCtx();
    filters = new WorksheetFiltersImpl(ctx, SHEET_ID);
  });

  it('builds canonical dropdown data with explicit blank state', async () => {
    const mockFilter = {
      id: 'filter-1',
      type: 'autoFilter',
      headerStartCellId: 'header-a',
      headerEndCellId: 'header-b',
      dataEndCellId: 'data-end',
      columnFilters: {
        'header-a': { type: 'values', values: [], includeBlanks: true },
      },
    };
    const dropdownData = {
      items: [],
      hasBlank: true,
      blankCount: 2,
      blankSelected: true,
      totalRowCount: 3,
    };
    ctx.computeBridge.getFiltersInSheet.mockResolvedValue([mockFilter]);
    ctx.computeBridge.getCellPosition
      .mockResolvedValueOnce({ sheetId: SHEET_ID, row: 0, col: 0 })
      .mockResolvedValueOnce({ sheetId: SHEET_ID, row: 0, col: 1 })
      .mockResolvedValueOnce({ sheetId: SHEET_ID, row: 3, col: 1 });
    ctx.computeBridge.getCellIdAt.mockResolvedValue('header-a');
    ctx.computeBridge.getCellValue
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('A');
    ctx.computeBridge.tableBuildFilterDropdown.mockResolvedValue(dropdownData);

    const result = await filters.getFilterDropdownData(0, 'filter-1');

    expect(ctx.computeBridge.tableBuildFilterDropdown).toHaveBeenCalledWith(
      [null, '', 'A'],
      { type: 'values', included: [], includeBlanks: true },
      null,
    );
    expect(result).toBe(dropdownData);
  });

  it('composes visibility from other filtered columns', async () => {
    const mockFilter = {
      id: 'filter-1',
      type: 'autoFilter',
      headerStartCellId: 'header-a',
      headerEndCellId: 'header-b',
      dataEndCellId: 'data-end',
      columnFilters: {
        'header-a': { type: 'values', values: ['A'], includeBlanks: false },
        'header-b': { type: 'values', values: ['X'], includeBlanks: false },
      },
    };
    ctx.computeBridge.getFiltersInSheet.mockResolvedValue([mockFilter]);
    ctx.computeBridge.getCellPosition
      .mockResolvedValueOnce({ sheetId: SHEET_ID, row: 0, col: 0 })
      .mockResolvedValueOnce({ sheetId: SHEET_ID, row: 0, col: 1 })
      .mockResolvedValueOnce({ sheetId: SHEET_ID, row: 3, col: 1 })
      .mockResolvedValueOnce({ sheetId: SHEET_ID, row: 0, col: 1 });
    ctx.computeBridge.getCellIdAt.mockResolvedValue('header-a');
    ctx.computeBridge.getCellValue.mockImplementation(
      async (_sheet: unknown, row: number, col: number) => {
        if (col === 0) return row === 1 ? 'A' : null;
        return row === 2 ? 'Y' : 'X';
      },
    );
    ctx.computeBridge.tableEvaluateColumnFilter.mockResolvedValue(new Uint8Array([1, 0, 1]));

    await filters.getFilterDropdownData(0, 'filter-1');

    expect(ctx.computeBridge.tableEvaluateColumnFilter).toHaveBeenCalledWith(
      { type: 'values', included: ['X'], includeBlanks: false },
      ['X', 'Y', 'X'],
    );
    expect(ctx.computeBridge.tableBuildFilterDropdown).toHaveBeenCalledWith(
      ['A', null, null],
      { type: 'values', included: ['A'], includeBlanks: false },
      new Uint8Array([1, 0, 1]),
    );
  });

  it('returns empty dropdown data for missing filters and out-of-range columns', async () => {
    expect(await filters.getFilterDropdownData(0, 'missing')).toEqual({
      items: [],
      hasBlank: false,
      blankCount: 0,
      blankSelected: true,
      totalRowCount: 0,
    });

    ctx.computeBridge.getFiltersInSheet.mockResolvedValue([
      {
        id: 'filter-1',
        type: 'autoFilter',
        headerStartCellId: 'header-a',
        headerEndCellId: 'header-b',
        dataEndCellId: 'data-end',
        columnFilters: {},
      },
    ]);
    ctx.computeBridge.getCellPosition
      .mockResolvedValueOnce({ sheetId: SHEET_ID, row: 0, col: 0 })
      .mockResolvedValueOnce({ sheetId: SHEET_ID, row: 0, col: 1 })
      .mockResolvedValueOnce({ sheetId: SHEET_ID, row: 3, col: 1 });

    expect(await filters.getFilterDropdownData(3, 'filter-1')).toEqual({
      items: [],
      hasBlank: false,
      blankCount: 0,
      blankSelected: true,
      totalRowCount: 0,
    });
  });
});
