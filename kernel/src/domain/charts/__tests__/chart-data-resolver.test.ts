import { jest } from '@jest/globals';

import { HIDDEN_CHART_CELL, type ChartData } from '@mog/charts';
import { sheetId as toSheetId, type CellRange, type SheetId } from '@mog-sdk/contracts/core';

import type { ChartFloatingObject } from '../../../bridges/compute/compute-bridge';
import type { DocumentContext } from '../../../context/types';
import type { ResolvedChartRangeReferences } from '../chart-range-references';
import {
  ChartDataResolver,
  chartDataToRows,
  createCellAccessor,
  seriesSheetAliases,
} from '../bridge/chart-data-resolver';

const SHEET_A: SheetId = toSheetId('sheet-a');
const SHEET_SIZES: SheetId = toSheetId('sheet-sizes');
const CHART_ID = 'chart-1';

function range(
  sheetId: SheetId | string,
  startRow: number,
  startCol: number,
  endRow = startRow,
  endCol = startCol,
): CellRange {
  return {
    sheetId,
    startRow,
    startCol,
    endRow,
    endCol,
  };
}

function chart(overrides: Partial<ChartFloatingObject> = {}): ChartFloatingObject {
  return {
    id: CHART_ID,
    type: 'chart',
    chartType: 'bar',
    sheetId: SHEET_A as unknown as string,
    anchor: { anchorRow: 0, anchorCol: 0, anchorCellId: 'cell-0' as never },
    widthCells: 4,
    heightCells: 10,
    dataRange: 'A1:C1',
    ...overrides,
  } as unknown as ChartFloatingObject;
}

function ctx(overrides: Record<string, unknown> = {}): DocumentContext {
  return {
    computeBridge: {
      getChart: jest.fn(async () => null),
      getSheetName: jest.fn(async () => 'Sheet1'),
      getCellIdAt: jest.fn(async () => null),
      getActiveCell: jest.fn(async () => null),
      getProjectionSource: jest.fn(async () => null),
      getCellData: jest.fn(async () => null),
      getWorkbookTheme: jest.fn(async () => null),
      ...overrides,
    },
  } as unknown as DocumentContext;
}

