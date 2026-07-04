import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';
import { findExistingFilterForRange } from '../filter-selection';

const SHEET_ID = sheetId('sheet-1');
const FILTER_RANGE = { startRow: 0, startCol: 0, endRow: 2, endCol: 1 };

function createCtx(filters: any[], tables: any[] = []): any {
  const positions = new Map<string, { row: number; col: number }>([
    ['auto-start', { row: 0, col: 0 }],
    ['auto-end', { row: 0, col: 1 }],
    ['auto-data-end', { row: 2, col: 1 }],
  ]);

  return {
    computeBridge: {
      getFiltersInSheet: jest.fn().mockResolvedValue(filters),
      getAllTablesInSheet: jest.fn().mockResolvedValue(tables),
      getCellPosition: jest.fn((_sheetId, cellId: string) =>
        Promise.resolve(positions.get(cellId) ?? null),
      ),
    },
  };
}

describe('findExistingFilterForRange', () => {
  it('does not treat table-backed filters as existing sheet autofilters', async () => {
    const ctx = createCtx(
      [
        {
          id: 'table-filter',
          type: 'tableFilter',
          tableId: 'table-1',
          columnFilters: {},
        },
      ],
      [
        {
          id: 'table-1',
          range: FILTER_RANGE,
        },
      ],
    );

    await expect(findExistingFilterForRange(ctx, SHEET_ID, FILTER_RANGE)).resolves.toBeNull();
  });

  it('returns an existing sheet autofilter for the same range', async () => {
    const ctx = createCtx([
      {
        id: 'table-filter',
        type: 'tableFilter',
        tableId: 'table-1',
        columnFilters: {},
      },
      {
        id: 'sheet-filter',
        type: 'autoFilter',
        headerStartCellId: 'auto-start',
        headerEndCellId: 'auto-end',
        dataEndCellId: 'auto-data-end',
        columnFilters: {},
      },
    ]);

    await expect(findExistingFilterForRange(ctx, SHEET_ID, FILTER_RANGE)).resolves.toMatchObject({
      id: 'sheet-filter',
      type: 'autoFilter',
    });
  });
});
