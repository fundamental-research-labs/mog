import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';
import { setPivotLayoutByName, setPivotStyleByName } from '../layout-style';

const SHEET_ID = sheetId('sheet-1');

function makeDraftPivot() {
  return {
    id: 'pivot-1',
    name: 'SalesPivot',
    sourceSheetName: 'Sheet1',
    sourceRange: { startRow: 0, startCol: 0, endRow: 1, endCol: 1 },
    outputSheetName: 'Sheet1',
    outputLocation: { row: 0, col: 4 },
    fields: [],
    placements: [],
    filters: [],
  };
}

function makeContext(pivotConfig = makeDraftPivot()) {
  return {
    pivot: {
      getAllPivots: jest.fn().mockResolvedValue([pivotConfig]),
      getPivot: jest.fn().mockResolvedValue(pivotConfig),
      updatePivot: jest.fn(async (_sheetId, _pivotId, updates) => ({
        ...pivotConfig,
        ...updates,
      })),
    },
  } as any;
}

describe('pivot layout/style metadata updates', () => {
  it('stores layout on draft pivots without forcing materialization', async () => {
    const ctx = makeContext();

    const receipt = await setPivotLayoutByName({
      ctx,
      sheetId: SHEET_ID,
      pivotName: 'SalesPivot',
      layout: { layoutForm: 'tabular' },
    });

    expect(ctx.pivot.updatePivot).toHaveBeenCalledWith(
      SHEET_ID,
      'pivot-1',
      { layout: { layoutForm: 'tabular' } },
      { reason: 'layoutChanged', refreshPolicy: 'dirtyOnly' },
    );
    expect(receipt).toEqual(
      expect.objectContaining({
        updateReason: 'layoutChanged',
        refreshPolicy: 'dirtyOnly',
      }),
    );
  });

  it('stores style on draft pivots without forcing materialization', async () => {
    const ctx = makeContext();

    await setPivotStyleByName({
      ctx,
      sheetId: SHEET_ID,
      pivotName: 'SalesPivot',
      style: { styleName: 'PivotStyleMedium2' },
    });

    expect(ctx.pivot.updatePivot).toHaveBeenCalledWith(
      SHEET_ID,
      'pivot-1',
      { style: { styleName: 'PivotStyleMedium2' } },
      { reason: 'styleChanged', refreshPolicy: 'dirtyOnly' },
    );
  });
});
