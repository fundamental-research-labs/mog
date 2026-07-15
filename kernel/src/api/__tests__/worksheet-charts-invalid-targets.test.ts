import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';
import type { ChartFloatingObject } from '../../bridges/compute/compute-bridge';
import { KernelError } from '../../errors';
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
    width: 360,
    height: 220,
    zIndex: 0,
    rotation: 0,
    flipH: false,
    flipV: false,
    locked: false,
    visible: true,
    printable: true,
    opacity: 1,
    name: 'Revenue chart',
    dataRange: 'A1:C5',
    series: [{ name: 'Revenue', values: 'B2:B5', categories: 'A2:A5' }],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function createApi(charts: ChartFloatingObject[] = []) {
  const writes = {
    updateChart: jest.fn(async () => undefined),
    deleteChart: jest.fn(async () => undefined),
    bringChartToFront: jest.fn(async () => undefined),
    sendChartToBack: jest.fn(async () => undefined),
    bringChartForward: jest.fn(async () => undefined),
    sendChartBackward: jest.fn(async () => undefined),
    linkChartToTable: jest.fn(async () => undefined),
    unlinkChartFromTable: jest.fn(async () => undefined),
  };
  const ctx = {
    awaitMaterialized: jest.fn(async () => undefined),
    eventBus: { emit: jest.fn() },
    computeBridge: {
      createChart: jest.fn(async () => undefined),
      getChart: jest.fn(
        async (_sheetId: string, chartId: string) =>
          charts.find((chart) => chart.id === chartId) ?? null,
      ),
      getAllCharts: jest.fn(async () => charts),
      isChartLinkedToTable: jest.fn(async () => false),
      ...writes,
    },
  };
  return { charts: new WorksheetChartsImpl(ctx as any, SHEET_ID), ctx, writes };
}

type MutationCase = readonly [
  label: string,
  action: (charts: WorksheetChartsImpl) => Promise<unknown>,
];