function resolvedRanges(overrides: Partial<ResolvedChartRangeReferences> = {}) {
  return {
    dataRange: {
      kind: 'dataRange',
      source: 'a1',
      ref: 'A1:C1',
      range: range(SHEET_A, 0, 0, 0, 2),
    },
    categoryRange: null,
    seriesRange: null,
    seriesReferences: [],
    diagnostics: [],
    ...overrides,
  } as unknown as ResolvedChartRangeReferences;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('chart data resolver helpers', () => {
  it('flattens extracted chart data rows for the public resolveChartData facade', () => {
    const data: ChartData = {
      categories: ['FY24', 'FY25'],
      series: [
        {
          name: 'Revenue',
          data: [
            { x: 'FY24', y: 10 },
            { x: 'FY25', y: 20 },
          ],
        },
        {
          name: 'Cost',
          data: [
            { x: 'FY24', y: 4 },
            { x: 'FY25', y: 8 },
          ],
        },
      ],
    };

    expect(chartDataToRows(data)).toEqual([
      {
        category: 'FY24',
        x: 'FY24',
        y: 10,
        value: 10,
        series: 'Revenue',
        sourceSeriesIndex: 0,
        sourceSeriesKey: 'series:0',
      },
      {
        category: 'FY24',
        x: 'FY24',
        y: 4,
        value: 4,
        series: 'Cost',
        sourceSeriesIndex: 1,
        sourceSeriesKey: 'series:1',
      },
      {
        category: 'FY25',
        x: 'FY25',
        y: 20,
        value: 20,
        series: 'Revenue',
        sourceSeriesIndex: 0,
        sourceSeriesKey: 'series:0',
      },
      {
        category: 'FY25',
        x: 'FY25',
        y: 8,
        value: 8,
        series: 'Cost',
        sourceSeriesIndex: 1,
        sourceSeriesKey: 'series:1',
      },
    ]);
  });

  it('maps explicit series sheet-name aliases to resolved sheet ids', () => {
    const aliases = seriesSheetAliases(
      resolvedRanges({
        seriesReferences: [
          {
            index: 0,
            name: {
              kind: 'seriesName',
              source: 'a1',
              ref: 'Names!A1',
              range: range('sheet-names', 0, 0, 0, 0),
            },
            values: {
              kind: 'seriesValues',
              source: 'a1',
              ref: 'Revenue!A1:C1',
              range: range('sheet-revenue', 0, 0, 0, 2),
            },
            categories: {
              kind: 'seriesCategories',
              source: 'a1',
              ref: 'Calendar!A1:C1',
              range: range('sheet-calendar', 0, 0, 0, 2),
            },
            bubbleSizes: {
              kind: 'seriesBubbleSizes',
              source: 'a1',
              ref: 'Size Data!A1:C1',
              range: range('sheet-sizes', 0, 0, 0, 2),
            },
          },
        ],
      }),
    );

    expect(aliases).toEqual(
      new Map([
        ['Revenue', 'sheet-revenue'],
        ['Names', 'sheet-names'],
        ['Calendar', 'sheet-calendar'],
        ['Size Data', 'sheet-sizes'],
      ]),
    );
  });

  it('prefetches cell values once, applies aliases, and masks hidden cells', async () => {
    const getCellData = jest.fn(async (_sheetId, row: number, col: number) => ({
      value: { type: 'number', value: row * 10 + col },
    }));
    const visibility = {
      hiddenRowsBySheet: new Map([['sheet-a', new Set([1])]]),
      hiddenColsBySheet: new Map<string, Set<number>>(),
    };

    const accessor = await createCellAccessor(
      ctx({ getCellData }),
      [range(SHEET_A, 0, 0, 1, 1), range(SHEET_A, 0, 0, 0, 0)],
      {
        defaultSheetId: SHEET_A,
        sheetAliases: new Map([['Sheet 1', String(SHEET_A)]]),
        hiddenVisibility: visibility,
      },
    );

    expect(getCellData).toHaveBeenCalledTimes(2);
    expect(accessor.getValue(0, 0)).toBe(0);
    expect(accessor.getValue(0, 0, 'Sheet 1')).toBe(0);
    expect(accessor.getValue(0, 1)).toBe(1);
    expect(accessor.getValue(1, 0)).toBe(HIDDEN_CHART_CELL);
  });
});

describe('ChartDataResolver', () => {
  it('returns CHART_NOT_FOUND through the resolver facade', async () => {
    await expect(new ChartDataResolver(ctx()).resolveChartData(SHEET_A, CHART_ID)).resolves.toEqual(
      {
        success: false,
        error: {
          code: 'CHART_NOT_FOUND',
          message: 'Chart not found',
          chartId: CHART_ID,
        },
      },
    );
  });

  it('uses compiler row semantics in the public resolveChartData facade', async () => {
    const getCellData = jest.fn(async () => null);
    const resolver = new ChartDataResolver(
      ctx({
        getChart: jest.fn(async () =>
          chart({
            chartType: 'line',
            dataRange: undefined,
            displayBlanksAs: 'gap',
            series: [
              {
                name: 'Literal gaps',
                valueSourceKind: 'literal',
                valueCache: {
                  pointCount: 3,
                  points: [
                    { idx: 0, value: '1' },
                    { idx: 2, value: '2' },
                  ],
                },
                categorySourceKind: 'literal',
                categoryCache: {
                  pointCount: 3,
                  points: [
                    { idx: 0, value: 'A' },
                    { idx: 1, value: 'B' },
                    { idx: 2, value: 'C' },
                  ],
                },
              },
            ],
          }),
        ),
        getCellData,
      }),
    );

    const result = await resolver.resolveChartData(SHEET_A, CHART_ID);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(getCellData).not.toHaveBeenCalled();
    expect(result.data).toEqual([
      expect.objectContaining({
        category: 'A',
        x: 'A',
        value: 1,
        y: 1,
        series: 'Literal gaps',
        __mogPointIndex: 0,
        __mogLineSegment: 0,
      }),
      expect.objectContaining({
        category: 'B',
        x: 'B',
        series: 'Literal gaps',
        __mogPointIndex: 1,
        __mogBlankValue: true,
      }),
      expect.objectContaining({
        category: 'C',
        x: 'C',
        value: 2,
        y: 2,
        series: 'Literal gaps',
        __mogPointIndex: 2,
        __mogLineSegment: 1,
      }),
    ]);
    expect(result.data[1]).not.toHaveProperty('value');
  });

  it('uses compiler bubble row semantics in the public resolveChartData facade', async () => {
    const getCellData = jest.fn(async () => null);
    const resolver = new ChartDataResolver(
      ctx({
        getChart: jest.fn(async () =>
          chart({
            chartType: 'bubble',
            dataRange: undefined,
            showNegBubbles: true,
            sizeRepresents: 'w',
            series: [
              {
                name: 'Bubbles',
                valueSourceKind: 'literal',
                valueCache: {
                  pointCount: 2,
                  points: [
                    { idx: 0, value: '10' },
                    { idx: 1, value: '20' },
                  ],
                },
                categorySourceKind: 'literal',
                categoryCache: {
                  pointCount: 2,
                  points: [
                    { idx: 0, value: '1' },
                    { idx: 1, value: '2' },
                  ],
                },
                bubbleSizeSourceKind: 'literal',
                bubbleSizeCache: {
                  pointCount: 2,
                  points: [
                    { idx: 0, value: '-10' },
                    { idx: 1, value: '20' },
                  ],
                },
              },
            ],
          }),
        ),
        getCellData,
      }),
    );

    const result = await resolver.resolveChartData(SHEET_A, CHART_ID);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(getCellData).not.toHaveBeenCalled();
    expect(result.data).toEqual([
      expect.objectContaining({
        category: '1',
        x: 1,
        value: 10,
        y: 10,
        size: 5,
        __mogRawBubbleSize: -10,
        series: 'Bubbles',
        __mogPointIndex: 0,
      }),
      expect.objectContaining({
        category: '2',
        x: 2,
        value: 20,
        y: 20,
        size: 20,
        __mogRawBubbleSize: 20,
        series: 'Bubbles',
        __mogPointIndex: 1,
      }),
    ]);
  });

  it('extracts dataRange-only bubble charts through the public resolveChartData facade', async () => {
    const values = [
      ['X', 'Revenue', 'Revenue Size'],
      [1, 10, 4],
      [2, 20, 9],
      [10, 30, 16],
    ];
    const getCellData = jest.fn(async (_sheetId, row: number, col: number) => {
      const value = values[row]?.[col];
      if (typeof value === 'number') return { value: { type: 'number', value } };
      if (typeof value === 'string') return { value: { type: 'text', value } };
      return null;
    });
    const resolver = new ChartDataResolver(
      ctx({
        getChart: jest.fn(async () =>
          chart({
            chartType: 'bubble',
            dataRange: 'A1:C4',
          }),
        ),
        getCellData,
      }),
    );

    const result = await resolver.resolveChartData(SHEET_A, CHART_ID);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual([
      expect.objectContaining({
        category: '1',
        x: 1,
        value: 10,
        y: 10,
        size: 4,
        __mogRawBubbleSize: 4,
        series: 'Revenue',
      }),
      expect.objectContaining({
        category: '2',
        x: 2,
        value: 20,
        y: 20,
        size: 9,
        __mogRawBubbleSize: 9,
        series: 'Revenue',
      }),
      expect.objectContaining({
        category: '10',
        x: 10,
        value: 30,
        y: 30,
        size: 16,
        __mogRawBubbleSize: 16,
        series: 'Revenue',
      }),
    ]);
  });

  it('resolves render-ready range data for a chart id and sheet id', async () => {
    const getCellData = jest.fn(async (_sheetId, _row: number, col: number) => ({
      value: { type: 'number', value: [10, 20, 30][col] ?? null },
    }));

    const result = await new ChartDataResolver(
      ctx({
        getChart: jest.fn(async () => chart()),
        getCellData,
      }),
    ).resolveForRendering(SHEET_A, CHART_ID);

    expect('code' in result).toBe(false);
    if ('code' in result) return;
    expect(result.chart.id).toBe(CHART_ID);
    expect(result.config.type).toBe('bar');
    expect(result.data).toMatchObject({
      categories: [1, 2, 3],
      series: [
        {
          name: 'Series 1',
          data: [
            { x: 1, y: 10 },
            { x: 2, y: 20 },
            { x: 3, y: 30 },
          ],
        },
      ],
    });
  });

  it('does not enter imported-series rendering for sparse cache points outside explicit zero pointCount', async () => {
    const getCellData = jest.fn(async () => ({ value: { type: 'number', value: 10 } }));
    const resolver = new ChartDataResolver(ctx({ getCellData }));

    const result = await resolver.resolveChartDataForRendering(
      chart({
        dataRange: undefined,
        series: [
          {
            valueCache: {
              pointCount: 0,
              points: [{ idx: 0, value: '10' }],
            },
          },
        ],
      }),
      resolvedRanges({
        dataRange: null,
        diagnostics: [
          {
            kind: 'dataRange',
            code: 'MISSING_REF',
            message: 'Chart has no data range reference',
          },
        ],
      }),
      CHART_ID,
    );

    expect(result).toEqual({
      code: 'DATA_UNAVAILABLE',
      message: 'Chart has no data range reference',
      chartId: CHART_ID,
    });
    expect(getCellData).not.toHaveBeenCalled();
  });

  it('renders unresolved imported refs from fallback caches', async () => {
    const getCellData = jest.fn(async () => ({ value: { type: 'number', value: null } }));
    const resolver = new ChartDataResolver(ctx({ getCellData }));

    const result = await resolver.resolveChartDataForRendering(
      chart({
        chartType: 'bubble',
        dataRange: undefined,
        series: [
          {
            name: 'Fallback',
            values: 'Missing!B1:C1',
            valueSourceKind: 'ref',
            valueCache: {
              pointCount: 2,
              points: [
                { idx: 0, value: '10' },
                { idx: 1, value: '20' },
              ],
            },
            categories: 'Missing!A1:B1',
            categorySourceKind: 'ref',
            categoryCache: {
              pointCount: 2,
              points: [
                { idx: 0, value: '1' },
                { idx: 1, value: '2' },
              ],
            },
            bubbleSize: 'Missing!D1:E1',
            bubbleSizeSourceKind: 'ref',
            bubbleSizeCache: {
              pointCount: 2,
              points: [
                { idx: 0, value: '5' },
                { idx: 1, value: '15' },
              ],
            },
          },
        ],
      }),
      resolvedRanges({
        dataRange: null,
        seriesReferences: [{ index: 0, values: null, categories: null, bubbleSizes: null }],
      }),
      CHART_ID,
    );

    expect('code' in result).toBe(false);
    if ('code' in result) return;
    expect(getCellData).not.toHaveBeenCalled();
    expect(result.config.series?.[0]).toMatchObject({
      valueSourceKind: 'cacheFallback',
      categorySourceKind: 'cacheFallback',
      bubbleSizeSourceKind: 'cacheFallback',
    });
    expect(result.data.categories).toEqual([1, 2]);
    expect(result.data.series[0].data.map((point) => point.y)).toEqual([10, 20]);
    expect(result.data.series[0].data.map((point) => point.size)).toEqual([5, 15]);
    expect(chartDataToRows(result.data).map((row) => row.size)).toEqual([5, 15]);
  });

  it('renders unresolved multi-level category refs from fallback level caches', async () => {
    const getCellData = jest.fn(async () => ({ value: { type: 'number', value: null } }));
    const resolver = new ChartDataResolver(ctx({ getCellData }));

    const result = await resolver.resolveChartDataForRendering(
      chart({
        dataRange: undefined,
        series: [
          {
            name: 'Hierarchical',
            values: 'Missing!C1:D1',
            valueSourceKind: 'ref',
            valueCache: {
              pointCount: 2,
              points: [
                { idx: 0, value: '10' },
                { idx: 1, value: '20' },
              ],
            },
            categories: 'Missing!A1:B2',
            categorySourceKind: 'ref',
            categoryLevels: {
              pointCount: 2,
              levels: [
                {
                  level: 0,
                  pointCount: 2,
                  points: [
                    { idx: 0, value: 'North' },
                    { idx: 1, value: 'South' },
                  ],
                },
                {
                  level: 1,
                  pointCount: 2,
                  points: [
                    { idx: 0, value: 'Q1' },
                    { idx: 1, value: 'Q1' },
                  ],
                },
              ],
            },
          },
        ],
      }),
      resolvedRanges({
        dataRange: null,
        seriesReferences: [{ index: 0, values: null, categories: null }],
      }),
      CHART_ID,
    );

    expect('code' in result).toBe(false);
    if ('code' in result) return;
    expect(getCellData).not.toHaveBeenCalled();
    expect(result.config.series?.[0]).toMatchObject({
      valueSourceKind: 'cacheFallback',
      categorySourceKind: 'cacheFallback',
    });
    expect(result.data.categories).toEqual(['North / Q1', 'South / Q1']);
    expect(result.data.categoryLevels).toEqual([
      { level: 0, labels: ['North', 'South'] },
      { level: 1, labels: ['Q1', 'Q1'] },
    ]);
    expect(result.data.series[0].data.map((point) => point.x)).toEqual([
      'North / Q1',
      'South / Q1',
    ]);
    expect(result.data.series[0].data.map((point) => point.y)).toEqual([10, 20]);
  });

  it('keeps hidden bubble-size source cells from falling back to imported caches', async () => {
    const getCellData = jest.fn(async (sheetId: SheetId, row: number, col: number) => {
      if (sheetId === SHEET_SIZES) {
        return { value: { type: 'number', value: [100, 200, 300][col] ?? null } };
      }
      const raw = row === 0 ? [10, 20, 30][col] : row === 1 ? [1, 2, 3][col] : null;
      return { value: { type: 'number', value: raw } };
    });
    const resolver = new ChartDataResolver(
      ctx({
        getCellData,
        getHiddenRows: jest.fn(async () => []),
        getHiddenColumns: jest.fn(async (sheetId: SheetId) => (sheetId === SHEET_SIZES ? [1] : [])),
      }),
    );

    const result = await resolver.resolveChartDataForRendering(
      chart({
        chartType: 'bubble',
        dataRange: undefined,
        plotVisibleOnly: true,
        series: [
          {
            name: 'Bubbles',
            values: 'A1:C1',
            categories: 'A2:C2',
            bubbleSize: 'Sizes!A1:C1',
            bubbleSizeCache: {
              pointCount: 3,
              points: [{ idx: 1, value: '999' }],
            },
          },
        ],
      }),
      resolvedRanges({
        dataRange: null,
        seriesReferences: [
          {
            index: 0,
            values: {
              kind: 'seriesValues',
              source: 'a1',
              ref: 'A1:C1',
              range: range(SHEET_A, 0, 0, 0, 2),
            },
            categories: {
              kind: 'seriesCategories',
              source: 'a1',
              ref: 'A2:C2',
              range: range(SHEET_A, 1, 0, 1, 2),
            },
            bubbleSizes: {
              kind: 'seriesBubbleSizes',
              source: 'a1',
              ref: 'Sizes!A1:C1',
              range: range(SHEET_SIZES, 0, 0, 0, 2),
            },
          },
        ],
      }),
      CHART_ID,
    );

    expect('code' in result).toBe(false);
    if ('code' in result) return;
    const points = result.data.series[0].data;
    expect(points.map((point) => point.valueState)).toEqual([undefined, 'hidden', undefined]);
    expect(points.map((point) => point.size)).toEqual([100, undefined, 300]);
    expect(chartDataToRows(result.data).map((row) => row.size)).toEqual([100, 300]);
  });

  it('keeps hidden category source cells from falling back to imported caches', async () => {
    const getCellData = jest.fn(async (_sheetId: SheetId, row: number, col: number) => {
      const raw = row === 0 ? [10, 20, 30][col] : ['Live A', 'Live B', 'Live C'][col];
      return {
        value:
          typeof raw === 'number' ? { type: 'number', value: raw } : { type: 'text', value: raw },
      };
    });
    const resolver = new ChartDataResolver(
      ctx({
        getCellData,
        getHiddenRows: jest.fn(async () => []),
        getHiddenColumns: jest.fn(async () => [1]),
      }),
    );

    const result = await resolver.resolveChartDataForRendering(
      chart({
        dataRange: undefined,
        plotVisibleOnly: true,
        series: [
          {
            name: 'Revenue',
            values: 'A1:C1',
            categories: 'A2:C2',
            categoryCache: {
              pointCount: 3,
              points: [{ idx: 1, value: 'Stale B' }],
            },
          },
        ],
      }),
      resolvedRanges({
        dataRange: null,
        seriesReferences: [
          {
            index: 0,
            values: {
              kind: 'seriesValues',
              source: 'a1',
              ref: 'A1:C1',
              range: range(SHEET_A, 0, 0, 0, 2),
            },
            categories: {
              kind: 'seriesCategories',
              source: 'a1',
              ref: 'A2:C2',
              range: range(SHEET_A, 1, 0, 1, 2),
            },
          },
        ],
      }),
      CHART_ID,
    );

    expect('code' in result).toBe(false);
    if ('code' in result) return;
    const points = result.data.series[0].data;
    expect(points.map((point) => point.valueState)).toEqual([undefined, 'hidden', undefined]);
    expect(points.map((point) => point.x)).toEqual(['Live A', 2, 'Live C']);
    expect(result.data.categories).toEqual(['Live A', 2, 'Live C']);
    expect(result.data.categories).not.toContain('Stale B');
    expect(chartDataToRows(result.data).map((row) => row.category)).toEqual(['Live A', 'Live C']);
  });

  it('caches workbook theme palette loads until the resolver cache is cleared', async () => {
    const getWorkbookTheme = jest.fn(async () => ({
      colors: [{ name: 'accent1', color: '123456' }],
    }));
    const getCellData = jest.fn(async () => ({ value: { type: 'number', value: 1 } }));

    const resolver = new ChartDataResolver(
      ctx({
        getChart: jest.fn(async () => chart()),
        getCellData,
        getWorkbookTheme,
      }),
    );

    await resolver.resolveForRendering(SHEET_A, CHART_ID);
    await resolver.resolveForRendering(SHEET_A, CHART_ID);
    resolver.clearWorkbookThemeColorCache();
    await resolver.resolveForRendering(SHEET_A, CHART_ID);

    expect(getWorkbookTheme).toHaveBeenCalledTimes(2);
  });

  it('resolves source-linked value axis formats from live series source cells', async () => {
    const getCellData = jest.fn(async (_sheetId, row: number, col: number) => ({
      value: { type: 'number', value: row === 0 ? [1200, 1300, 1400][col] : [0.1, 0.2, 0.3][col] },
    }));
    const getResolvedFormat = jest.fn(async (_sheetId, row: number) => ({
      numberFormat: row === 0 ? '$#,##0' : '0.0%',
    }));
    const resolver = new ChartDataResolver(ctx({ getCellData, getResolvedFormat }));

    const result = await resolver.resolveChartDataForRendering(
      chart({
        dataRange: undefined,
        axis: {
          valueAxis: { visible: true, linkNumberFormat: true },
          secondaryValueAxis: { visible: true, linkNumberFormat: true },
        },
        series: [
          { name: 'Revenue', values: 'A1:C1' },
          { name: 'Margin', values: 'A2:C2', yAxisIndex: 1 },
        ],
      }),
      resolvedRanges({
        dataRange: null,
        seriesReferences: [
          {
            index: 0,
            values: {
              kind: 'seriesValues',
              source: 'a1',
              ref: 'A1:C1',
              range: range(SHEET_A, 0, 0, 0, 2),
            },
            categories: null,
          },
          {
            index: 1,
            values: {
              kind: 'seriesValues',
              source: 'a1',
              ref: 'A2:C2',
              range: range(SHEET_A, 1, 0, 1, 2),
            },
            categories: null,
          },
        ],
      }),
      CHART_ID,
    );

    expect('code' in result).toBe(false);
    if ('code' in result) return;
    expect(result.config.axis?.valueAxis?.numberFormat).toBe('$#,##0');
    expect(result.config.axis?.yAxis?.numberFormat).toBe('$#,##0');
    expect(result.config.axis?.secondaryValueAxis?.numberFormat).toBe('0.0%');
    expect(result.config.axis?.secondaryYAxis?.numberFormat).toBe('0.0%');
    expect(getResolvedFormat).toHaveBeenCalledWith(SHEET_A, 0, 0);
    expect(getResolvedFormat).toHaveBeenCalledWith(SHEET_A, 1, 0);
  });
});
