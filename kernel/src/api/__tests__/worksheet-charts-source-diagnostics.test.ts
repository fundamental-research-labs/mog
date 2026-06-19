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
    chartType: 'line',
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

function range(startRow: number, startCol: number, endRow: number, endCol: number) {
  return { sheetId: SHEET_ID, startRow, startCol, endRow, endCol };
}

function rangeRef(
  kind: string,
  ref: string,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
) {
  return { kind, source: 'a1', ref, range: range(startRow, startCol, endRow, endCol) };
}

function makeResolvedChartSpec(
  overrides: {
    chartId?: string;
    title?: string;
    ranges?: any;
    series?: any[];
    categories?: Array<string | number | null>;
    diagnostics?: any;
  } = {},
) {
  const chartId = overrides.chartId ?? 'chart-1';
  return {
    schemaVersion: 1,
    chartId,
    sheetId: SHEET_ID,
    chartObject: { id: chartId, name: `Name ${chartId}` },
    export: {
      kind: 'raster',
      format: 'png',
      width: 640,
      height: 480,
      pixelRatio: 2,
      physicalWidth: 1280,
      physicalHeight: 960,
      backgroundColor: '#ffffff',
      fittingMode: 'fill',
      frame: {
        exportWidth: 640,
        exportHeight: 480,
        contentX: 0,
        contentY: 0,
        contentWidth: 640,
        contentHeight: 480,
      },
    },
    implementation: {
      renderAuthority: 'chartBridge',
      renderStatus: 'renderable',
      compilerPathId: 'ts-grammar',
      compilerInputHash: 'hash',
      compilerVersion: 1,
    },
    resolved: {
      chartType: 'line',
      title: { present: Boolean(overrides.title), text: overrides.title },
      legend: { present: false, entries: [], visibleEntries: [] },
      axes: { category: { present: true, title: 'Month' }, value: { present: true } },
      series: overrides.series ?? [],
      seriesProjection: { sourceSeries: [], droppedSeries: [], projectedRoleMappings: [] },
      categories: overrides.categories ?? [],
      plot: {},
      ranges: overrides.ranges ?? {
        dataRange: null,
        categoryRange: null,
        seriesRange: null,
        seriesReferences: [],
        diagnostics: [],
      },
      dataHashes: { categoriesHash: 'categories', seriesHash: 'series' },
    },
    diagnostics: overrides.diagnostics ?? { compiler: [], unsupportedFeatures: [] },
  } as any;
}

