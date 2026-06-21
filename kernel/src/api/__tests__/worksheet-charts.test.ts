import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';
import type { ChartFloatingObject } from '../../bridges/compute/compute-bridge';
import { KernelError } from '../../errors';
import { WorksheetChartsImpl } from '../worksheet/charts';
import { WorksheetImpl } from '../worksheet/worksheet-impl';

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

function createChartsApi(charts: ChartFloatingObject[]): WorksheetChartsImpl {
  const ctx = {
    computeBridge: {
      getChart: jest.fn(async (_sheetId: string, chartId: string) => {
        return charts.find((chart) => chart.id === chartId) ?? null;
      }),
      getAllCharts: jest.fn(async () => charts),
    },
  };
  return new WorksheetChartsImpl(ctx as any, SHEET_ID);
}

function chartOoxmlWithAnchorIndex(anchorIndex: number): ChartFloatingObject['ooxml'] {
  return {
    drawingFrame: {
      anchorIndex,
    },
  } as unknown as ChartFloatingObject['ooxml'];
}

function cellDataValue(value: string | number | boolean | null): unknown {
  if (value === null) return null;
  const type =
    typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'text';
  return { raw: { type, value } };
}

function undefinedPaths(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((child, index) => undefinedPaths(child, `${path}[${index}]`));
  }
  if (!value || typeof value !== 'object') {
    return [];
  }

  const paths: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    if (child === undefined) {
      paths.push(childPath);
    } else {
      paths.push(...undefinedPaths(child, childPath));
    }
  }
  return paths;
}

function createPieChartAddApi(cells: Record<string, string | number | boolean | null> = {}) {
  let createdConfig: ChartFloatingObject | null = null;
  const ctx = {
    awaitMaterialized: jest.fn(async () => undefined),
    computeBridge: {
      createChart: jest.fn(async (_sheetId: string, config: ChartFloatingObject) => {
        createdConfig = config;
        return {
          floatingObjectChanges: [
            {
              sheetId: SHEET_ID,
              objectId: 'created-pie',
              kind: { type: 'created' },
              objectType: 'chart',
              data: makeChart({
                id: 'created-pie',
                chartType: 'pie',
                dataRange: config.dataRange,
                title: config.title,
              }),
            },
          ],
        };
      }),
      getChart: jest.fn(async (_sheetId: string, chartId: string) =>
        chartId === 'created-pie'
          ? makeChart({
              id: 'created-pie',
              chartType: 'pie',
              dataRange: createdConfig?.dataRange,
              title: createdConfig?.title,
            })
          : null,
      ),
      getSheetName: jest.fn(async () => undefined),
      getCellIdAt: jest.fn(async () => null),
      getProjectionSource: jest.fn(async () => null),
      getCellData: jest.fn(async (_sheetId: string, row: number, col: number) =>
        cellDataValue(cells[`${row},${col}`] ?? null),
      ),
    },
  };

  return {
    charts: new WorksheetChartsImpl(ctx as any, SHEET_ID),
    ctx,
    getCreatedConfig: () => createdConfig,
  };
}

