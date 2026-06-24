import { jest } from '@jest/globals';
import type { SheetId, CellRange } from '@mog-sdk/contracts/core';

import { getCurrentRegion, getDataBoundsForRange } from '../cell-iteration';
import type { DocumentContext } from '../../../context/types';

const SHEET_ID = 'sheet-1' as SheetId;

function makeContext() {
  const getCurrentRegionBridge = jest.fn(async () => ({
    startRow: 0,
    startCol: 0,
    endRow: 1812,
    endCol: 9,
  }));
  const getDataBoundsForRangeBridge = jest.fn(async () => ({
    startRow: 0,
    startCol: 0,
    endRow: 1812,
    endCol: 9,
  }));

  return {
    ctx: {
      computeBridge: {
        getCurrentRegion: getCurrentRegionBridge,
        getDataBoundsForRange: getDataBoundsForRangeBridge,
      },
    } as unknown as DocumentContext,
    getCurrentRegionBridge,
    getDataBoundsForRangeBridge,
  };
}

describe('getCurrentRegion', () => {
  it('delegates current-region detection to compute', async () => {
    const { ctx, getCurrentRegionBridge } = makeContext();

    await expect(getCurrentRegion(ctx, SHEET_ID, 1, 1)).resolves.toEqual({
      sheetId: SHEET_ID,
      startRow: 0,
      startCol: 0,
      endRow: 1812,
      endCol: 9,
    });

    expect(getCurrentRegionBridge).toHaveBeenCalledWith(SHEET_ID, 1, 1);
  });
});

describe('getDataBoundsForRange', () => {
  it('returns exact ranges without compute expansion', async () => {
    const { ctx, getDataBoundsForRangeBridge } = makeContext();
    const range: CellRange = {
      sheetId: SHEET_ID,
      startRow: 2,
      startCol: 3,
      endRow: 4,
      endCol: 5,
    };

    await expect(getDataBoundsForRange(ctx, SHEET_ID, range)).resolves.toBe(range);
    expect(getDataBoundsForRangeBridge).not.toHaveBeenCalled();
  });

  it('delegates full-column range bounds to compute', async () => {
    const { ctx, getDataBoundsForRangeBridge } = makeContext();
    const range: CellRange = {
      sheetId: SHEET_ID,
      startRow: 0,
      startCol: 0,
      endRow: 1_048_575,
      endCol: 1,
      isFullColumn: true,
    };

    await expect(getDataBoundsForRange(ctx, SHEET_ID, range)).resolves.toEqual({
      sheetId: SHEET_ID,
      startRow: 0,
      startCol: 0,
      endRow: 1812,
      endCol: 9,
    });

    expect(getDataBoundsForRangeBridge).toHaveBeenCalledWith(
      SHEET_ID,
      0,
      0,
      1_048_575,
      1,
      true,
      false,
    );
  });
});
