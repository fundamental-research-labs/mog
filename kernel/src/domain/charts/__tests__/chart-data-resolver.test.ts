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
      { category: 'FY24', x: 'FY24', y: 10, value: 10, series: 'Revenue' },
      { category: 'FY24', x: 'FY24', y: 4, value: 4, series: 'Cost' },
      { category: 'FY25', x: 'FY25', y: 20, value: 20, series: 'Revenue' },
      { category: 'FY25', x: 'FY25', y: 8, value: 8, series: 'Cost' },
    ]);
  });

  it('maps explicit series sheet-name aliases to resolved sheet ids', () => {
    const aliases = seriesSheetAliases(
      resolvedRanges({
        seriesReferences: [
          {
            index: 0,
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
    await expect(new ChartDataResolver(ctx()).resolveChartData(SHEET_A, CHART_ID)).resolves.toEqual({
      success: false,
      error: {
        code: 'CHART_NOT_FOUND',
        message: 'Chart not found',
        chartId: CHART_ID,
      },
    });
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
});