const missingTargetCases: readonly MutationCase[] = [
  ['update', (charts) => charts.update('missing-chart', { width: 420 })],
  ['updateRaw', (charts) => charts.updateRaw('missing-chart', { width: 420 })],
  ['remove', (charts) => charts.remove('missing-chart')],
  ['duplicate', (charts) => charts.duplicate('missing-chart')],
  ['activate', (charts) => charts.activate('missing-chart')],
  ['setDataRange', (charts) => charts.setDataRange('missing-chart', 'A1:C5')],
  ['setType', (charts) => charts.setType('missing-chart', 'line')],
  ['setTitleFormula', (charts) => charts.setTitleFormula('missing-chart', '=A1')],
  [
    'setSourceData',
    (charts) =>
      charts.setSourceData('missing-chart', {
        dataRange: 'A1:C5',
        categoryRange: 'A2:A5',
        seriesRange: 'B1:C1',
      }),
  ],
  [
    'addSeries',
    (charts) =>
      charts.addSeries('missing-chart', {
        name: 'Revenue',
        values: 'B2:B5',
        categories: 'A2:A5',
      }),
  ],
  ['updateSeries', (charts) => charts.updateSeries('missing-chart', 0, { name: 'Revenue' })],
  ['removeSeries', (charts) => charts.removeSeries('missing-chart', 0)],
  ['reorderSeries', (charts) => charts.reorderSeries('missing-chart', 0, 1)],
  ['setSeriesValues', (charts) => charts.setSeriesValues('missing-chart', 0, 'B2:B5')],
  ['setSeriesCategories', (charts) => charts.setSeriesCategories('missing-chart', 0, 'A2:A5')],
  ['setBubbleSizes', (charts) => charts.setBubbleSizes('missing-chart', 0, 'C2:C5')],
  ['formatPoint', (charts) => charts.formatPoint('missing-chart', 0, 0, { fill: '#FF0000' })],
  [
    'setPointDataLabel',
    (charts) => charts.setPointDataLabel('missing-chart', 0, 0, { show: true }),
  ],
  ['addTrendline', (charts) => charts.addTrendline('missing-chart', 0, { type: 'linear' })],
  [
    'updateTrendline',
    (charts) => charts.updateTrendline('missing-chart', 0, 0, { displayEquation: true }),
  ],
  ['removeTrendline', (charts) => charts.removeTrendline('missing-chart', 0, 0)],
  ['setAxisTitle', (charts) => charts.setAxisTitle('missing-chart', 'value', 'Revenue')],
  ['setAxisVisible', (charts) => charts.setAxisVisible('missing-chart', 'value', true)],
  ['setLegendVisible', (charts) => charts.setLegendVisible('missing-chart', false)],
  ['setChartTitleVisible', (charts) => charts.setChartTitleVisible('missing-chart', true)],
  ['switchSeriesOrientation', (charts) => charts.switchSeriesOrientation('missing-chart')],
  ['setCategoryNames', (charts) => charts.setCategoryNames('missing-chart', 'A2:A5')],
  ['setDataLabelHeight', (charts) => charts.setDataLabelHeight('missing-chart', 0, 0, 20)],
  ['setDataLabelWidth', (charts) => charts.setDataLabelWidth('missing-chart', 0, 0, 48)],
  [
    'setSeriesBinOptions',
    (charts) => charts.setSeriesBinOptions('missing-chart', 0, { binCount: 4 }),
  ],
  [
    'setSeriesBoxwhiskerOptions',
    (charts) =>
      charts.setSeriesBoxwhiskerOptions('missing-chart', 0, {
        showMeanMarkers: true,
        quartileMethod: 'exclusive',
      }),
  ],
  ['bringToFront', (charts) => charts.bringToFront('missing-chart')],
  ['sendToBack', (charts) => charts.sendToBack('missing-chart')],
  ['bringForward', (charts) => charts.bringForward('missing-chart')],
  ['sendBackward', (charts) => charts.sendBackward('missing-chart')],
  ['linkToTable', (charts) => charts.linkToTable('missing-chart', 'table-1')],
  ['unlinkFromTable', (charts) => charts.unlinkFromTable('missing-chart')],
];