describe('WorksheetChartsImpl materialization scopes', () => {
  it('awaits sheet materialization before listing charts by default', async () => {
    const calls: string[] = [];
    const chart = makeChart();
    const ctx = {
      awaitMaterialized: jest.fn(async (scope: string) => {
        calls.push(`await:${scope}`);
      }),
      computeBridge: {
        getAllCharts: jest.fn(async () => {
          calls.push('getAllCharts');
          return [chart];
        }),
      },
    };
    const charts = new WorksheetChartsImpl(ctx as any, SHEET_ID);

    await expect(charts.list()).resolves.toEqual([expect.objectContaining({ id: chart.id })]);

    expect(ctx.awaitMaterialized).toHaveBeenCalledWith(SHEET_ID);
    expect(ctx.computeBridge.getAllCharts).toHaveBeenCalledWith(SHEET_ID);
    expect(calls).toEqual([`await:${SHEET_ID}`, 'getAllCharts']);
  });

  it('does not materialize deferred imports for explicitly available chart lists', async () => {
    const calls: string[] = [];
    const chart = makeChart();
    const ctx = {
      awaitMaterialized: jest.fn(async (scope: string) => {
        calls.push(`await:${scope}`);
      }),
      computeBridge: {
        getAllCharts: jest.fn(async () => {
          calls.push('getAllCharts');
          return [chart];
        }),
      },
    };
    const charts = new WorksheetChartsImpl(ctx as any, SHEET_ID);

    await expect(charts.list({ materialization: 'available' })).resolves.toEqual([
      expect.objectContaining({ id: chart.id }),
    ]);

    expect(ctx.awaitMaterialized).not.toHaveBeenCalled();
    expect(ctx.computeBridge.getAllCharts).toHaveBeenCalledWith(SHEET_ID);
    expect(calls).toEqual(['getAllCharts']);
  });

  it('awaits complete materialization for complete chart lists', async () => {
    const chart = makeChart();
    const ctx = {
      awaitMaterialized: jest.fn(async () => undefined),
      computeBridge: {
        getAllCharts: jest.fn(async () => [chart]),
      },
    };
    const charts = new WorksheetChartsImpl(ctx as any, SHEET_ID);

    await expect(charts.list({ materialization: 'complete' })).resolves.toEqual([
      expect.objectContaining({ id: chart.id }),
    ]);

    expect(ctx.awaitMaterialized).toHaveBeenCalledWith('allSheets');
    expect(ctx.computeBridge.getAllCharts).toHaveBeenCalledWith(SHEET_ID);
  });

  it('awaits sheet materialization before updating charts through helper paths', async () => {
    const calls: string[] = [];
    const chart = makeChart();
    const ctx = {
      awaitMaterialized: jest.fn(async (scope: string) => {
        calls.push(`await:${scope}`);
      }),
      computeBridge: {
        getChart: jest.fn(async () => {
          calls.push('getChart');
          return chart;
        }),
        updateChart: jest.fn(async () => {
          calls.push('updateChart');
        }),
      },
    };
    const charts = new WorksheetChartsImpl(ctx as any, SHEET_ID);

    await charts.update(chart.id, { name: 'Updated chart' });

    expect(ctx.awaitMaterialized).toHaveBeenCalledWith(SHEET_ID);
    expect(ctx.computeBridge.getChart).toHaveBeenCalledWith(SHEET_ID, chart.id);
    expect(ctx.computeBridge.updateChart).toHaveBeenCalledWith(
      SHEET_ID,
      chart.id,
      expect.objectContaining({ name: 'Updated chart' }),
      expect.any(Object),
    );
    expect(calls).toEqual([`await:${SHEET_ID}`, 'getChart', 'getChart', 'updateChart', 'getChart']);
  });

  it('accepts worksheet-scoped short imported chart IDs but returns canonical IDs', async () => {
    const fullId = `chart-import-0-${SHEET_ID}`;
    const chart = makeChart({ id: fullId, name: 'Imported chart' });
    const ctx = {
      awaitMaterialized: jest.fn(async () => undefined),
      computeBridge: {
        getChart: jest.fn(async (_sheetId: string, chartId: string) =>
          chartId === fullId ? chart : null,
        ),
        updateChart: jest.fn(async () => undefined),
      },
    };
    const charts = new WorksheetChartsImpl(ctx as any, SHEET_ID);

    await expect(charts.get('chart-import-0')).resolves.toEqual(
      expect.objectContaining({ id: fullId }),
    );
    await charts.update('chart-import-0', { name: 'Updated import' });

    expect(ctx.computeBridge.updateChart).toHaveBeenCalledWith(
      SHEET_ID,
      fullId,
      expect.objectContaining({ name: 'Updated import' }),
      expect.any(Object),
    );
    expect(ctx.computeBridge.getChart).not.toHaveBeenCalledWith(
      expect.anything(),
      `chart-import-0-other-sheet`,
    );
  });
});

