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
    chartType: 'scatter',
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

describe('WorksheetChartsImpl compatibility paths', () => {
  it('exposes non-enumerable compatibility shims for learned chart paths', async () => {
    const chart = makeChart();
    const ctx = {
      awaitMaterialized: jest.fn(async () => undefined),
      computeBridge: {
        getAllCharts: jest.fn(async () => [chart]),
        getChart: jest.fn(async () => chart),
        updateChart: jest.fn(async () => undefined),
      },
    };
    const charts = new WorksheetChartsImpl(ctx as any, SHEET_ID);

    const listed = await charts.listCharts();
    const chartRecord = listed[0] as any;
    const axis = chartRecord.getAxisItem('valueAxis');
    await chartRecord.updateRaw({ legend: { visible: false } });

    expect(typeof chartRecord.getAxisItem).toBe('function');
    expect(typeof chartRecord.updateRaw).toBe('function');
    expect(Object.keys(chartRecord)).not.toEqual(
      expect.arrayContaining(['getAxisItem', 'updateRaw']),
    );
    expect(axis).toMatchObject({ chartId: chart.id, axisRole: 'value' });
    expect(ctx.computeBridge.updateChart).toHaveBeenCalledWith(
      SHEET_ID,
      chart.id,
      { legend: { visible: false } },
      expect.any(Object),
    );
  });
});
