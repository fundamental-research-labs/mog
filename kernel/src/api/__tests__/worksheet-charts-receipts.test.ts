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

function createMutableChartsApi(initialChart: ChartFloatingObject) {
  let chart = initialChart;
  const updateChart = jest.fn(
    async (_sheetId: string, _chartId: string, updates: Partial<ChartFloatingObject>) => {
      chart = {
        ...chart,
        ...updates,
        anchor: updates.anchor ? { ...chart.anchor, ...updates.anchor } : chart.anchor,
      };
    },
  );
  const charts = new WorksheetChartsImpl(
    {
      awaitMaterialized: jest.fn(async () => undefined),
      computeBridge: {
        getChart: jest.fn(async (_sheetId: string, chartId: string) =>
          chartId === chart.id ? chart : null,
        ),
        updateChart,
      },
    } as any,
    SHEET_ID,
  );
  return { charts, updateChart };
}

describe('WorksheetChartsImpl mutation receipts', () => {
  it('returns operation receipts for series mutations and invalid targets', async () => {
    const { charts, updateChart } = createMutableChartsApi(
      makeChart({
        chartType: 'line',
        series: [{ name: 'Actuals', values: 'B1:B3', categories: 'A1:A3' }],
      }),
    );

    const addReceipt = await charts.addSeries('chart-1', {
      name: 'Budget',
      values: 'C1:C3',
      categories: 'A1:A3',
    });
    expect(addReceipt).toEqual(
      expect.objectContaining({
        kind: 'chart.series.add',
        status: 'applied',
        chartId: 'chart-1',
        seriesIndex: 1,
        chart: expect.objectContaining({ id: 'chart-1' }),
      }),
    );
    expect(addReceipt.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'updatedObject', objectId: 'chart-1' }),
        expect.objectContaining({ type: 'changedRange', range: 'C1:C3' }),
        expect.objectContaining({ type: 'changedSelectionTarget', objectId: 'chart-1' }),
        expect.objectContaining({ type: 'invalidatedCache', objectId: 'chart-1' }),
      ]),
    );

    const valuesReceipt = await charts.setSeriesValues('chart-1', 0, 'D1:D3');
    expect(valuesReceipt).toEqual(
      expect.objectContaining({
        kind: 'chart.series.setValues',
        status: 'applied',
        chartId: 'chart-1',
        seriesIndex: 0,
      }),
    );
    expect(valuesReceipt.effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'changedRange', range: 'D1:D3' })]),
    );

    const reorderReceipt = await charts.reorderSeries('chart-1', 1, 0);
    expect(reorderReceipt).toEqual(
      expect.objectContaining({
        kind: 'chart.series.reorder',
        status: 'applied',
        chartId: 'chart-1',
        fromSeriesIndex: 1,
        toSeriesIndex: 0,
      }),
    );

    const removeReceipt = await charts.removeSeries('chart-1', 1);
    expect(removeReceipt).toEqual(
      expect.objectContaining({
        kind: 'chart.series.remove',
        status: 'applied',
        chartId: 'chart-1',
        seriesIndex: 1,
      }),
    );

    const failedReceipt = await charts.removeSeries('chart-1', 99);
    expect(failedReceipt).toEqual(
      expect.objectContaining({
        kind: 'chart.series.remove',
        status: 'failed',
        chartId: 'chart-1',
        seriesIndex: 99,
      }),
    );
    expect(failedReceipt.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'error',
          code: 'chart.mutation.invalidTarget',
        }),
      ]),
    );
    expect(updateChart).toHaveBeenCalledTimes(4);
  });

  it('returns operation receipts for trendline add/update/remove', async () => {
    const { charts, updateChart } = createMutableChartsApi(
      makeChart({
        chartType: 'scatter',
        series: [{ values: 'B1:B5', trendlines: [{ type: 'linear', show: true }] }],
      }),
    );

    const addReceipt = await charts.addTrendline('chart-1', 0, {
      type: 'exponential',
      show: true,
    });
    expect(addReceipt).toEqual(
      expect.objectContaining({
        kind: 'chart.trendline.add',
        status: 'applied',
        chartId: 'chart-1',
        seriesIndex: 0,
        trendlineIndex: 1,
      }),
    );

    const updateReceipt = await charts.updateTrendline('chart-1', 0, 1, {
      name: 'Forecast',
      displayEquation: true,
    });
    expect(updateReceipt).toEqual(
      expect.objectContaining({
        kind: 'chart.trendline.update',
        status: 'applied',
        chartId: 'chart-1',
        seriesIndex: 0,
        trendlineIndex: 1,
      }),
    );
    expect(updateReceipt.trendline).toEqual(
      expect.objectContaining({ name: 'Forecast', displayEquation: true }),
    );

    updateChart.mockClear();
    const failedReceipt = await charts.removeTrendline('chart-1', 0, 99);
    expect(failedReceipt).toEqual(
      expect.objectContaining({
        kind: 'chart.trendline.remove',
        status: 'failed',
        seriesIndex: 0,
        trendlineIndex: 99,
      }),
    );
    expect(updateChart).not.toHaveBeenCalled();
  });

  it('returns operation receipts for axis and data-label mutations', async () => {
    const { charts, updateChart } = createMutableChartsApi(
      makeChart({
        chartType: 'bar',
        dataRange: 'D1:E3',
        dataLabels: { show: true },
      }),
    );

    const axisReceipt = await charts.setAxisTitle('chart-1', 'value', '=A1');
    expect(axisReceipt).toEqual(
      expect.objectContaining({
        kind: 'chart.axis.setTitle',
        status: 'applied',
        axisType: 'value',
      }),
    );
    expect(axisReceipt.effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'changedRange', range: 'A1' })]),
    );

    const labelReceipt = await charts.setDataLabelHeight('chart-1', 0, 0, 18);
    expect(labelReceipt).toEqual(
      expect.objectContaining({
        kind: 'chart.dataLabel.setHeight',
        status: 'applied',
        seriesIndex: 0,
        pointIndex: 0,
      }),
    );

    updateChart.mockClear();
    const failedReceipt = await charts.setDataLabelWidth('chart-1', 0, -1, 48);
    expect(failedReceipt).toEqual(
      expect.objectContaining({
        kind: 'chart.dataLabel.setWidth',
        status: 'failed',
        seriesIndex: 0,
        pointIndex: -1,
      }),
    );
    expect(updateChart).not.toHaveBeenCalled();
  });

  it('returns failed receipts for inferred dataRange series hidden by explicit series', async () => {
    const { charts, updateChart } = createMutableChartsApi(
      makeChart({
        chartType: 'bar',
        dataRange: 'A1:C5',
        series: [{ name: 'Revenue', values: 'B2:B5', categories: 'A2:A5' }],
      }),
    );

    const receipt = await charts.setSeriesBinOptions('chart-1', 1, { binCount: 4 });
    expect(receipt).toEqual(
      expect.objectContaining({
        kind: 'chart.series.setBinOptions',
        status: 'failed',
        chartId: 'chart-1',
        seriesIndex: 1,
      }),
    );
    expect(receipt.diagnostics[0]?.message).toBe('Series index 1 out of range (0-0)');
    expect(updateChart).not.toHaveBeenCalled();
  });
});