describe('WorksheetChartsImpl mutation receipts', () => {
  it('returns add and duplicate receipts with created chart payloads', async () => {
    const source = makeChart({ id: 'source-chart', chartType: 'bar', dataRange: 'A1:B5' });
    const created = makeChart({ id: 'created-chart', chartType: 'column', dataRange: 'A1:B5' });
    const copy = makeChart({ id: 'copy-chart', chartType: 'bar', dataRange: 'A1:B5' });
    const createdQueue = [created, copy];
    const ctx = {
      awaitMaterialized: jest.fn(async () => undefined),
      computeBridge: {
        createChart: jest.fn(async () => ({
          floatingObjectChanges: [
            {
              sheetId: SHEET_ID,
              objectId: createdQueue[0]?.id,
              kind: { type: 'created' },
              objectType: 'chart',
              data: createdQueue.shift(),
            },
          ],
        })),
        getChart: jest.fn(async (_sheetId: string, chartId: string) => {
          if (chartId === source.id) return source;
          if (chartId === created.id) return created;
          if (chartId === copy.id) return copy;
          return null;
        }),
      },
    };
    const charts = new WorksheetChartsImpl(ctx as any, SHEET_ID);

    const addReceipt = await charts.add({
      type: 'column',
      dataRange: 'A1:B5',
      anchorRow: 1,
      anchorCol: 1,
      width: 8,
      height: 15,
      name: 'Created chart',
    });
    const duplicateReceipt = await charts.duplicate(source.id);

    expect(addReceipt).toEqual(
      expect.objectContaining({
        kind: 'chart.add',
        status: 'applied',
        chart: expect.objectContaining({ id: created.id }),
      }),
    );
    expect(addReceipt.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'createdObject',
          sheetId: SHEET_ID,
          objectId: created.id,
          details: expect.objectContaining({ objectType: 'chart' }),
        }),
        expect.objectContaining({ type: 'invalidatedCache', objectId: created.id }),
      ]),
    );
    expect(duplicateReceipt).toEqual(
      expect.objectContaining({
        kind: 'chart.duplicate',
        status: 'applied',
        sourceChartId: source.id,
        chart: expect.objectContaining({ id: copy.id }),
      }),
    );
    expect(duplicateReceipt.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'createdObject',
          objectId: copy.id,
          details: expect.objectContaining({ objectType: 'chart', sourceObjectId: source.id }),
        }),
      ]),
    );
  });

  it('returns update and remove receipts and forwards root aliases', async () => {
    let chart = makeChart({ name: 'Original chart' });
    const ctx = {
      awaitMaterialized: jest.fn(async () => undefined),
      chartImageExporter: null,
      computeBridge: {
        getChart: jest.fn(async (_sheetId: string, chartId: string) =>
          chartId === chart.id ? chart : null,
        ),
        updateChart: jest.fn(
          async (_sheetId: string, _chartId: string, updates: Partial<ChartFloatingObject>) => {
            chart = { ...chart, ...updates };
          },
        ),
        deleteChart: jest.fn(async () => undefined),
      },
    };
    const charts = new WorksheetChartsImpl(ctx as any, SHEET_ID);
    const worksheet = new WorksheetImpl(SHEET_ID, ctx as any);

    const updateReceipt = await charts.update('chart-1', { name: 'Updated chart' });

    expect(updateReceipt).toEqual(
      expect.objectContaining({
        kind: 'chart.update',
        status: 'applied',
        changedFields: ['name'],
        chart: expect.objectContaining({ id: 'chart-1', name: 'Updated chart' }),
      }),
    );
    expect(updateReceipt.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'updatedObject',
          objectId: 'chart-1',
          details: expect.objectContaining({ objectType: 'chart', changedFields: ['name'] }),
        }),
        expect.objectContaining({ type: 'invalidatedCache', objectId: 'chart-1' }),
      ]),
    );
    await expect(worksheet.updateChart('chart-1', { name: 'Root updated' })).resolves.toEqual(
      expect.objectContaining({ kind: 'chart.update' }),
    );
    await expect(worksheet.removeChart('chart-1')).resolves.toEqual(
      expect.objectContaining({ kind: 'chart.remove', chartId: 'chart-1' }),
    );
    expect(ctx.computeBridge.deleteChart).toHaveBeenCalledWith(
      SHEET_ID,
      'chart-1',
      expect.any(Object),
    );
    expect((await charts.remove('chart-1')).effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'removedObject',
          objectId: 'chart-1',
          details: expect.objectContaining({ objectType: 'chart' }),
        }),
        expect.objectContaining({ type: 'invalidatedCache', objectId: 'chart-1' }),
      ]),
    );
  });

  it('returns an activate receipt with a changed selection target effect', async () => {
    const chart = makeChart();
    const ctx = {
      awaitMaterialized: jest.fn(async () => undefined),
      eventBus: {
        emit: jest.fn(),
      },
      computeBridge: {
        getChart: jest.fn(async (_sheetId: string, chartId: string) =>
          chartId === chart.id ? chart : null,
        ),
      },
    };
    const charts = new WorksheetChartsImpl(ctx as any, SHEET_ID);

    const receipt = await charts.activate(chart.id);

    expect(ctx.eventBus.emit).toHaveBeenCalledWith({
      type: 'chart:selected',
      sheetId: SHEET_ID,
      chartId: chart.id,
    });
    expect(receipt).toEqual(
      expect.objectContaining({
        kind: 'chart.activate',
        status: 'applied',
        diagnostics: [],
        chartId: chart.id,
        effects: [
          expect.objectContaining({
            type: 'changedSelectionTarget',
            sheetId: SHEET_ID,
            objectId: chart.id,
            details: expect.objectContaining({ objectType: 'chart' }),
          }),
        ],
      }),
    );
  });
});

