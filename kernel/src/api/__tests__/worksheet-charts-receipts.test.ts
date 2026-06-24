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
        title: '=A1',
      }),
    );
    expect(axisReceipt.effects).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'changedRange' })]),
    );
    expect(updateChart).toHaveBeenCalledWith(
      SHEET_ID,
      'chart-1',
      expect.objectContaining({
        axis: expect.objectContaining({
          valueAxis: expect.objectContaining({ title: '=A1' }),
        }),
      }),
      expect.any(Object),
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

  it('returns app-model receipts for semantic chart element mutations', async () => {
    const { charts, updateChart } = createMutableChartsApi(
      makeChart({
        chartType: 'line',
        dataRange: 'A1:B4',
        title: 'Revenue',
        legend: { show: true, visible: true, position: 'bottom' },
        axis: {
          categoryAxis: { visible: true, title: 'Quarter' },
          secondaryValueAxis: { visible: true, title: 'Margin' },
        },
      }),
    );

    const appModel = await charts.getAppModel('chart-1');
    expect(appModel).toEqual(
      expect.objectContaining({
        title: expect.objectContaining({ text: 'Revenue', visible: true }),
        legend: expect.objectContaining({ visible: true, position: 'bottom' }),
        axes: expect.objectContaining({
          category: expect.objectContaining({
            applicable: true,
            visible: true,
            title: 'Quarter',
          }),
          secondaryValue: expect.objectContaining({
            applicable: true,
            visible: true,
            title: 'Margin',
          }),
        }),
        source: expect.objectContaining({ kind: 'range', supportsOrientationSwitch: true }),
      }),
    );

    const legendReceipt = await charts.setLegendVisible('chart-1', false);
    expect(legendReceipt).toEqual(
      expect.objectContaining({
        kind: 'chart.legend.setVisible',
        status: 'applied',
        visible: false,
        appModelBefore: expect.objectContaining({
          legend: expect.objectContaining({ visible: true }),
        }),
        appModelAfter: expect.objectContaining({
          legend: expect.objectContaining({ visible: false }),
        }),
      }),
    );
    expect(legendReceipt.effects[0]?.details).not.toHaveProperty('appModelBefore');
    expect(legendReceipt.effects[0]?.details).not.toHaveProperty('appModelAfter');

    const axisReceipt = await charts.setAxisTitle('chart-1', 'category', 'Month');
    expect(axisReceipt).toEqual(
      expect.objectContaining({
        kind: 'chart.axis.setTitle',
        status: 'applied',
        axisRole: 'category',
        axisType: 'category',
        title: 'Month',
      }),
    );
    expect(axisReceipt.effects).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'changedRange' })]),
    );
    expect(updateChart).toHaveBeenCalledWith(
      SHEET_ID,
      'chart-1',
      expect.objectContaining({
        axis: expect.objectContaining({
          categoryAxis: expect.objectContaining({ title: 'Month', titleVisible: true }),
        }),
      }),
      expect.any(Object),
    );

    const axisVisibleReceipt = await charts.setAxisVisible('chart-1', 'secondaryValue', false);
    expect(axisVisibleReceipt).toEqual(
      expect.objectContaining({
        kind: 'chart.axis.setVisible',
        status: 'applied',
        axisRole: 'secondaryValue',
        axisType: 'value',
        visible: false,
      }),
    );
    expect(updateChart).toHaveBeenLastCalledWith(
      SHEET_ID,
      'chart-1',
      expect.objectContaining({
        axis: expect.objectContaining({
          secondaryValueAxis: expect.objectContaining({ visible: false }),
        }),
      }),
      expect.any(Object),
    );

    const hiddenTitleReceipt = await charts.setChartTitleVisible('chart-1', false);
    expect(hiddenTitleReceipt).toEqual(
      expect.objectContaining({
        kind: 'chart.title.setVisible',
        status: 'applied',
        visible: false,
        appModelAfter: expect.objectContaining({
          title: expect.objectContaining({ visible: false }),
        }),
      }),
    );

    const pieCase = createMutableChartsApi(
      makeChart({
        chartType: 'pie',
        dataRange: 'A1:B4',
      }),
    );
    const pieAppModel = await pieCase.charts.getAppModel('chart-1');
    expect(pieAppModel?.axes.category).toEqual(
      expect.objectContaining({
        applicable: false,
        visible: false,
        source: 'absent',
      }),
    );
    expect(pieAppModel?.axes.value).toEqual(
      expect.objectContaining({
        applicable: false,
        visible: false,
        source: 'absent',
      }),
    );
  });

  it('switches range source orientation and reports unsupported explicit-series sources', async () => {
    const rangeCase = createMutableChartsApi(
      makeChart({
        chartType: 'column',
        dataRange: 'A1:B4',
        seriesOrientation: 'columns',
      }),
    );

    const switched = await rangeCase.charts.switchSeriesOrientation('chart-1');
    expect(switched).toEqual(
      expect.objectContaining({
        kind: 'chart.source.switchSeriesOrientation',
        status: 'applied',
        sourceBindingChange: expect.objectContaining({
          renderedGroupingChanged: true,
          explicitSeriesAction: 'notApplicable',
        }),
      }),
    );
    expect(rangeCase.updateChart).toHaveBeenCalledWith(
      SHEET_ID,
      'chart-1',
      expect.objectContaining({ seriesOrientation: 'rows' }),
      expect.any(Object),
    );

    const explicitCase = createMutableChartsApi(
      makeChart({
        chartType: 'column',
        dataRange: 'A1:B4',
        seriesOrientation: 'columns',
        series: [{ name: 'Revenue', values: 'B1:B4' }],
      }),
    );

    const switchedExplicitRange = await explicitCase.charts.switchSeriesOrientation('chart-1');
    expect(switchedExplicitRange).toEqual(
      expect.objectContaining({
        kind: 'chart.source.switchSeriesOrientation',
        status: 'applied',
        sourceBindingChange: expect.objectContaining({
          renderedGroupingChanged: true,
          explicitSeriesAction: 'cleared',
        }),
      }),
    );
    expect(explicitCase.updateChart).toHaveBeenCalledWith(
      SHEET_ID,
      'chart-1',
      expect.objectContaining({ seriesOrientation: 'rows', series: [] }),
      expect.any(Object),
    );

    const standaloneExplicitCase = createMutableChartsApi(
      makeChart({
        chartType: 'column',
        seriesOrientation: 'columns',
        series: [{ name: 'Revenue', values: 'B1:B4' }],
      }),
    );

    const unsupported = await standaloneExplicitCase.charts.switchSeriesOrientation('chart-1');
    expect(unsupported).toEqual(
      expect.objectContaining({
        kind: 'chart.source.switchSeriesOrientation',
        status: 'unsupported',
        sourceBindingChange: expect.objectContaining({
          renderedGroupingChanged: false,
          explicitSeriesAction: 'preserved',
        }),
      }),
    );
    expect(standaloneExplicitCase.updateChart).not.toHaveBeenCalled();

    const invalidRangeCase = createMutableChartsApi(
      makeChart({
        chartType: 'column',
        dataRange: 'not a range',
      }),
    );
    const invalidRange = await invalidRangeCase.charts.switchSeriesOrientation('chart-1');
    expect(invalidRange).toEqual(
      expect.objectContaining({
        kind: 'chart.source.switchSeriesOrientation',
        status: 'unsupported',
        sourceBindingBefore: expect.objectContaining({
          kind: 'unsupported',
          diagnostics: ['chart-data-range-is-not-parseable'],
        }),
      }),
    );
    expect(invalidRangeCase.updateChart).not.toHaveBeenCalled();

    const metadataCase = createMutableChartsApi(
      makeChart({
        chartType: 'column',
        dataRange: 'A1:B4',
        seriesOrientation: 'columns',
        series: [{ name: 'Metadata only' }],
      }),
    );
    const metadataSwitch = await metadataCase.charts.switchSeriesOrientation('chart-1');
    expect(metadataSwitch).toEqual(
      expect.objectContaining({
        status: 'applied',
        sourceBindingChange: expect.objectContaining({
          renderedGroupingChanged: true,
          explicitSeriesAction: 'preserved',
        }),
      }),
    );
    expect(metadataCase.updateChart).toHaveBeenCalledWith(
      SHEET_ID,
      'chart-1',
      expect.objectContaining({ seriesOrientation: 'rows' }),
      expect.any(Object),
    );
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
