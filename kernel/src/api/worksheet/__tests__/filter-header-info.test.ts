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
      getFilterHeaderInfo: jest.fn().mockResolvedValue([]),
      getAllTablesInSheet: jest.fn().mockResolvedValue([]),
    },
  };
}

describe('WorksheetFiltersImpl.listHeaderInfo', () => {
  let ctx: any;
  let filters: WorksheetFiltersImpl;

  beforeEach(() => {
    jest.clearAllMocks();
    ctx = createMockCtx();
    filters = new WorksheetFiltersImpl(ctx, SHEET_ID);
  });

  it('suppresses stale table-backed headers without a live table owner', async () => {
    ctx.computeBridge.getAllTablesInSheet.mockResolvedValue([
      {
        id: 'Table2',
        name: 'Table2',
        displayName: 'Table2',
        sheetId: SHEET_ID,
      } as any,
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
      {
        filterId: 'sheet-filter',
        filterKind: 'autoFilter',
        range: { startRow: 8, startCol: 0, endRow: 12, endCol: 1 },
        row: 8,
        col: 0,
        headerCellId: 'sheet-a',
        hasActiveFilter: false,
        sourceType: 'sheetAutoFilter',
        capability: 'supported',
        unsupportedReasons: [],
        buttonVisible: true,
        hiddenButton: false,
        showButton: true,
      },
    ]);

    const result = await filters.listHeaderInfo();

    expect(ctx.computeBridge.getAllTablesInSheet).toHaveBeenCalledWith(SHEET_ID);
    expect(result.map((entry) => entry.filterId)).toEqual(['right-filter', 'sheet-filter']);
  });
});
