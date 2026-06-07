import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';
import { deletePivotsContainedByClearRange } from '../worksheet/pivot-clear';

const SHEET_ID = sheetId('sheet-1');

function createPivotCtx() {
  const pivotConfig = {
    id: 'pivot-1',
    name: 'SalesPivot',
    sourceSheetName: 'Sheet1',
    sourceRange: { startRow: 0, startCol: 0, endRow: 3, endCol: 1 },
    outputSheetName: 'Sheet1',
    outputLocation: { row: 0, col: 4 },
    fields: [],
    placements: [],
    filters: [],
  };
  const ctx = {
    pivot: {
      getAllPivots: jest.fn().mockResolvedValue([pivotConfig] as never),
      getPivot: jest.fn().mockResolvedValue(pivotConfig as never),
      compute: jest.fn().mockResolvedValue({
        renderedBounds: {
          totalRows: 4,
          totalCols: 2,
          firstDataRow: 1,
          firstDataCol: 1,
          numDataCols: 1,
        },
        rows: [],
      } as never),
      deletePivot: jest.fn().mockResolvedValue(true as never),
    },
  } as any;
  return { ctx };
}

describe('deletePivotsContainedByClearRange', () => {
  test('deletes pivots whose rendered range is contained by a contents clear', async () => {
    const { ctx } = createPivotCtx();

    await deletePivotsContainedByClearRange(
      ctx,
      SHEET_ID,
      { startRow: 0, startCol: 4, endRow: 3, endCol: 5 },
      'contents',
    );

    expect(ctx.pivot.deletePivot).toHaveBeenCalledWith(SHEET_ID, 'pivot-1');
  });

  test('does not delete pivots for partial range overlap', async () => {
    const { ctx } = createPivotCtx();

    await deletePivotsContainedByClearRange(
      ctx,
      SHEET_ID,
      { startRow: 0, startCol: 4, endRow: 1, endCol: 5 },
      'contents',
    );

    expect(ctx.pivot.deletePivot).not.toHaveBeenCalled();
  });

  test('does not delete pivots for format-only clears', async () => {
    const { ctx } = createPivotCtx();

    await deletePivotsContainedByClearRange(
      ctx,
      SHEET_ID,
      { startRow: 0, startCol: 4, endRow: 3, endCol: 5 },
      'formats',
    );

    expect(ctx.pivot.getAllPivots).not.toHaveBeenCalled();
    expect(ctx.pivot.deletePivot).not.toHaveBeenCalled();
  });
});