describe('WorksheetChartsImpl chart title inference', () => {
  const tableCells = {
    '3,2': 'Market',
    '3,3': 'Net Income',
    '4,2': 'Europe',
    '4,3': 10000,
    '5,2': 'Asia',
    '5,3': 20000,
    '6,2': 'LATAM',
    '6,3': 30000,
    '7,2': 'EMEA',
    '7,3': 10000,
  };

  it('infers a pie chart title from a single value-header table', async () => {
    const { charts, ctx, getCreatedConfig } = createPieChartAddApi(tableCells);

    const receipt = await charts.add({
      type: 'pie',
      dataRange: 'C4:D8',
      anchorRow: 9,
      anchorCol: 2,
      width: 480,
      height: 300,
    });

    expect(getCreatedConfig()).toEqual(expect.objectContaining({ title: 'Net Income' }));
    expect(receipt.chart).toEqual(expect.objectContaining({ title: 'Net Income' }));
    expect(ctx.computeBridge.getCellData).toHaveBeenCalledWith(SHEET_ID, 3, 3);
  });

  it('preserves explicit title deletion instead of inferring from headers', async () => {
    const { charts, getCreatedConfig } = createPieChartAddApi(tableCells);

    await charts.add({
      type: 'pie',
      dataRange: 'C4:D8',
      anchorRow: 9,
      anchorCol: 2,
      width: 480,
      height: 300,
      title: null,
    });

    expect(getCreatedConfig()?.title).toBeUndefined();
  });

  it('persists chartTitle.text as the public chart title without reading range cells', async () => {
    const { charts, ctx, getCreatedConfig } = createPieChartAddApi();

    await charts.add({
      type: 'pie',
      dataRange: 'C4:D8',
      anchorRow: 9,
      anchorCol: 2,
      width: 480,
      height: 300,
      chartTitle: { text: 'Custom title' },
    });

    expect(getCreatedConfig()).toEqual(expect.objectContaining({ title: 'Custom title' }));
    expect(ctx.computeBridge.getCellData).not.toHaveBeenCalled();
  });
});

describe('WorksheetChartsImpl chart title substrings', () => {
  it('reads substrings from a plain chart title', async () => {
    const charts = createChartsApi([makeChart({ title: 'Revenue by Month' })]);

    await expect(charts.getTitleSubstring('chart-1', 0, 16)).resolves.toEqual({
      text: 'Revenue by Month',
    });
    await expect(charts.getTitleSubstring('chart-1', 8, 2)).resolves.toEqual({ text: 'by' });
  });

  it('reads substrings from rich chart title runs', async () => {
    const charts = createChartsApi([
      makeChart({
        titleRichText: [
          { text: 'Revenue', font: { bold: true } },
          { text: ' by Month', font: { italic: true } },
        ],
      }),
    ]);

    await expect(charts.getTitleSubstring('chart-1', 2, 8)).resolves.toEqual({
      text: 'venue by',
      font: { bold: true },
    });
  });
});

describe('WorksheetChartsImpl chart create payloads', () => {
  it('omits undefined optional chart fields before sending payloads to compute', async () => {
    const { charts, getCreatedConfig } = createPieChartAddApi();

    await charts.add({
      type: 'column',
      subType: 'clustered',
      dataRange: 'A1:B5',
      seriesOrientation: 'columns',
      anchorRow: 2,
      anchorCol: 2,
      width: 8,
      height: 15,
      title: 'Sales',
      axis: {
        xAxis: { type: 'category', visible: true, title: undefined, gridLines: false },
        yAxis: { type: 'value', visible: true, title: undefined, gridLines: true },
      },
      legend: { show: true, position: 'right', visible: true },
      dataLabels: { show: false },
    });

    const createdConfig = getCreatedConfig();

    expect(createdConfig).not.toHaveProperty('showLines');
    expect(createdConfig).not.toHaveProperty('plotVisibleOnly');
    expect(undefinedPaths(createdConfig)).toEqual([]);
  });
});