describe('WorksheetChartsImpl invalid root target contract', () => {
  it.each(missingTargetCases)(
    '%s rejects a missing chart ID with structured feedback',
    async (_label, action) => {
      const { charts, writes } = createApi();

      await expect(action(charts)).rejects.toMatchObject({
        code: 'OBJ_CHART_NOT_FOUND',
        message: 'Chart target "missing-chart" not found',
        path: ['chartTarget'],
        suggestion:
          'Use ws.charts.list() to inspect available chart IDs and names, or api.describe("ws.charts") for chart API discovery',
        context: {
          resourceType: 'chart',
          resourceId: 'missing-chart',
          received: 'missing-chart',
          reason: 'not-found',
        },
      });
      for (const write of Object.values(writes)) expect(write).not.toHaveBeenCalled();
    },
  );

  it.each(missingTargetCases)(
    '%s accepts a unique exact display name and sends only the stable ID to native writes',
    async (_label, action) => {
      const chart = makeChart({ name: 'missing-chart' });
      const { charts, writes } = createApi([chart]);

      await action(charts);
      for (const write of Object.values(writes)) {
        for (const call of write.mock.calls) expect(call[1]).toBe(chart.id);
      }
    },
  );

  it.each([
    [
      'receipt mutation',
      (charts: WorksheetChartsImpl) => charts.setLegendVisible('Revenue chart', false),
    ],
    [
      'root update',
      (charts: WorksheetChartsImpl) => charts.update('Revenue chart', { width: 420 }),
    ],
    ['void bridge mutation', (charts: WorksheetChartsImpl) => charts.bringToFront('Revenue chart')],
  ])('%s accepts a unique display name', async (_label, action) => {
    const chart = makeChart();
    const { charts, writes } = createApi([chart]);

    await action(charts);
    for (const write of Object.values(writes)) {
      for (const call of write.mock.calls) expect(call[1]).toBe(chart.id);
    }
  });

  it('rejects duplicate names with deterministic candidates and an explicit-ID recovery', async () => {
    const first = makeChart({ id: 'chart-1', name: 'Revenue' });
    const second = makeChart({ id: 'chart-2', name: 'Revenue' });
    const { charts, writes } = createApi([second, first]);

    await expect(charts.setLegendVisible('Revenue', false)).rejects.toMatchObject({
      code: 'OBJ_CHART_TARGET_AMBIGUOUS',
      path: ['chartTarget'],
      message: 'Chart target "Revenue" is ambiguous; matched 2 charts',
      context: {
        resourceType: 'chart',
        received: 'Revenue',
        reason: 'ambiguous-target',
        candidates: [
          { id: 'chart-1', name: 'Revenue', matchedBy: ['name'] },
          { id: 'chart-2', name: 'Revenue', matchedBy: ['name'] },
        ],
      },
    });
    await expect(charts.getByName('Revenue')).rejects.toMatchObject({
      code: 'OBJ_CHART_TARGET_AMBIGUOUS',
      context: { received: 'Revenue' },
    });
    await expect(charts.getPlotAreaLayout('Revenue')).rejects.toMatchObject({
      code: 'OBJ_CHART_TARGET_AMBIGUOUS',
      context: { received: 'Revenue' },
    });
    for (const write of Object.values(writes)) expect(write).not.toHaveBeenCalled();

    await charts.setLegendVisible({ id: 'chart-2' }, false);
    expect(writes.updateChart).toHaveBeenCalledWith(
      SHEET_ID,
      'chart-2',
      expect.anything(),
      expect.anything(),
    );
  });

  it('detects ID/name collisions while explicit selectors select one namespace', async () => {
    const byId = makeChart({ id: 'chart-1', name: 'Primary' });
    const byName = makeChart({ id: 'chart-2', name: 'chart-1' });
    const { charts } = createApi([byName, byId]);

    await expect(charts.get('chart-1')).rejects.toMatchObject({
      code: 'OBJ_CHART_TARGET_AMBIGUOUS',
      context: {
        candidates: [
          { id: 'chart-1', name: 'Primary', matchedBy: ['id'] },
          { id: 'chart-2', name: 'chart-1', matchedBy: ['name'] },
        ],
      },
      suggestion: expect.stringContaining('{ id: "chart-1" }'),
    });
    await expect(charts.get({ id: 'chart-1' })).resolves.toMatchObject({ id: 'chart-1' });
    await expect(charts.get({ name: 'chart-1' })).resolves.toMatchObject({ id: 'chart-2' });
  });

  it('deduplicates a chart that matches the same bare string by both ID and name', async () => {
    const chart = makeChart({ id: 'chart-1', name: 'chart-1' });
    const { charts } = createApi([chart]);

    await expect(charts.get('chart-1')).resolves.toMatchObject({ id: 'chart-1' });
  });

  it('detects an imported-ID-alias/name collision and lets an ID selector escape it', async () => {
    const imported = makeChart({ id: 'chart-import-0-sheet-1', name: 'Imported' });
    const named = makeChart({ id: 'chart-z', name: 'chart-import-0' });
    const { charts } = createApi([named, imported]);

    await expect(charts.get('chart-import-0')).rejects.toMatchObject({
      code: 'OBJ_CHART_TARGET_AMBIGUOUS',
      context: {
        candidates: [
          { id: 'chart-import-0-sheet-1', matchedBy: ['id'] },
          { id: 'chart-z', matchedBy: ['name'] },
        ],
      },
    });
    await expect(charts.get({ id: 'chart-import-0' })).resolves.toMatchObject({
      id: 'chart-import-0-sheet-1',
    });
  });

  it.each([{}, { id: 'chart-1', name: 'Revenue' }, { id: 1 }, { name: 1 }, []])(
    'rejects malformed runtime target %p with actionable invalid-argument feedback',
    async (target) => {
      const { charts, writes } = createApi([makeChart()]);

      await expect(charts.update(target as never, { width: 420 })).rejects.toMatchObject({
        code: 'API_INVALID_ARGUMENT',
        path: ['chartTarget'],
        context: {
          paramName: 'chartTarget',
          expected: 'string | { id: string } | { name: string }',
        },
      });
      for (const write of Object.values(writes)) expect(write).not.toHaveBeenCalled();
    },
  );

  it('keeps tolerant chart reads tolerant for a missing ID', async () => {
    const { charts } = createApi();

    await expect(charts.get('missing-chart')).resolves.toBeNull();
    await expect(charts.get({ id: 'missing-chart' })).resolves.toBeNull();
    await expect(charts.get({ name: 'missing-chart' })).resolves.toBeNull();
    await expect(charts.has('missing-chart')).resolves.toBe(false);
    await expect(charts.isLinkedToTable('missing-chart')).resolves.toBe(false);
  });

  it('rejects a stale ID after deletion without admitting another write', async () => {
    let chart: ChartFloatingObject | null = makeChart();
    const updateChart = jest.fn(async () => undefined);
    const deleteChart = jest.fn(async () => {
      chart = null;
    });
    const ctx = {
      awaitMaterialized: jest.fn(async () => undefined),
      computeBridge: {
        getChart: jest.fn(async (_sheetId: string, chartId: string) =>
          chart?.id === chartId ? chart : null,
        ),
        getAllCharts: jest.fn(async () => (chart ? [chart] : [])),
        updateChart,
        deleteChart,
      },
    };
    const charts = new WorksheetChartsImpl(ctx as any, SHEET_ID);

    await expect(charts.remove('chart-1')).resolves.toMatchObject({ status: 'applied' });
    await expect(charts.setLegendVisible('chart-1', false)).rejects.toMatchObject({
      code: 'OBJ_CHART_NOT_FOUND',
      path: ['chartTarget'],
      context: { resourceType: 'chart', resourceId: 'chart-1' },
    });
    expect(deleteChart).toHaveBeenCalledTimes(1);
    expect(updateChart).not.toHaveBeenCalled();
  });

  it('prioritizes missing root feedback over an invalid child index', async () => {
    const { charts } = createApi();

    await expect(
      charts.updateSeries('missing-chart', -1, { name: 'Invalid child' }),
    ).rejects.toMatchObject({
      code: 'OBJ_CHART_NOT_FOUND',
      path: ['chartTarget'],
      context: { resourceType: 'chart', resourceId: 'missing-chart' },
    });
    await expect(charts.getTrendline('missing-chart', -1, 0)).rejects.toMatchObject({
      code: 'OBJ_CHART_NOT_FOUND',
      path: ['chartTarget'],
    });
  });

  it('translates a native ChartNotFound race after successful preflight', async () => {
    const chart = makeChart();
    const { charts, ctx } = createApi([chart]);
    const nativeError = new Error(
      `[BRIDGE_ERROR]${JSON.stringify({
        kind: 'ChartNotFound',
        sheetId: String(SHEET_ID),
        chartId: chart.id,
      })}`,
    );
    ctx.computeBridge.updateChart.mockRejectedValueOnce(nativeError as never);

    let thrown: unknown;
    try {
      await charts.setLegendVisible(chart.id, false);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      code: 'OBJ_CHART_NOT_FOUND',
      path: ['chartTarget'],
      context: { resourceType: 'chart', resourceId: chart.id },
    });
    expect((thrown as KernelError).cause).toBe(nativeError);
  });

  it('keeps failed receipts for child targets after the root chart is admitted', async () => {
    const { charts, writes } = createApi([makeChart()]);

    await expect(charts.removeSeries('chart-1', 99)).resolves.toMatchObject({
      kind: 'chart.series.remove',
      status: 'failed',
      chartId: 'chart-1',
      seriesIndex: 99,
    });
    for (const write of Object.values(writes)) expect(write).not.toHaveBeenCalled();
  });
});
