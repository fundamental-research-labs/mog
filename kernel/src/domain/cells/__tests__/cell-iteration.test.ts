import { jest } from '@jest/globals';
import type { SheetId } from '@mog-sdk/contracts/core';

import { getCurrentRegion } from '../cell-iteration';
import type { DocumentContext } from '../../../context/types';

const SHEET_ID = 'sheet-1' as SheetId;

function makeContext(cells: Array<{ row: number; col: number; value?: unknown; formula?: string }>) {
  const queryRange = jest.fn(async () => ({ cells, merges: [] }));
  const getDataBounds = jest.fn(async () => ({
    minRow: Math.min(...cells.map((cell) => cell.row)),
    minCol: Math.min(...cells.map((cell) => cell.col)),
    maxRow: Math.max(...cells.map((cell) => cell.row)),
    maxCol: Math.max(...cells.map((cell) => cell.col)),
  }));

  return {
    ctx: {
      computeBridge: {
        getDataBounds,
        queryRange,
      },
    } as unknown as DocumentContext,
    getDataBounds,
    queryRange,
  };
}

describe('getCurrentRegion', () => {
  it('detects contiguous imported data beyond the old 1000-row query window', async () => {
    const cells: Array<{ row: number; col: number; value: string }> = [];
    for (let row = 0; row < 1813; row++) {
      for (let col = 0; col < 10; col++) {
        cells.push({ row, col, value: `${row}:${col}` });
      }
    }
    const { ctx, queryRange } = makeContext(cells);

    const region = await getCurrentRegion(ctx, SHEET_ID, 1, 1);

    expect(region).toEqual({
      sheetId: SHEET_ID,
      startRow: 0,
      startCol: 0,
      endRow: 1812,
      endCol: 9,
    });
    expect(queryRange).toHaveBeenCalledWith(SHEET_ID, 0, 0, 1812, 9);
  });

  it('stops at blank boundary rows inside larger sheet data bounds', async () => {
    const cells = [
      { row: 1, col: 1, value: 'a' },
      { row: 1, col: 2, value: 'b' },
      { row: 2, col: 1, value: 'c' },
      { row: 2, col: 2, value: 'd' },
      { row: 5, col: 1, value: 'e' },
      { row: 5, col: 2, value: 'f' },
    ];
    const { ctx } = makeContext(cells);

    await expect(getCurrentRegion(ctx, SHEET_ID, 1, 1)).resolves.toEqual({
      sheetId: SHEET_ID,
      startRow: 1,
      startCol: 1,
      endRow: 2,
      endCol: 2,
    });
  });
});