describe('WorksheetChartsImpl range-backed series overrides', () => {
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
        computeBridge: {
          getChart: jest.fn(async () => chart),
          updateChart,
        },
      } as any,
      SHEET_ID,
    );
    return { charts, updateChart, getChart: () => chart };
  }

  it('materializes point data-label dimensions for implicit dataRange series', async () => {
    const { charts, getChart } = createMutableChartsApi(
      makeChart({
        chartType: 'bar',
        dataRange: 'D1:E3',
        dataLabels: { show: true },
      }),
    );

    await charts.setDataLabelHeight('chart-1', 0, 0, 18);
    await charts.setDataLabelWidth('chart-1', 0, 0, 48);

    expect(getChart().series?.[0]?.points?.[0]?.dataLabel).toEqual(
      expect.objectContaining({ show: true, height: 18, width: 48 }),
    );
  });

  it('round-trips statistical options on implicit dataRange series', async () => {
    const { charts } = createMutableChartsApi(
      makeChart({
        chartType: 'bar',
        dataRange: 'A1:B5',
      }),
    );

    await charts.setSeriesBinOptions('chart-1', 0, {
      binCount: 4,
      overflowBin: true,
      overflowBinValue: 35,
    });
    await charts.setSeriesBoxwhiskerOptions('chart-1', 0, {
      showMeanMarkers: true,
      showMeanLine: true,
      quartileMethod: 'exclusive',
      whiskerType: 'tukey',
    });

    await expect(charts.getSeriesBinOptions('chart-1', 0)).resolves.toEqual(
      expect.objectContaining({ binCount: 4, overflowBin: true, overflowBinValue: 35 }),
    );
    await expect(charts.getSeriesBoxwhiskerOptions('chart-1', 0)).resolves.toEqual(
      expect.objectContaining({
        showMeanMarkers: true,
        showMeanLine: true,
        quartileMethod: 'exclusive',
        whiskerType: 'tukey',
      }),
    );
  });

  it('does not expose inferred dataRange series after explicit series are present', async () => {
    const { charts } = createMutableChartsApi(
      makeChart({
        chartType: 'bar',
        dataRange: 'A1:C5',
        series: [{ name: 'Revenue', values: 'B2:B5', categories: 'A2:A5' }],
      }),
    );

    await expect(charts.getSeriesCount('chart-1')).resolves.toBe(1);
    await expect(charts.getSeries('chart-1', 1)).rejects.toThrow(
      'Series index 1 out of range (0-0)',
    );
  });
});

describe('WorksheetChartsImpl chart list ordering', () => {
  it('orders imported charts by drawing frame anchorIndex before serialization', async () => {
    const anchor7 = makeChart({
      id: 'anchor-7',
      name: 'Chart anchor 7',
      ooxml: chartOoxmlWithAnchorIndex(7),
    });
    const anchor3 = makeChart({
      id: 'anchor-3',
      name: 'Chart anchor 3',
      ooxml: chartOoxmlWithAnchorIndex(3),
    });
    const charts = createChartsApi([anchor7, anchor3]);

    await expect(charts.list()).resolves.toEqual([
      expect.objectContaining({ id: 'anchor-3', name: 'Chart anchor 3' }),
      expect.objectContaining({ id: 'anchor-7', name: 'Chart anchor 7' }),
    ]);
  });

  it('preserves computeBridge order for charts without imported anchor metadata', async () => {
    const first = makeChart({ id: 'first-chart', name: 'First chart' });
    const second = makeChart({ id: 'second-chart', name: 'Second chart' });
    const charts = createChartsApi([first, second]);

    await expect(charts.list()).resolves.toEqual([
      expect.objectContaining({ id: 'first-chart', name: 'First chart' }),
      expect.objectContaining({ id: 'second-chart', name: 'Second chart' }),
    ]);
  });
});

