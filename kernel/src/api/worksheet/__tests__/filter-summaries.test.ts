import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';
import { WorksheetFiltersImpl } from '../filters';

const SHEET_ID = sheetId('sheet-1');

function createMockCtx(): any {
  return {
    writeGate: {
      assertWritable: jest.fn(),
    },
    awaitMaterialized: jest.fn().mockResolvedValue(undefined),
    computeBridge: {
      getFiltersInSheet: jest.fn().mockResolvedValue([]),
      getFilterHeaderInfo: jest.fn().mockResolvedValue([]),
      getAllTablesInSheet: jest.fn().mockResolvedValue([]),
      getCellPosition: jest.fn().mockResolvedValue(null),
    },
  };
}

describe('WorksheetFiltersImpl.listSummaries', () => {
  let ctx: any;
  let filters: WorksheetFiltersImpl;

  beforeEach(() => {
    jest.clearAllMocks();
    ctx = createMockCtx();
    filters = new WorksheetFiltersImpl(ctx, SHEET_ID);
  });

  it('treats active advanced filters as clearable', async () => {
    ctx.computeBridge.getFiltersInSheet.mockResolvedValue([
      {
        id: 'af1',
        type: 'advancedFilter',
        headerStartCellId: 'c-start',
        headerEndCellId: 'c-end',
        dataEndCellId: 'c-data-end',
        columnFilters: {},
        advancedFilter: {
          criteriaRange: {
            sheetId: SHEET_ID,
            startCellId: 'c-criteria-start',
            endCellId: 'c-criteria-end',
          },
          uniqueRecordsOnly: false,
        },
      },
    ]);
    ctx.computeBridge.getCellPosition
      .mockResolvedValueOnce({ row: 0, col: 0 })
      .mockResolvedValueOnce({ row: 0, col: 1 })
      .mockResolvedValueOnce({ row: 5, col: 1 });

    const result = await filters.listSummaries();

    expect(result).toEqual([
      {
        id: 'af1',
        filterKind: 'advancedFilter',
        range: { startRow: 0, startCol: 0, endRow: 5, endCol: 1 },
        activeColumnCount: 0,
        hasActiveCriteria: true,
        hasActiveFilter: true,
        clearable: true,
        detailsReady: true,
        capability: 'supported',
        unsupportedReasons: [],
      },
    ]);
  });

  it('suppresses stale table filters without a live table owner', async () => {
    ctx.computeBridge.getAllTablesInSheet.mockResolvedValue([
      {
        id: 'Table2',
        name: 'Table2',
        displayName: 'Table2',
        sheetId: SHEET_ID,
        range: { startRow: 1, startCol: 4, endRow: 3, endCol: 5 },
      } as any,
    ]);
    ctx.computeBridge.getFiltersInSheet.mockResolvedValue([
      {
        id: 'left-filter',
        type: 'tableFilter',
        tableId: 'Table1',
        columnFilters: {},
        startRow: 1,
        startCol: 1,
        endRow: 3,
        endCol: 2,
      },
      {
        id: 'right-filter',
        type: 'tableFilter',
        tableId: 'Table2',
        columnFilters: {},
        startRow: 1,
        startCol: 4,
        endRow: 3,
        endCol: 5,
      },
      {
        id: 'sheet-filter',
        type: 'autoFilter',
        columnFilters: {},
        startRow: 8,
        startCol: 0,
        endRow: 12,
        endCol: 1,
      },
    ]);
    ctx.computeBridge.getFilterHeaderInfo.mockResolvedValue([
      {
        filterId: 'left-filter',
        filterKind: 'tableFilter',
        range: { startRow: 1, startCol: 1, endRow: 3, endCol: 2 },
        row: 1,
        col: 1,
        headerCellId: 'left-b',
        hasActiveFilter: false,
        tableId: 'Table1',
        sourceType: 'tableAutoFilter',
        capability: 'supported',
        unsupportedReasons: [],
        buttonVisible: true,
        hiddenButton: false,
        showButton: true,
      },
      {
        filterId: 'right-filter',
        filterKind: 'tableFilter',
        range: { startRow: 1, startCol: 4, endRow: 3, endCol: 5 },
        row: 1,
        col: 4,
        headerCellId: 'right-e',
        hasActiveFilter: false,
        tableId: 'Table2',
        sourceType: 'tableAutoFilter',
        capability: 'supported',
        unsupportedReasons: [],
        buttonVisible: true,
        hiddenButton: false,
        showButton: true,
      },
    ]);

    const result = await filters.listSummaries();

    expect(ctx.computeBridge.getAllTablesInSheet).toHaveBeenCalledWith(SHEET_ID);
    expect(result.map((entry) => entry.id)).toEqual(['right-filter', 'sheet-filter']);
  });
});