describe('WorksheetChartsImpl source diagnostics', () => {
  it('describes resolved chart source ranges and cached points from the renderer snapshot', async () => {
    const resolvedChartSpec = makeResolvedChartSpec({
      title: 'Revenue',
      ranges: {
        dataRange: rangeRef('dataRange', 'A1:B3', 0, 0, 2, 1),
        categoryRange: rangeRef('categoryRange', 'A2:A3', 1, 0, 2, 0),
        seriesRange: null,
        seriesReferences: [
          {
            index: 0,
            name: rangeRef('seriesName', 'B1', 0, 1, 0, 1),
            values: rangeRef('seriesValues', 'B2:B3', 1, 1, 2, 1),
            categories: rangeRef('seriesCategories', 'A2:A3', 1, 0, 2, 0),
          },
        ],
        diagnostics: [
          {
            kind: 'seriesValues',
            code: 'MALFORMED_A1',
            ref: 'bad ref',
            message: 'Chart seriesValues is not a valid Excel A1 range',
          },
        ],
      },
      series: [
        {
          index: 0,
          order: 0,
          sourceSeriesIndex: 0,
          sourceSeriesKey: 'series-0',
          name: 'Revenue',
          axisGroup: 'primary',
          source: { values: 'B2:B3', categories: 'A2:A3' },
          renderAuthority: { values: 'range', categories: 'range', bubbleSize: 'none' },
          xValues: ['Jan', 'Feb'],
          categories: ['Jan', 'Feb'],
          values: [10, null],
          renderedValues: [10, null],
          bubbleSizes: [],
          blankMask: [false, true],
          pointCount: 2,
          renderedPointCount: 2,
          dataHash: 'series',
        },
      ],
      categories: ['Jan', 'Feb'],
    });
    const ctx = {
      charts: {
        getRenderSnapshotAtSize: jest.fn(async () => ({ marks: [], resolvedChartSpec })),
      },
      computeBridge: {
        getChart: jest.fn(async () => makeChart()),
      },
    };
    const charts = new WorksheetChartsImpl(ctx as any, SHEET_ID);

    const description = await charts.describe('chart-1');

    expect(description.title).toBe('Revenue');
    expect(description.sourceData.dataRange?.ref).toBe('A1:B3');
    expect(description.series[0]?.ranges?.values?.ref).toBe('B2:B3');
    expect(description.series[0]?.cachedPoints).toEqual([
      {
        index: 0,
        category: 'Jan',
        xValue: 'Jan',
        value: 10,
        renderedValue: 10,
        blank: false,
      },
      {
        index: 1,
        category: 'Feb',
        xValue: 'Feb',
        value: null,
        renderedValue: null,
        blank: true,
      },
    ]);
    expect(description.warnings).toContain('Chart seriesValues is not a valid Excel A1 range');
  });

  it('sets source ranges and clears identity-backed chart range bindings', async () => {
    const chart = makeChart({
      dataRange: 'A1:B4',
      dataRangeIdentity: { topLeftCellId: 'old-top', bottomRightCellId: 'old-bottom' },
      categoryRangeIdentity: { topLeftCellId: 'cat-top', bottomRightCellId: 'cat-bottom' },
      series: [{ values: 'B2:B4', categories: 'A2:A4' }] as any,
    });
    const ctx = {
      computeBridge: {
        getChart: jest.fn(async () => chart),
        updateChart: jest.fn(async () => undefined),
      },
    };
    const charts = new WorksheetChartsImpl(ctx as any, SHEET_ID);

    await charts.setSourceData('chart-1', {
      dataRange: 'D1:E4',
      categoryRange: null,
      series: [
        { index: 0, values: 'E2:E4', categories: null },
        { index: 1, name: 'Forecast', values: 'F2:F4' },
      ],
    });

    const updates = (ctx.computeBridge.updateChart as jest.Mock).mock.calls[0]?.[2] as any;
    expect(updates.dataRange).toBe('D1:E4');
    expect(updates.dataRangeIdentity).toBeNull();
    expect(updates.categoryRange).toBe('');
    expect(updates.categoryRangeIdentity).toBeNull();
    expect(updates.series[0].values).toBe('E2:E4');
    expect(updates.series[0]).not.toHaveProperty('categories');
    expect(updates.series[1]).toEqual(
      expect.objectContaining({ name: 'Forecast', values: 'F2:F4' }),
    );
  });

  it('finds charts whose resolved source ranges overlap a worksheet range', async () => {
    const chartOneSpec = makeResolvedChartSpec({
      chartId: 'chart-1',
      title: 'Revenue',
      ranges: {
        dataRange: rangeRef('dataRange', 'B2:C4', 1, 1, 3, 2),
        categoryRange: null,
        seriesRange: null,
        seriesReferences: [],
        diagnostics: [],
      },
    });
    const chartTwoSpec = makeResolvedChartSpec({
      chartId: 'chart-2',
      title: 'Costs',
      ranges: {
        dataRange: rangeRef('dataRange', 'H1:I3', 0, 7, 2, 8),
        categoryRange: null,
        seriesRange: null,
        seriesReferences: [],
        diagnostics: [],
      },
    });
    const specs = new Map([
      ['chart-1', chartOneSpec],
      ['chart-2', chartTwoSpec],
    ]);
    const ctx = {
      charts: {
        getRenderSnapshotAtSize: jest.fn(async (_sheetId, chartId) => ({
          marks: [],
          resolvedChartSpec: specs.get(chartId),
        })),
      },
      computeBridge: {
        getChart: jest.fn(async (_sheetId, chartId) =>
          chartId === 'chart-1' || chartId === 'chart-2' ? makeChart({ id: chartId }) : null,
        ),
        getAllCharts: jest.fn(async () => [
          makeChart({ id: 'chart-1' }),
          makeChart({ id: 'chart-2' }),
        ]),
        getSheetName: jest.fn(async () => 'Sheet1'),
        getSheetOrder: jest.fn(async () => [SHEET_ID]),
      },
    };
    const charts = new WorksheetChartsImpl(ctx as any, SHEET_ID);

    await expect(charts.findBySourceRange('B3:B3')).resolves.toEqual([
      expect.objectContaining({ chartId: 'chart-1', rangeKind: 'dataRange', ref: 'B2:C4' }),
    ]);
    await expect(charts.usesRange('Z1')).resolves.toBe(false);
  });
});