describe('WorksheetChartsImpl chart ref read normalization', () => {
  it('normalizes imported absolute A1 refs from get and list without changing malformed refs', async () => {
    const imported = makeChart({
      id: 'imported',
      dataRange: "'Data'!$A$1:$B$6",
      seriesRange: "'Data'!$A$1:$A$6",
      categoryRange: "'Data'!$A$2:$A$6",
      series: [
        {
          values: "'Data'!$B$2:$B$6",
          categories: "'Data'!$A$2:$A$6",
          bubbleSize: "'Q1 Data''s'!$C$2:$C$6",
        },
      ],
    });
    const malformed = makeChart({
      id: 'malformed',
      dataRange: 'NamedRange',
      seriesRange: '=SERIES(Sheet1!$A$1,Sheet1!$A$2:$A$6,Sheet1!$B$2:$B$6,1)',
      categoryRange: 'Table1[Category]',
      series: [
        {
          values: 'Table1[Value]',
          categories: '',
          bubbleSize: 'Data!$C$2:$C',
        },
      ],
    });
    const charts = createChartsApi([imported, malformed]);

    await expect(charts.get('imported')).resolves.toEqual(
      expect.objectContaining({
        dataRange: 'Data!A1:B6',
        seriesRange: 'Data!A1:A6',
        categoryRange: 'Data!A2:A6',
        series: [
          expect.objectContaining({
            values: 'Data!B2:B6',
            categories: 'Data!A2:A6',
            bubbleSize: "'Q1 Data''s'!C2:C6",
          }),
        ],
      }),
    );

    await expect(charts.list()).resolves.toEqual([
      expect.objectContaining({
        dataRange: 'Data!A1:B6',
        series: [
          expect.objectContaining({
            values: 'Data!B2:B6',
            categories: 'Data!A2:A6',
            bubbleSize: "'Q1 Data''s'!C2:C6",
          }),
        ],
      }),
      expect.objectContaining({
        dataRange: 'NamedRange',
        seriesRange: '=SERIES(Sheet1!$A$1,Sheet1!$A$2:$A$6,Sheet1!$B$2:$B$6,1)',
        categoryRange: 'Table1[Category]',
        series: [
          expect.objectContaining({
            values: 'Table1[Value]',
            categories: '',
            bubbleSize: 'Data!$C$2:$C',
          }),
        ],
      }),
    ]);
  });
});

describe('WorksheetChartsImpl rich chart format boundary', () => {
  it('normalizes wire chart format colors on read', async () => {
    const charts = createChartsApi([
      makeChart({
        chartFormat: { fill: { type: 'solid', color: { theme: 'accent1', tint_shade: 0.2 } } },
        titleRichText: [
          { text: 'Revenue', font: { color: { theme: 'accent2', tint_shade: -0.2 } } },
        ],
        dataTable: {
          visible: true,
          format: { shadow: { color: { theme: 'accent3', tint_shade: 0.3 } } },
        },
        chartStyleContext: {
          colorMapOverride: { type: 'master' },
          owners: [
            {
              ownerKey: 'plot-area',
              format: { line: { color: { theme: 'accent4', tint_shade: -0.3 } } },
              richText: [{ text: 'Owner', font: { color: { theme: 'accent5', tint_shade: 0.4 } } }],
            },
          ],
        },
      }),
    ]);

    await expect(charts.get('chart-1')).resolves.toEqual(
      expect.objectContaining({
        chartFormat: {
          fill: { type: 'solid', color: { theme: 'accent1', tintShade: 0.2 } },
        },
        titleRichText: [
          { text: 'Revenue', font: { color: { theme: 'accent2', tintShade: -0.2 } } },
        ],
        dataTable: {
          visible: true,
          format: { shadow: { color: { theme: 'accent3', tintShade: 0.3 } } },
        },
        chartStyleContext: {
          colorMapOverride: { type: 'master' },
          owners: [
            {
              ownerKey: 'plot-area',
              format: { line: { color: { theme: 'accent4', tintShade: -0.3 } } },
              richText: [{ text: 'Owner', font: { color: { theme: 'accent5', tintShade: 0.4 } } }],
            },
          ],
        },
      }),
      expect.any(Object),
    );
  });

  it('writes public chart format colors to the wire shape on update', async () => {
    const chart = makeChart();
    const updateChart = jest.fn(async () => undefined);
    const charts = new WorksheetChartsImpl(
      {
        computeBridge: {
          getChart: jest.fn(async () => chart),
          updateChart,
        },
      } as any,
      SHEET_ID,
    );

    await charts.update('chart-1', {
      chartFormat: { fill: { type: 'solid', color: { theme: 'accent1', tintShade: 0.2 } } },
      titleRichText: [{ text: 'Revenue', font: { color: { theme: 'accent2', tintShade: -0.2 } } }],
      dataTable: {
        visible: true,
        format: { shadow: { color: { theme: 'accent3', tintShade: 0.3 } } },
      },
      trendlines: [
        {
          label: {
            format: { font: { color: { theme: 'accent4', tintShade: -0.3 } } },
          },
        },
      ],
      chartStyleContext: {
        owners: [
          {
            ownerKey: 'plot-area',
            richText: [{ text: 'Owner', font: { color: { theme: 'accent5', tintShade: 0.4 } } }],
          },
        ],
      },
    });

    expect(updateChart).toHaveBeenCalledWith(
      SHEET_ID,
      'chart-1',
      expect.objectContaining({
        chartFormat: {
          fill: { type: 'solid', color: { theme: 'accent1', tint_shade: 0.2 } },
        },
        titleRichText: [
          { text: 'Revenue', font: { color: { theme: 'accent2', tint_shade: -0.2 } } },
        ],
        dataTable: {
          visible: true,
          format: { shadow: { color: { theme: 'accent3', tint_shade: 0.3 } } },
        },
        trendline: [
          expect.objectContaining({
            label: {
              format: { font: { color: { theme: 'accent4', tint_shade: -0.3 } } },
            },
          }),
        ],
        chartStyleContext: {
          owners: [
            {
              ownerKey: 'plot-area',
              richText: [{ text: 'Owner', font: { color: { theme: 'accent5', tint_shade: 0.4 } } }],
            },
          ],
        },
      }),
      expect.any(Object),
    );
  });
});

