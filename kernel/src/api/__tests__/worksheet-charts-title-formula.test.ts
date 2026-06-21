import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';
import type { ChartFloatingObject } from '../../bridges/compute/compute-bridge';
import { WorksheetChartsImpl } from '../worksheet/charts';

const SHEET_ID = sheetId('sheet-1');

function makeChart(overrides: Partial<ChartFloatingObject> = {}): ChartFloatingObject {
  return {
    id: 'chart-1',
    sheetId: SHEET_ID,
    type: 'chart',
    chartType: 'bar',
    anchor: {
      anchorRow: 0,
      anchorCol: 0,
      anchorRowOffsetEmu: 0,
      anchorColOffsetEmu: 0,
      anchorMode: 'twoCell',
    },
    width: 8,
    height: 15,
    zIndex: 0,
    rotation: 0,
    flipH: false,
    flipV: false,
    locked: false,
    visible: true,
    printable: true,
    opacity: 1,
    name: 'Chart 1',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('WorksheetChartsImpl chart title formulas', () => {
  it('stores title formulas separately from rendered title text', async () => {
    let chart = makeChart({ title: 'Old Title' });
    const updateChart = jest.fn(
      async (_sheetId: string, _chartId: string, updates: Partial<ChartFloatingObject>) => {
        chart = { ...chart, ...updates };
      },
    );
    const charts = new WorksheetChartsImpl(
      {
        computeBridge: {
          getChart: jest.fn(async () => chart),
          updateChart,
        },
      } as any,
      SHEET_ID,
    );

    await charts.setTitleFormula('chart-1', '=A1');

    expect(updateChart).toHaveBeenCalledWith(
      SHEET_ID,
      'chart-1',
      {
        title: null,
        titleFormula: '=A1',
      },
      expect.any(Object),
    );
    await expect(charts.get('chart-1')).resolves.toEqual(
      expect.objectContaining({ title: undefined, titleFormula: '=A1' }),
    );
    await expect(charts.getTitleSubstring('chart-1', 0, 5)).resolves.toEqual({ text: '' });
  });
});
