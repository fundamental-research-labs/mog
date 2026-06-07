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
});