describe('WorksheetChartsImpl ChartEx-family config mapping', () => {
  it('preserves imported ChartEx family options on read', async () => {
    const charts = createChartsApi([
      makeChart({
        chartType: 'waterfall',
        waterfall: {
          subtotalIndices: [1, 3],
          showConnectorLines: false,
        },
        histogram: {
          binCount: 8,
          underflowBin: true,
          underflowBinValue: 1,
        },
        boxplot: {
          showOutlierPoints: false,
          showMeanMarkers: true,
          showMeanLine: true,
          quartileMethod: 'exclusive',
        },
        hierarchy: {
          categoryFormulas: ['Sheet1!A1:A3'],
          valueFormula: 'Sheet1!B1:B3',
          parentLabelLayout: 'banner',
        },
        regionMap: {
          regionFormula: 'Sheet1!A1:A3',
          valueFormula: 'Sheet1!B1:B3',
        },
      }),
    ]);

    await expect(charts.get('chart-1')).resolves.toEqual(
      expect.objectContaining({
        waterfall: {
          subtotalIndices: [1, 3],
          totalIndices: [1, 3],
          showConnectorLines: false,
        },
        histogram: {
          binCount: 8,
          binWidth: undefined,
          overflowBin: undefined,
          overflowBinValue: undefined,
          underflowBin: true,
          underflowBinValue: 1,
        },
        boxplot: {
          showOutlierPoints: false,
          showOutliers: false,
          showMeanMarkers: true,
          showMean: true,
          showMeanLine: true,
          quartileMethod: 'exclusive',
        },
        hierarchy: {
          categoryFormulas: ['Sheet1!A1:A3'],
          valueFormula: 'Sheet1!B1:B3',
          parentLabelLayout: 'banner',
        },
        regionMap: {
          regionFormula: 'Sheet1!A1:A3',
          valueFormula: 'Sheet1!B1:B3',
        },
      }),
    );
  });

  it('writes ChartEx family options through the generated compute bridge shape', async () => {
    const chart = makeChart({ chartType: 'waterfall' });
    const updateChart = jest.fn(async () => undefined);
    const charts = new WorksheetChartsImpl(
      {
        computeBridge: {
          getChart: jest.fn(async () => chart),
          updateChart,
        },
      } as any,
      SHEET_ID,
    );

    await charts.update('chart-1', {
      waterfall: {
        subtotalIndices: [2],
        totalIndices: [9],
        showConnectorLines: true,
      },
      histogram: {
        binWidth: 2.5,
        overflowBin: true,
        overflowBinValue: 10,
      },
      boxplot: {
        showOutliers: false,
        showMean: true,
        quartileMethod: 'inclusive',
      },
      hierarchy: {
        categoryFormulas: ['Sheet1!A1:A3'],
        valueFormula: 'Sheet1!B1:B3',
        parentLabelLayout: 'overlapping',
      },
      regionMap: {
        regionFormula: 'Sheet1!A1:A3',
        valueFormula: 'Sheet1!B1:B3',
      },
    });

    expect(updateChart).toHaveBeenCalledWith(
      SHEET_ID,
      'chart-1',
      expect.objectContaining({
        waterfall: {
          subtotalIndices: [2],
          showConnectorLines: true,
        },
        histogram: {
          binWidth: 2.5,
          overflowBin: true,
          overflowBinValue: 10,
        },
        boxplot: {
          showOutlierPoints: false,
          showMeanMarkers: true,
          quartileMethod: 'inclusive',
        },
        hierarchy: {
          categoryFormulas: ['Sheet1!A1:A3'],
          valueFormula: 'Sheet1!B1:B3',
          parentLabelLayout: 'overlapping',
        },
        regionMap: {
          regionFormula: 'Sheet1!A1:A3',
          valueFormula: 'Sheet1!B1:B3',
        },
      }),
      expect.any(Object),
    );
  });
});

