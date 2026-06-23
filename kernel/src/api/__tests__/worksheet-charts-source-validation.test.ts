import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';

import { WorksheetChartsImpl } from '../worksheet/charts';

const SHEET_ID = sheetId('sheet-1');

describe('WorksheetChartsImpl source validation', () => {
  it('rejects unknown-sheet chart source ranges before creating chart objects', async () => {
    const ctx = {
      awaitMaterialized: jest.fn(async () => undefined),
      computeBridge: {
        createChart: jest.fn(),
        getChart: jest.fn(),
        getSheetOrder: jest.fn(async () => [SHEET_ID]),
        getSheetName: jest.fn(async () => 'Data'),
      },
    };
    const charts = new WorksheetChartsImpl(ctx as any, SHEET_ID);

    await expect(
      charts.add({
        type: 'bar',
        dataRange: "'Missing Sheet'!A1:B2",
        anchorRow: 1,
        anchorCol: 1,
        width: 8,
        height: 15,
      }),
    ).rejects.toMatchObject({
      code: 'OBJ_CHART_INVALID_CONFIG',
      context: {
        reason: expect.stringContaining('unknown sheet "Missing Sheet"'),
      },
    });

    expect(ctx.computeBridge.createChart).not.toHaveBeenCalled();
    expect(ctx.computeBridge.getChart).not.toHaveBeenCalled();
  });
});