describe('WorksheetChartsImpl surface chart config mapping', () => {
  it('preserves imported surface rendering options on read', async () => {
    const charts = createChartsApi([
      makeChart({
        chartType: 'surface3D',
        wireframe: true,
        surfaceTopView: false,
        view3d: { rotX: 15, rotY: 20, depthPercent: 125 },
        floorFormat: { fill: { type: 'solid', color: { theme: 'lt1', tint_shade: -0.1 } } },
      }),
    ]);

    await expect(charts.get('chart-1')).resolves.toEqual(
      expect.objectContaining({
        type: 'surface3D',
        wireframe: true,
        surfaceTopView: false,
        view3d: { rotX: 15, rotY: 20, depthPercent: 125 },
        floorFormat: { fill: { type: 'solid', color: { theme: 'lt1', tintShade: -0.1 } } },
      }),
    );
  });

  it('writes surface rendering options through the generated compute bridge shape', async () => {
    const chart = makeChart({ chartType: 'surface3D' });
    const updateChart = jest.fn(async () => undefined);
    const charts = new WorksheetChartsImpl(
      {
        computeBridge: {
          getChart: jest.fn(async () => chart),
          updateChart,
        },
      } as any,
      SHEET_ID,
    );

    await charts.update('chart-1', {
      wireframe: true,
      surfaceTopView: false,
      view3d: { rotX: 15, rotY: 20 },
      floorFormat: { fill: { type: 'solid', color: { theme: 'lt1', tintShade: -0.1 } } },
    });

    expect(updateChart).toHaveBeenCalledWith(
      SHEET_ID,
      'chart-1',
      expect.objectContaining({
        wireframe: true,
        surfaceTopView: false,
        view3d: { rotX: 15, rotY: 20 },
        floorFormat: { fill: { type: 'solid', color: { theme: 'lt1', tint_shade: -0.1 } } },
      }),
      expect.any(Object),
    );
  });
});

describe('Worksheet chart image export', () => {
  it('delegates worksheet.charts.exportImage through the context chart image exporter', async () => {
    const chart = makeChart();
    const options = {
      format: 'png' as const,
      width: 640,
      height: 360,
      pixelRatio: 2,
      backgroundColor: '#ffffff',
    };
    const dataUrl = 'data:image/png;base64,ZmFrZS1wbmc=';
    const exporter = {
      exportImage: jest.fn(async () => dataUrl),
    };
    const ctx = {
      chartImageExporter: exporter,
      computeBridge: {
        getChart: jest.fn(async () => chart),
      },
    };

    const worksheet = new WorksheetImpl(SHEET_ID, ctx as any);

    await expect(worksheet.charts.exportImage(chart.id, options)).resolves.toBe(dataUrl);
    expect(exporter.exportImage).toHaveBeenCalledWith(SHEET_ID, chart.id, options);
  });

  it('uses a chart image exporter registered after the worksheet charts API is cached', async () => {
    const chart = makeChart();
    const dataUrl = 'data:image/png;base64,cmVnaXN0ZXJlZC1sYXRl';
    const ctx: any = {
      chartImageExporter: null,
      computeBridge: {
        getChart: jest.fn(async () => chart),
      },
    };
    const charts = new WorksheetChartsImpl(ctx, SHEET_ID);
    const exporter = {
      exportImage: jest.fn(async () => dataUrl),
    };

    ctx.chartImageExporter = exporter;

    await expect(charts.exportImage(chart.id)).resolves.toBe(dataUrl);
    expect(exporter.exportImage).toHaveBeenCalledWith(SHEET_ID, chart.id, undefined);
  });

  it('wraps exporter failures as operation errors while preserving cause', async () => {
    const chart = makeChart();
    const cause = new Error('native chart raster backend missing');
    const exporter = {
      exportImage: jest.fn(async () => {
        throw cause;
      }),
    };
    const ctx = {
      chartImageExporter: exporter,
      computeBridge: {
        getChart: jest.fn(async () => chart),
      },
    };
    const worksheet = new WorksheetImpl(SHEET_ID, ctx as any);

    let caught: unknown;
    try {
      await worksheet.charts.exportImage(chart.id);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(KernelError);
    expect((caught as KernelError).message).toBe(
      'Operation "exportChartImage" failed: native chart raster backend missing',
    );
    expect((caught as KernelError).cause).toBe(cause);
  });
});
