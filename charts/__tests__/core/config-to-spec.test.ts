/**
 * Tests for the comprehensive configToSpec bridge.
 *
 * Verifies that ALL ChartConfig fields are mapped losslessly to ChartSpec.
 */
import {
  buildComboLayers,
  buildConfigSpec,
  buildDataLabelLayer,
  buildEncoding,
  buildMark,
  buildStockLayers,
  buildTitle,
  buildTrendlineTransform,
  buildWaterfallLayers,
  buildWaterfallTransforms,
  chartDataToRows,
  configToSpec,
  hasSecondaryYAxis,
  resolveStackMode,
  resolveSubTypeMarkProps,
} from '../../src/core/config-to-spec';
import { collectMarks } from '../../src/core/chart-engine';
import {
  BLANK_VALUE_FIELD,
  DATA_LABEL_BASELINE_FIELD,
  DATA_LABEL_DY_FIELD,
  DATA_LABEL_TEXT_FIELD,
  DATA_LABEL_X_FIELD,
  DATA_LABEL_Y_FIELD,
  LINE_SEGMENT_FIELD,
  SERIES_INDEX_FIELD,
  SERIES_FILL_FIELD,
  SERIES_STROKE_FIELD,
  SERIES_STROKE_WIDTH_FIELD,
  PIE_COLOR_KEY_FIELD,
  PIE_POINT_KEY_FIELD,
  STOCK_CLOSE_FIELD,
  STOCK_DIRECTION_FIELD,
  STOCK_HIGH_LOW_MIN_FIELD,
  STOCK_HIGH_FIELD,
  STOCK_LOW_FIELD,
  STOCK_OPEN_FIELD,
  STOCK_VOLUME_FIELD,
} from '../../src/core/config-to-spec/fields';
import { formatTickValue } from '../../src/grammar/axis-generator';
import { compile } from '../../src/grammar/compiler';
import type { ArcMark, PathMark, SymbolMark, TextMark } from '../../src/primitives/types';
import type { EncodingSpec, LayerSpec, MarkSpec } from '../../src/grammar/spec';
import type { ChartConfig, ChartData, ChartType, StoredChartConfig } from '../../src/types';

// =============================================================================
// Test Helpers
// =============================================================================

function makeConfig(overrides: Partial<StoredChartConfig> = {}): StoredChartConfig {
  return {
    id: 'test-chart',
    type: 'bar',
    anchorRow: 0,
    anchorCol: 0,
    width: 480,
    height: 225,
    dataRange: 'A1:D10',
    ...overrides,
  };
}

function makeData(seriesCount = 1): ChartData {
  const series = [];
  for (let i = 0; i < seriesCount; i++) {
    series.push({
      name: `Series ${i + 1}`,
      data: [
        { x: 'A', y: 10 * (i + 1), name: 'A' },
        { x: 'B', y: 20 * (i + 1), name: 'B' },
        { x: 'C', y: 30 * (i + 1), name: 'C' },
      ],
    });
  }
  return {
    categories: ['A', 'B', 'C'],
    series,
  };
}

const SINGLE_SERIES_DATA = makeData(1);
const MULTI_SERIES_DATA = makeData(2);
const STOCK_SERIES_DATA: ChartData = {
  categories: ['Day1', 'Day2'],
  series: [
    {
      name: 'Stock',
      data: [
        { x: 'Day1', y: 100, open: 95, high: 110, low: 90, close: 105 },
        { x: 'Day2', y: 102, open: 105, high: 115, low: 98, close: 108 },
      ],
    },
  ],
};

function expectRowContaining(
  row: Record<string, unknown>,
  expected: Record<string, unknown>,
): void {
  expect(row).toEqual(expect.objectContaining(expected));
}

function expectRowsContaining(
  rows: Array<Record<string, unknown>>,
  expected: Array<Record<string, unknown>>,
): void {
  expect(rows).toEqual(expected.map((row) => expect.objectContaining(row)));
}

// =============================================================================
// chartDataToRows
// =============================================================================

describe('chartDataToRows', () => {
  it('should flatten single series data into rows', () => {
    const rows = chartDataToRows(SINGLE_SERIES_DATA);
    expect(rows).toHaveLength(3);
    expectRowContaining(rows[0], { category: 'A', value: 10, series: 'Series 1' });
    expectRowContaining(rows[1], { category: 'B', value: 20, series: 'Series 1' });
    expectRowContaining(rows[2], { category: 'C', value: 30, series: 'Series 1' });
  });

  it('should flatten multi-series data interleaved by category', () => {
    const rows = chartDataToRows(MULTI_SERIES_DATA);
    expect(rows).toHaveLength(6);
    // Category A: Series 1, then Series 2
    expectRowContaining(rows[0], { category: 'A', value: 10, series: 'Series 1' });
    expectRowContaining(rows[1], { category: 'A', value: 20, series: 'Series 2' });
    // Category B
    expectRowContaining(rows[2], { category: 'B', value: 20, series: 'Series 1' });
    expectRowContaining(rows[3], { category: 'B', value: 40, series: 'Series 2' });
  });

  it('adds imported waterfall running-total metadata', () => {
    const rows = chartDataToRows(SINGLE_SERIES_DATA, {
      ...makeConfig({ type: 'waterfall' }),
      waterfall: { subtotalIndices: [2], showConnectorLines: true },
    });

    expect(rows.map((row) => row._waterfallType)).toEqual(['increase', 'increase', 'total']);
    expect(rows.map((row) => row._waterfallRunningTotal)).toEqual([10, 30, 30]);
    expect(rows.map((row) => row._waterfallEnd)).toEqual([10, 30, 30]);
  });

  it('should handle empty data', () => {
    const rows = chartDataToRows({ categories: [], series: [] });
    expect(rows).toEqual([]);
  });

  it('should handle sparse series data (missing data points)', () => {
    const data: ChartData = {
      categories: ['A', 'B', 'C'],
      series: [
        {
          name: 'Sparse',
          data: [
            { x: 'A', y: 10, name: 'A' },
            // B and C missing
          ],
        },
      ],
    };
    const rows = chartDataToRows(data);
    expect(rows).toHaveLength(1);
    expectRowContaining(rows[0], { category: 'A', value: 10, series: 'Sparse' });
  });

  it('preserves explicit gap/span blanks as domain rows without renderable values', () => {
    const data: ChartData = {
      categories: ['A', 'B', 'C'],
      series: [
        {
          name: 'Series 1',
          data: [
            { x: 'A', y: 1 },
            { x: 'B', y: 0, valueState: 'blank' },
            { x: 'C', y: 3 },
          ],
        },
      ],
    };

    const gapRows = chartDataToRows(data, makeConfig({ type: 'line', displayBlanksAs: 'gap' }));
    expect(gapRows.map((row) => row.category)).toEqual(['A', 'B', 'C']);
    expect(gapRows.map((row) => row.value)).toEqual([1, undefined, 3]);
    expect(gapRows[1][BLANK_VALUE_FIELD]).toBe(true);
    expect(gapRows.map((row) => row[LINE_SEGMENT_FIELD])).toEqual([0, undefined, 1]);

    const spanRows = chartDataToRows(data, makeConfig({ type: 'line', displayBlanksAs: 'span' }));
    expect(spanRows.map((row) => row.category)).toEqual(['A', 'B', 'C']);
    expect(spanRows.map((row) => row.value)).toEqual([1, undefined, 3]);
    expect(spanRows[1][BLANK_VALUE_FIELD]).toBe(true);
    expect(spanRows.every((row) => row[LINE_SEGMENT_FIELD] === undefined)).toBe(true);

    const zeroRows = chartDataToRows(data, makeConfig({ type: 'line', displayBlanksAs: 'zero' }));
    expect(zeroRows.map((row) => row.category)).toEqual(['A', 'B', 'C']);
    expect(zeroRows.map((row) => row.value)).toEqual([1, 0, 3]);
    expect(zeroRows.some((row) => row[BLANK_VALUE_FIELD] === true)).toBe(false);
  });

  it('treats sparse cache holes as gap/span blanks when the mode preserves blank domains', () => {
    const data: ChartData = {
      categories: ['A', 'B', 'C'],
      series: [
        {
          name: 'Sparse',
          data: [{ x: 'A', y: 10 }],
        },
      ],
    };

    const rows = chartDataToRows(data, makeConfig({ type: 'line', displayBlanksAs: 'gap' }));

    expect(rows.map((row) => row.category)).toEqual(['A', 'B', 'C']);
    expect(rows.map((row) => row.value)).toEqual([10, undefined, undefined]);
    expect(rows.slice(1).every((row) => row[BLANK_VALUE_FIELD] === true)).toBe(true);
  });

  it('should preserve imported per-category format codes separately from category identity', () => {
    const rows = chartDataToRows({
      categories: [26, 27],
      categoryFormatCodes: ['"FY3/"0"E"', '"FY3/"0"E"'],
      series: [
        {
          name: 'Forecast',
          data: [
            { x: 26, y: 10 },
            { x: 27, y: 20 },
          ],
        },
      ],
    });

    expectRowsContaining(rows, [
      { category: '26', categoryFormatCode: '"FY3/"0"E"', value: 10, series: 'Forecast' },
      { category: '27', categoryFormatCode: '"FY3/"0"E"', value: 20, series: 'Forecast' },
    ]);
  });

  it('should propagate OHLC fields for stock chart rows', () => {
    const rows = chartDataToRows(
      {
        categories: ['Day1', 'Day2'],
        series: [
          {
            name: 'Stock',
            data: [
              { x: 'Day1', y: 100, open: 95, high: 110, low: 90, close: 105 },
              { x: 'Day2', y: 102, open: 105, high: 115, low: 98, close: 100 },
            ],
          },
        ],
      },
      makeConfig({ type: 'stock', subType: 'ohlc' }),
    );

    expectRowsContaining(rows, [
      {
        category: 'Day1',
        value: 100,
        series: 'Stock',
        open: 95,
        high: 110,
        low: 90,
        close: 105,
        [STOCK_DIRECTION_FIELD]: 'up',
      },
      {
        category: 'Day2',
        value: 102,
        series: 'Stock',
        open: 105,
        high: 115,
        low: 98,
        close: 100,
        [STOCK_DIRECTION_FIELD]: 'down',
      },
    ]);
  });

  it('should preserve numeric scatter x values separately from category labels', () => {
    const rows = chartDataToRows(
      {
        categories: ['left', 'right', 'fallback'],
        series: [
          {
            name: 'Points',
            data: [
              { x: 2.5, y: 10 },
              { x: 7.75, y: 20 },
              { x: 'not numeric', y: 30 },
            ],
          },
        ],
      },
      makeConfig({ type: 'scatter' }),
    );

    expectRowsContaining(rows, [
      { category: 'left', x: 2.5, value: 10, series: 'Points' },
      { category: 'right', x: 7.75, value: 20, series: 'Points' },
    ]);
  });

  it('should propagate bubble sizes into row size fields', () => {
    const rows = chartDataToRows(
      {
        categories: [1, 2, 3],
        series: [
          {
            name: 'Bubbles',
            data: [
              { x: 1, y: 10, size: 4 },
              { x: 2, y: 20, size: 12 },
              { x: 3, y: 30 },
            ],
          },
        ],
      },
      makeConfig({ type: 'bubble' }),
    );

    expectRowsContaining(rows, [
      { category: '1', x: 1, value: 10, series: 'Bubbles', size: 4 },
      { category: '2', x: 2, value: 20, series: 'Bubbles', size: 12 },
    ]);
  });
});

describe('displayBlanksAs renderability', () => {
  const data: ChartData = {
    categories: ['A', 'B', 'C'],
    series: [
      {
        name: 'Series 1',
        data: [
          { x: 'A', y: 1 },
          { x: 'B', y: 0, valueState: 'blank' },
          { x: 'C', y: 3 },
        ],
      },
    ],
  };

  function dataPaths(config: StoredChartConfig): PathMark[] {
    const result = compile(configToSpec(config, data), undefined, {
      skipAxes: true,
      skipLegend: true,
      skipTitle: true,
    });
    return result.marks.filter((mark): mark is PathMark => mark.type === 'path');
  }

  it('splits line paths for gap blanks while preserving the blank category domain', () => {
    const spec = configToSpec(makeConfig({ type: 'line', displayBlanksAs: 'gap' }), data);
    const result = compile(spec, undefined, {
      skipAxes: true,
      skipLegend: true,
      skipTitle: true,
    });

    expect(result.scales.x?.domain?.()).toEqual(['A', 'B', 'C']);
    expect(result.marks.filter((mark): mark is PathMark => mark.type === 'path')).toHaveLength(2);
  });

  it('spans line paths across blank rows without drawing a blank marker', () => {
    const paths = dataPaths(makeConfig({ type: 'line', displayBlanksAs: 'span' }));

    expect(paths).toHaveLength(1);
    const pathDatum = paths[0].datum as Array<Record<string, unknown>>;
    expect(pathDatum).toHaveLength(2);
    expect(paths[0].path.split('L')).toHaveLength(2);
  });

  it('keeps line marker layers off gap/span blank rows', () => {
    const result = compile(
      configToSpec(makeConfig({ type: 'lineMarkers', displayBlanksAs: 'span' }), data),
      undefined,
      {
        skipAxes: true,
        skipLegend: true,
        skipTitle: true,
      },
    );
    const symbols = result.marks.filter((mark): mark is SymbolMark => mark.type === 'symbol');

    expect(symbols).toHaveLength(2);
    expect(symbols.map((mark) => (mark.datum as Record<string, unknown>).category)).toEqual([
      'A',
      'C',
    ]);
  });

  it('splits scatter showLines paths on gap blanks while span connects remaining points', () => {
    const scatterData: ChartData = {
      categories: ['A', 'B', 'C'],
      series: [
        {
          name: 'Series 1',
          data: [
            { x: 1, y: 1 },
            { x: 2, y: 0, valueState: 'blank' },
            { x: 10, y: 3 },
          ],
        },
      ],
    };
    const gapResult = compile(
      configToSpec(
        makeConfig({
          type: 'scatter',
          showLines: true,
          displayBlanksAs: 'gap',
        }),
        scatterData,
      ),
      undefined,
      {
        skipAxes: true,
        skipLegend: true,
        skipTitle: true,
      },
    );
    const spanResult = compile(
      configToSpec(
        makeConfig({
          type: 'scatter',
          showLines: true,
          displayBlanksAs: 'span',
        }),
        scatterData,
      ),
      undefined,
      {
        skipAxes: true,
        skipLegend: true,
        skipTitle: true,
      },
    );

    expect(gapResult.marks.filter((mark): mark is PathMark => mark.type === 'path')).toHaveLength(
      2,
    );
    expect(spanResult.marks.filter((mark): mark is PathMark => mark.type === 'path')).toHaveLength(
      1,
    );
  });
});

// =============================================================================
// Mark Type Mapping
// =============================================================================

describe('buildMark - mark type mapping', () => {
  const simpleMarkTypes: [ChartType, string | MarkSpec][] = [
    [
      'bar',
      {
        type: 'bar',
        fillField: SERIES_FILL_FIELD,
        strokeField: SERIES_STROKE_FIELD,
        strokeWidthField: SERIES_STROKE_WIDTH_FIELD,
      },
    ],
    [
      'column',
      {
        type: 'bar',
        fillField: SERIES_FILL_FIELD,
        strokeField: SERIES_STROKE_FIELD,
        strokeWidthField: SERIES_STROKE_WIDTH_FIELD,
      },
    ],
    ['line', 'line'],
    ['area', 'area'],
    ['scatter', { type: 'point', skipInvalidPositions: true }],
    ['bubble', { type: 'point', skipInvalidPositions: true }],
    [
      'waterfall',
      {
        type: 'bar',
        fillField: SERIES_FILL_FIELD,
        strokeField: SERIES_STROKE_FIELD,
        strokeWidthField: SERIES_STROKE_WIDTH_FIELD,
      },
    ],
  ];

  it.each(simpleMarkTypes)('should map %s to mark type %s', (chartType, expectedMark) => {
    const config = makeConfig({ type: chartType });
    const mark = buildMark(config);
    expect(mark).toEqual(expectedMark);
  });

  it('should map funnel to bar mark with cornerRadius', () => {
    const config = makeConfig({ type: 'funnel' });
    const mark = buildMark(config) as MarkSpec;
    expect(mark.type).toBe('bar');
    expect(mark.cornerRadius).toBe(2);
  });

  it('maps imported histogram bin options to the histogram mark', () => {
    const mark = buildMark(
      makeConfig({
        type: 'histogram',
        histogram: {
          binCount: 8,
          binWidth: 2,
          underflowBinValue: 1,
          overflowBinValue: 20,
        },
      }),
    ) as MarkSpec;

    expect(mark).toMatchObject({
      type: 'histogram',
      binCount: 8,
      binWidth: 2,
      underflowBinValue: 1,
      overflowBinValue: 20,
    });
  });

  it('maps imported boxplot options to the boxplot mark', () => {
    const mark = buildMark(
      makeConfig({
        type: 'boxplot',
        boxplot: {
          showOutlierPoints: false,
          showMeanMarkers: true,
          showMeanLine: true,
          quartileMethod: 'exclusive',
        },
      }),
    ) as MarkSpec;

    expect(mark).toMatchObject({
      type: 'boxplot',
      showOutlierPoints: false,
      showMeanMarkers: true,
      showMeanLine: true,
      quartileMethod: 'exclusive',
    });
  });

  it('should map pie to arc mark', () => {
    const config = makeConfig({ type: 'pie' });
    const mark = buildMark(config) as MarkSpec;
    expect(mark.type).toBe('arc');
  });

  it('should map doughnut to arc mark with innerRadius', () => {
    const config = makeConfig({ type: 'doughnut' });
    const mark = buildMark(config) as MarkSpec;
    expect(mark.type).toBe('arc');
    expect(mark.innerRadius).toBe(0.5);
  });

  it('should map combo to bar as default base mark', () => {
    // For combo, the base mark is bar; layers are built separately
    const config = makeConfig({ type: 'combo' });
    const mark = buildMark(config);
    expect(mark).toEqual({
      type: 'bar',
      fillField: SERIES_FILL_FIELD,
      strokeField: SERIES_STROKE_FIELD,
      strokeWidthField: SERIES_STROKE_WIDTH_FIELD,
    });
  });

  it('should map stock to stockGlyph as default base mark', () => {
    const config = makeConfig({ type: 'stock' });
    const mark = buildMark(config);
    expect(mark).toBe('stockGlyph');
  });
});

// =============================================================================
// Bar/Column Chart Encoding
// =============================================================================

describe('buildEncoding - bar/column chart encoding', () => {
  it('should have x=quantitative, y=nominal for bar (horizontal bar) charts', () => {
    const config = makeConfig({ type: 'bar' });
    const encoding = buildEncoding(config, SINGLE_SERIES_DATA);

    expect(encoding.x).toBeDefined();
    expect(encoding.x!.field).toBe('value');
    expect(encoding.x!.type).toBe('quantitative');

    expect(encoding.y).toBeDefined();
    expect(encoding.y!.field).toBe('category');
    expect(encoding.y!.type).toBe('nominal');
  });

  it('should have x=nominal, y=quantitative for column (vertical bar) charts', () => {
    const config = makeConfig({ type: 'column' });
    const encoding = buildEncoding(config, SINGLE_SERIES_DATA);

    expect(encoding.x).toBeDefined();
    expect(encoding.x!.field).toBe('category');
    expect(encoding.x!.type).toBe('nominal');

    expect(encoding.y).toBeDefined();
    expect(encoding.y!.field).toBe('value');
    expect(encoding.y!.type).toBe('quantitative');
  });

  it('uses cumulative stacked totals for vertical column value domain', () => {
    const config = makeConfig({ type: 'column', subType: 'stacked' });
    const encoding = buildEncoding(config, MULTI_SERIES_DATA);

    expect(encoding.y?.scale?.domain).toEqual([0, 100]);
    expect(encoding.y?.scale?.nice).toBe(false);
    expect(encoding.y?.axis?.tickCount).toBe(6);
  });

  it('uses cumulative stacked totals for horizontal bar value domain', () => {
    const config = makeConfig({ type: 'bar', subType: 'stacked' });
    const encoding = buildEncoding(config, MULTI_SERIES_DATA);

    expect(encoding.x?.scale?.domain).toEqual([0, 100]);
    expect(encoding.x?.scale?.nice).toBe(false);
    expect(encoding.x?.axis?.tickCount).toBe(6);
  });

  it('adds Excel-like headroom when stacked totals exactly hit a major value-axis tick', () => {
    const config = makeConfig({ type: 'column', subType: 'stacked' });
    const data: ChartData = {
      categories: ['A'],
      series: [
        { name: 'Series 1', data: [{ x: 'A', y: 55 }] },
        { name: 'Series 2', data: [{ x: 'A', y: 45 }] },
      ],
    };

    const encoding = buildEncoding(config, data);

    expect(encoding.y?.scale?.domain).toEqual([0, 120]);
    expect(encoding.y?.scale?.nice).toBe(false);
    expect(encoding.y?.axis?.tickCount).toBe(6);
  });

  it('adds Excel-like headroom for negative-only stacked value domains', () => {
    const config = makeConfig({ type: 'column', subType: 'stacked' });
    const data: ChartData = {
      categories: ['A'],
      series: [
        { name: 'Series 1', data: [{ x: 'A', y: -55 }] },
        { name: 'Series 2', data: [{ x: 'A', y: -45 }] },
      ],
    };

    const encoding = buildEncoding(config, data);

    expect(encoding.y?.scale?.domain).toEqual([-120, 0]);
    expect(encoding.y?.scale?.nice).toBe(false);
    expect(encoding.y?.axis?.tickCount).toBe(6);
  });

  it('combines explicit imported value-axis max with stacked negative extent', () => {
    const config = makeConfig({
      type: 'column',
      subType: 'stacked',
      axis: { yAxis: { type: 'value', max: 100 } },
    });
    const data = {
      categories: ['A'],
      series: [
        { name: 'Positive', data: [{ x: 'A', y: 40 }] },
        { name: 'Negative', data: [{ x: 'A', y: -12 }] },
      ],
    };

    const encoding = buildEncoding(config, data);

    expect(encoding.y?.scale?.domain).toEqual([-12, 100]);
  });

  it('uses Excel-like major ticks for auto diverging stacked value domains', () => {
    const config = makeConfig({ type: 'column', subType: 'stacked' });
    const data = {
      categories: ['A', 'B'],
      series: [
        {
          name: 'Positive',
          data: [
            { x: 'A', y: 40 },
            { x: 'B', y: 88 },
          ],
        },
        {
          name: 'Negative',
          data: [
            { x: 'A', y: -12 },
            { x: 'B', y: -5 },
          ],
        },
      ],
    };

    const encoding = buildEncoding(config, data);

    expect(encoding.y?.scale).toEqual(expect.objectContaining({ domain: [-12, 88], nice: 6 }));
    expect(encoding.y?.axis).toEqual(expect.objectContaining({ tickCount: 6 }));
  });

  it('maps imported per-category format codes onto the category axis', () => {
    const config = makeConfig({ type: 'column' });
    const encoding = buildEncoding(config, {
      categories: [25, 26],
      categoryFormatCodes: ['"FY3/"0', '"FY3/"0"E"'],
      series: [
        {
          name: 'Series 1',
          data: [
            { x: 25, y: 10 },
            { x: 26, y: 20 },
          ],
        },
      ],
    });

    expect(encoding.x?.axis?.labelFormatByValue).toEqual({
      '25': '"FY3/"0',
      '26': '"FY3/"0"E"',
    });
  });

  it('formats quoted literal prefix and suffix axis labels', () => {
    expect(formatTickValue(26, '"FY3/"0"E"')).toBe('FY3/26E');
  });
});

// =============================================================================
// Encoding for Various Chart Types
// =============================================================================

describe('buildEncoding - chart type encodings', () => {
  it('should produce x=nominal, y=quantitative for line charts', () => {
    const config = makeConfig({ type: 'line' });
    const encoding = buildEncoding(config, SINGLE_SERIES_DATA);
    expect(encoding.x!.type).toBe('nominal');
    expect(encoding.y!.type).toBe('quantitative');
  });

  it('should produce x=nominal, y=quantitative for area charts', () => {
    const config = makeConfig({ type: 'area' });
    const encoding = buildEncoding(config, SINGLE_SERIES_DATA);
    expect(encoding.x!.type).toBe('nominal');
    expect(encoding.y!.type).toBe('quantitative');
  });

  it('should produce quantitative x/y for scatter charts', () => {
    const config = makeConfig({ type: 'scatter' });
    const encoding = buildEncoding(config, SINGLE_SERIES_DATA);
    expect(encoding.x!.field).toBe('x');
    expect(encoding.x!.type).toBe('quantitative');
    expect(encoding.y!.type).toBe('quantitative');
  });

  it('should produce quantitative size encoding for bubble charts', () => {
    const config = makeConfig({ type: 'bubble' });
    const encoding = buildEncoding(config, SINGLE_SERIES_DATA);
    expect(encoding.x).toMatchObject({ field: 'x', type: 'quantitative' });
    expect(encoding.y).toMatchObject({ field: 'value', type: 'quantitative' });
    expect(encoding.size).toMatchObject({ field: 'size', type: 'quantitative' });
  });

  it('should produce theta/color for pie charts (no x/y)', () => {
    const config = makeConfig({ type: 'pie' });
    const encoding = buildEncoding(config, SINGLE_SERIES_DATA);

    expect(encoding.x).toBeUndefined();
    expect(encoding.y).toBeUndefined();
    expect(encoding.theta).toBeDefined();
    expect(encoding.theta!.field).toBe('value');
    expect(encoding.theta!.type).toBe('quantitative');
    expect(encoding.color).toBeDefined();
    expect(encoding.color!.field).toBe(PIE_COLOR_KEY_FIELD);
    expect(encoding.color!.type).toBe('nominal');
  });

  it('should produce theta/color for doughnut charts', () => {
    const config = makeConfig({ type: 'doughnut' });
    const encoding = buildEncoding(config, SINGLE_SERIES_DATA);

    expect(encoding.x).toBeUndefined();
    expect(encoding.y).toBeUndefined();
    expect(encoding.theta).toBeDefined();
    expect(encoding.color).toBeDefined();
  });
});

// =============================================================================
// Multi-Series Color Encoding
// =============================================================================

describe('buildEncoding - multi-series', () => {
  it('should add color encoding with field=series for multi-series data', () => {
    const config = makeConfig({ type: 'bar' });
    const encoding = buildEncoding(config, MULTI_SERIES_DATA);

    expect(encoding.color).toBeDefined();
    expect(encoding.color!.field).toBe('series');
    expect(encoding.color!.type).toBe('nominal');
  });

  it('should NOT add color encoding for single-series data', () => {
    const config = makeConfig({ type: 'bar' });
    const encoding = buildEncoding(config, SINGLE_SERIES_DATA);

    expect(encoding.color).toBeUndefined();
  });

  it('should always add color encoding for pie charts (maps to stable point keys)', () => {
    const config = makeConfig({ type: 'pie' });
    const encoding = buildEncoding(config, SINGLE_SERIES_DATA);

    expect(encoding.color).toBeDefined();
    expect(encoding.color!.field).toBe(PIE_COLOR_KEY_FIELD);
  });

  it('resolves imported theme luminance transforms with Excel HSL luminance math', () => {
    const data = makeData(2);
    const config = makeConfig({
      type: 'column',
      series: [
        {
          name: 'Series 1',
          idx: 6,
          format: { fill: { type: 'solid', color: { theme: 'accent1', tintShade: -0.4 } } },
        },
        {
          name: 'Series 2',
          idx: 7,
          format: { fill: { type: 'solid', color: { theme: 'accent2', tintShade: -0.4 } } },
        },
      ],
    });

    const encoding = buildEncoding(config, data);

    expect(encoding.color?.scale?.range).toEqual(['#264478', '#9E480E']);
  });

  it('accepts snake-case tint_shade from Rust chart-import wire data', () => {
    const data = makeData(1);
    const config = makeConfig({
      type: 'pie',
      series: [
        {
          name: 'Series 1',
          idx: 6,
          format: {
            fill: {
              type: 'solid',
              color: { theme: 'accent1', tint_shade: -0.4 } as unknown as {
                theme: string;
                tintShade?: number;
              },
            },
          },
        },
      ],
    });

    const encoding = buildEncoding(config, data);

    expect(encoding.color?.scale?.range).toEqual(['#264478']);
  });

  it('uses Excel repeat colors when imported repeat series lack luminance transforms', () => {
    const data = makeData(1);
    const config = makeConfig({
      type: 'pie',
      series: [
        {
          name: 'Series 1',
          idx: 6,
          format: { fill: { type: 'solid', color: { theme: 'accent1' } } },
        },
      ],
    });

    const encoding = buildEncoding(config, data);

    expect(encoding.color?.scale?.range).toEqual(['#264478']);
  });
});

// =============================================================================
// SubType Mapping
// =============================================================================

describe('resolveStackMode', () => {
  it('should return undefined for no subType', () => {
    expect(resolveStackMode(makeConfig())).toBeUndefined();
  });

  it('should return undefined for clustered subType', () => {
    expect(resolveStackMode(makeConfig({ subType: 'clustered' }))).toBeUndefined();
  });

  it('should return "zero" for stacked subType', () => {
    expect(resolveStackMode(makeConfig({ subType: 'stacked' }))).toBe('zero');
  });

  it('should return "normalize" for percentStacked subType', () => {
    expect(resolveStackMode(makeConfig({ subType: 'percentStacked' }))).toBe('normalize');
  });

  it('should return undefined for standard subType', () => {
    expect(resolveStackMode(makeConfig({ type: 'area', subType: 'standard' }))).toBeUndefined();
  });
});

describe('resolveSubTypeMarkProps', () => {
  it('should return undefined for no subType', () => {
    expect(resolveSubTypeMarkProps(makeConfig())).toBeUndefined();
  });

  it('should return monotone interpolation for smooth', () => {
    const props = resolveSubTypeMarkProps(makeConfig({ type: 'line', subType: 'smooth' }));
    expect(props).toEqual({ interpolate: 'monotone' });
  });

  it('should return step interpolation for stepped', () => {
    const props = resolveSubTypeMarkProps(makeConfig({ type: 'line', subType: 'stepped' }));
    expect(props).toEqual({ interpolate: 'step' });
  });

  it('should return area type for filled radar', () => {
    const props = resolveSubTypeMarkProps(makeConfig({ type: 'radar', subType: 'filled' }));
    expect(props).toEqual({ type: 'area' });
  });
});

describe('buildMark - subType effects', () => {
  it('should produce line with monotone interpolation for smooth line', () => {
    const config = makeConfig({ type: 'line', subType: 'smooth' });
    const mark = buildMark(config) as MarkSpec;
    expect(mark.type).toBe('line');
    expect(mark.interpolate).toBe('monotone');
  });

  it('should produce line with step interpolation for stepped line', () => {
    const config = makeConfig({ type: 'line', subType: 'stepped' });
    const mark = buildMark(config) as MarkSpec;
    expect(mark.type).toBe('line');
    expect(mark.interpolate).toBe('step');
  });

  it('should produce stacked config for stacked bar', () => {
    const config = makeConfig({ type: 'bar', subType: 'stacked' });
    const configSpec = buildConfigSpec(config);
    expect(configSpec).toBeDefined();
    expect(configSpec!.stack).toBe('zero');
  });

  it('should produce normalize config for percentStacked bar', () => {
    const config = makeConfig({ type: 'bar', subType: 'percentStacked' });
    const configSpec = buildConfigSpec(config);
    expect(configSpec).toBeDefined();
    expect(configSpec!.stack).toBe('normalize');
  });

  it('should produce stacked config for stacked area', () => {
    const config = makeConfig({ type: 'area', subType: 'stacked' });
    const configSpec = buildConfigSpec(config);
    expect(configSpec).toBeDefined();
    expect(configSpec!.stack).toBe('zero');
  });
});

// =============================================================================
// Axis Config Mapping
// =============================================================================

describe('buildEncoding - axis config', () => {
  it('should map xAxis title to encoding.x.axis.title', () => {
    const config = makeConfig({
      axis: {
        xAxis: { type: 'category', title: 'Month' },
      },
    });
    const encoding = buildEncoding(config, SINGLE_SERIES_DATA);
    expect(encoding.x!.axis).toBeDefined();
    expect(encoding.x!.axis!.title).toBe('Month');
  });

  it('should map yAxis title to encoding.y.axis.title', () => {
    const config = makeConfig({
      axis: {
        yAxis: { type: 'value', title: 'Revenue ($)' },
      },
    });
    const encoding = buildEncoding(config, SINGLE_SERIES_DATA);
    expect(encoding.y!.axis).toBeDefined();
    expect(encoding.y!.axis!.title).toBe('Revenue ($)');
  });

  it('should map gridLines to axis.grid', () => {
    const config = makeConfig({
      axis: {
        xAxis: { type: 'category', gridLines: true },
        yAxis: { type: 'value', gridLines: false },
      },
    });
    const encoding = buildEncoding(config, SINGLE_SERIES_DATA);
    expect(encoding.x!.axis!.grid).toBe(true);
    expect(encoding.y!.axis!.grid).toBe(false);
  });

  it('should map axis min/max to scale domain', () => {
    const config = makeConfig({
      axis: {
        yAxis: { type: 'value', min: 0, max: 100 },
      },
    });
    const encoding = buildEncoding(config, SINGLE_SERIES_DATA);
    expect(encoding.y!.scale).toBeDefined();
    expect((encoding.y!.scale as { domain: [number, number] }).domain).toEqual([0, 100]);
  });

  it('should lower imported axis number formats and text styling', () => {
    const config = makeConfig({
      axis: {
        xAxis: {
          type: 'category',
          numberFormat: '"FY3/"0',
          crossesAt: 'automatic',
          format: {
            font: { size: 9, color: { theme: 'tx1' } },
            textRotation: -1000,
            textVerticalType: 'horz',
          },
        },
        yAxis: {
          type: 'value',
          gridLines: true,
          format: { line: {} },
          gridlineFormat: { color: { theme: 'tx1' }, width: 0.75 },
        },
      },
    });
    const encoding = buildEncoding(config, SINGLE_SERIES_DATA);

    expect(encoding.x!.axis).toEqual(
      expect.objectContaining({
        title: null,
        format: '"FY3/"0',
        labelFontSize: 12,
        labelColor: '#595959',
        crossesAt: 'automatic',
      }),
    );
    expect(encoding.x!.axis?.labelAngle).toBeUndefined();
    expect(encoding.y!.axis).toEqual(
      expect.objectContaining({
        title: null,
        domain: false,
        ticks: false,
        grid: true,
        gridColor: '#000000',
        gridWidth: 1,
        gridOpacity: 1,
      }),
    );
  });

  it('should lower imported gridline dash and transparency styling', () => {
    const config = makeConfig({
      axis: {
        yAxis: {
          type: 'value',
          gridLines: true,
          gridlineFormat: { width: 0.75, dashStyle: 'dashDot', transparency: 0.25 },
        },
      },
    });
    const encoding = buildEncoding(config, SINGLE_SERIES_DATA);

    expect(encoding.y!.axis).toEqual(
      expect.objectContaining({
        grid: true,
        gridWidth: 1,
        gridDash: [4, 2, 1, 2],
        gridOpacity: 0.75,
      }),
    );
  });

  it('should not set axis config when axis is undefined', () => {
    const config = makeConfig({ axis: undefined });
    const encoding = buildEncoding(config, SINGLE_SERIES_DATA);
    expect(encoding.x!.axis).toBeUndefined();
    expect(encoding.y!.axis).toBeUndefined();
  });

  it('should reserve category slot geometry for imported bar gap and overlap settings', () => {
    const columnEncoding = buildEncoding(
      makeConfig({ type: 'column', gapWidth: 150, overlap: 100 }),
      SINGLE_SERIES_DATA,
    );
    const barEncoding = buildEncoding(
      makeConfig({ type: 'bar', gapWidth: 150, overlap: 100 }),
      SINGLE_SERIES_DATA,
    );

    expect(columnEncoding.x!.scale).toEqual(
      expect.objectContaining({ paddingInner: 0, paddingOuter: 0 }),
    );
    expect(barEncoding.y!.scale).toEqual(
      expect.objectContaining({ paddingInner: 0, paddingOuter: 0 }),
    );
  });
});

// =============================================================================
// Legend Config Mapping
// =============================================================================

describe('buildEncoding - legend config', () => {
  it('should map legend position to color.legend.orient', () => {
    const config = makeConfig({
      legend: { show: true, position: 'right' },
    });
    const encoding = buildEncoding(config, MULTI_SERIES_DATA);
    expect(encoding.color!.legend).toBeDefined();
    expect((encoding.color!.legend as { orient: string }).orient).toBe('right');
  });

  it('should lower imported legend text styling and suppress the synthetic title', () => {
    const config = makeConfig({
      legend: {
        show: true,
        position: 'r',
        visible: true,
        format: { font: { size: 9, color: { theme: 'tx1' } } },
      },
    });
    const encoding = buildEncoding(config, MULTI_SERIES_DATA);

    expect(encoding.color!.legend).toEqual({
      orient: 'right',
      title: null,
      values: ['Series 1', 'Series 2'],
      entries: [
        {
          value: 'Series 1',
          label: 'Series 1',
          symbolType: 'area',
          seriesIndex: 0,
          sourceSeriesIndex: 0,
          sourceSeriesKey: 'series:0',
        },
        {
          value: 'Series 2',
          label: 'Series 2',
          symbolType: 'area',
          seriesIndex: 1,
          sourceSeriesIndex: 1,
          sourceSeriesKey: 'series:1',
        },
      ],
      symbolType: 'area',
      labelFontSize: 12,
      labelColor: '#595959',
    });
  });

  it('should hide legend when show=false', () => {
    const config = makeConfig({
      legend: { show: false, position: 'bottom' },
    });
    const encoding = buildEncoding(config, MULTI_SERIES_DATA);
    expect(encoding.color!.legend).toBeNull();
  });

  it('should map legend position for pie charts', () => {
    const config = makeConfig({
      type: 'pie',
      legend: { show: true, position: 'left' },
    });
    const encoding = buildEncoding(config, SINGLE_SERIES_DATA);
    expect(encoding.color!.legend).toBeDefined();
    expect((encoding.color!.legend as { orient: string }).orient).toBe('left');
  });

  it('should hide legend for pie charts when show=false', () => {
    const config = makeConfig({
      type: 'pie',
      legend: { show: false, position: 'bottom' },
    });
    const encoding = buildEncoding(config, SINGLE_SERIES_DATA);
    expect(encoding.color!.legend).toBeNull();
  });
});

// =============================================================================
// Colors Mapping
// =============================================================================

describe('buildConfigSpec - colors', () => {
  it('should map colors array to config.range.category', () => {
    const config = makeConfig({ colors: ['#ff0000', '#00ff00', '#0000ff'] });
    const configSpec = buildConfigSpec(config);
    expect(configSpec).toBeDefined();
    expect(configSpec!.range).toEqual({ category: ['#ff0000', '#00ff00', '#0000ff'] });
  });

  it('should return undefined when no colors, no subType, and no chart-specific config', () => {
    const config = makeConfig({ type: 'line' });
    const configSpec = buildConfigSpec(config);
    expect(configSpec).toBeUndefined();
  });

  it('should combine stack and colors in config', () => {
    const config = makeConfig({
      subType: 'stacked',
      colors: ['#aaa', '#bbb'],
    });
    const configSpec = buildConfigSpec(config);
    expect(configSpec).toBeDefined();
    expect(configSpec!.stack).toBe('zero');
    expect(configSpec!.range).toEqual({ category: ['#aaaaaa', '#bbbbbb'] });
  });

  it('should carry imported bar gap and overlap into grammar config', () => {
    const configSpec = buildConfigSpec(makeConfig({ gapWidth: 150, overlap: 100 }));

    expect(configSpec).toBeDefined();
    expect(configSpec!.gapWidth).toBe(150);
    expect(configSpec!.overlap).toBe(100);
  });

  it('estimates imported value-axis label gutter from formatted tick labels', () => {
    const config = makeConfig({
      type: 'column',
      subType: 'stacked',
      axis: {
        yAxis: {
          type: 'value',
          max: 1800000,
          numberFormat: '#,##0_);\\(#,##0\\);\\–_);"–"_)',
          format: { font: { size: 9, color: { theme: 'tx1' } } },
        },
      },
    });
    const shortLabelConfig = makeConfig({
      type: 'column',
      subType: 'stacked',
      axis: {
        yAxis: {
          type: 'value',
          numberFormat: '#,##0_);\\(#,##0\\);\\–_);"–"_)',
          format: { font: { size: 9, color: { theme: 'tx1' } } },
        },
      },
    });
    const shortData: ChartData = {
      categories: ['A'],
      series: [
        { name: 'Positive', data: [{ x: 'A', y: 88000 }] },
        { name: 'Negative', data: [{ x: 'A', y: -12000 }] },
      ],
    };
    const longEncoding = buildEncoding(config, SINGLE_SERIES_DATA);
    const shortEncoding = buildEncoding(shortLabelConfig, shortData);

    const longConfigSpec = buildConfigSpec(config, longEncoding);
    const shortConfigSpec = buildConfigSpec(shortLabelConfig, shortEncoding);

    expect(longConfigSpec?.layoutHints?.yAxisLabelWidth).toBeGreaterThan(
      shortConfigSpec?.layoutHints?.yAxisLabelWidth ?? 0,
    );
    expect(shortConfigSpec?.layoutHints?.yAxisLabelWidth).toBeLessThan(80);
  });

  it('estimates an Excel-like bottom gutter for imported zero-crossing category axes', () => {
    const config = makeConfig({
      type: 'column',
      subType: 'stacked',
      axis: {
        xAxis: {
          type: 'category',
          tickMarks: 'none',
          crossesAt: 'automatic',
          format: { font: { size: 9 }, textRotation: -1000, textVerticalType: 'horz' },
        },
        yAxis: {
          type: 'value',
          max: 100000,
        },
      },
    });
    const data: ChartData = {
      categories: ['A'],
      series: [
        { name: 'Positive', data: [{ x: 'A', y: 88000 }] },
        { name: 'Negative', data: [{ x: 'A', y: -12000 }] },
      ],
    };
    const encoding = buildEncoding(config, data);
    const configSpec = buildConfigSpec(config, encoding);

    expect(encoding.x?.axis).toEqual(
      expect.objectContaining({
        crossesAt: 'automatic',
        labelPadding: 14,
      }),
    );
    expect(encoding.x?.axis?.labelAngle).toBeUndefined();
    expect(configSpec?.layoutHints?.bottomMargin).toBe(29);
  });

  it('should derive category colors from imported series theme fills', () => {
    const config = makeConfig({
      colors: ['#ff0000'],
      series: [
        { name: 'A', format: { fill: { type: 'solid', color: { theme: 'accent1' } } } },
        { name: 'B', format: { fill: { type: 'solid', color: { theme: 'accent2' } } } },
      ],
    });
    const encoding = buildEncoding(config, MULTI_SERIES_DATA);
    const configSpec = buildConfigSpec(config);

    expect(encoding.color!.scale).toEqual({ range: ['#4472C4', '#ED7D31'] });
    expect(configSpec!.range).toEqual({ category: ['#4472C4', '#ED7D31'] });
  });

  it('should derive repeated imported theme colors from source series index', () => {
    const config = makeConfig({
      series: [
        {
          name: 'Staffing',
          idx: 0,
          format: { fill: { type: 'solid', color: { theme: 'accent1' } } },
        },
        { name: 'APAC', idx: 6, format: { fill: { type: 'solid', color: { theme: 'accent1' } } } },
      ],
    });

    const configSpec = buildConfigSpec(config);

    expect(configSpec!.range).toEqual({ category: ['#4472C4', '#264478'] });
  });

  it('should map explicit chart fills to a chart background', () => {
    const configSpec = buildConfigSpec(
      makeConfig({ chartFormat: { fill: { type: 'solid', color: '#111111' } } }),
    );

    expect(configSpec).toBeDefined();
    expect(configSpec!.background).toBe('#111111');
  });
});

// =============================================================================
// Title/Subtitle
// =============================================================================

describe('buildTitle', () => {
  it('should return undefined when no title', () => {
    expect(buildTitle(makeConfig())).toBeUndefined();
  });

  it('should return string when only title (no subtitle)', () => {
    expect(buildTitle(makeConfig({ title: 'My Chart' }))).toBe('My Chart');
  });

  it('should return TitleSpec when both title and subtitle', () => {
    const result = buildTitle(makeConfig({ title: 'Main', subtitle: 'Sub' }));
    expect(result).toEqual({ text: 'Main', subtitle: 'Sub' });
  });

  it('should lower imported title font styling', () => {
    const result = buildTitle(
      makeConfig({
        title: 'Revenue (mn)',
        titleFormat: { font: { size: 10.8, bold: false, color: { theme: 'tx1' } } },
      }),
    );
    expect(result).toEqual({
      text: 'Revenue (mn)',
      fontSize: 14.4,
      color: '#595959',
    });
  });

  it('should lower imported title alignment into title layout hints', () => {
    const result = buildTitle(
      makeConfig({
        title: 'Aligned',
        chartTitle: {
          horizontalAlignment: 'right',
          verticalAlignment: 'bottom',
        },
      }),
    );

    expect(result).toEqual({
      text: 'Aligned',
      anchor: 'end',
      verticalAlign: 'bottom',
    });
  });
});

describe('formatTickValue - imported Excel number formats', () => {
  it('formats quoted-prefix fiscal year category labels', () => {
    expect(formatTickValue('19', '"FY3/"0')).toBe('FY3/19');
  });

  it('formats Excel comma/negative/zero value axis labels', () => {
    const format = '#,##0_);\\(#,##0\\);\\–_);"–"_)';
    expect(formatTickValue(200000, format)).toBe('200,000');
    expect(formatTickValue(-200000, format)).toBe('(200,000)');
    expect(formatTickValue(0, format)).toBe('–');
  });
});

// =============================================================================
// Pie/Doughnut specific
// =============================================================================

describe('buildMark - pie/doughnut', () => {
  it('should set radial explosion metadata from pieSlice.explodeOffset', () => {
    const config = makeConfig({
      type: 'pie',
      pieSlice: { explodeOffset: 0.1 },
    });
    const mark = buildMark(config) as MarkSpec;
    expect(mark.type).toBe('arc');
    expect(mark._explosionOffset).toBe(0.1);
    expect(mark._explodeAll).toBe(true);
  });

  it('should set innerRadius and radial explosion metadata for doughnut with pieSlice', () => {
    const config = makeConfig({
      type: 'doughnut',
      pieSlice: { explodeOffset: 0.05 },
    });
    const mark = buildMark(config) as MarkSpec;
    expect(mark.type).toBe('arc');
    expect(mark.innerRadius).toBe(0.5);
    expect(mark._explosionOffset).toBe(0.05);
    expect(mark._explodeAll).toBe(true);
  });
});

// =============================================================================
// Scatter specific
// =============================================================================

describe('buildMark - scatter', () => {
  it('should return point for basic scatter', () => {
    const config = makeConfig({ type: 'scatter' });
    const mark = buildMark(config);
    expect(mark).toEqual({ type: 'point', skipInvalidPositions: true });
  });

  it('should return line with point=true when showLines', () => {
    const config = makeConfig({
      type: 'scatter',
      showLines: true,
      series: [{ showMarkers: true }],
    });
    const mark = buildMark(config) as MarkSpec;
    expect(mark.type).toBe('line');
    expect(mark.point).toBe(true);
  });

  it('should return line with monotone interpolation when showLines + smoothLines', () => {
    const config = makeConfig({
      type: 'scatter',
      showLines: true,
      smoothLines: true,
      series: [{ showMarkers: true }],
    });
    const mark = buildMark(config) as MarkSpec;
    expect(mark.type).toBe('line');
    expect(mark.interpolate).toBe('monotone');
    expect(mark.point).toBe(true);
  });
});

describe('buildTrendlineTransform', () => {
  it('should return empty array when trendline show=false', () => {
    const transforms = buildTrendlineTransform({ show: false, type: 'linear' });
    expect(transforms).toEqual([]);
  });

  it('should return regression transform for linear trendline', () => {
    const transforms = buildTrendlineTransform({ show: true, type: 'linear' });
    expect(transforms).toHaveLength(1);
    expect(transforms[0]).toMatchObject({
      regression: 'value',
      on: 'category',
      method: 'linear',
    });
  });

  it('should return regression transform for polynomial with order', () => {
    const transforms = buildTrendlineTransform({
      show: true,
      type: 'polynomial',
      order: 3,
    });
    expect(transforms).toHaveLength(1);
    expect(transforms[0]).toMatchObject({
      regression: 'value',
      on: 'category',
      method: 'poly',
      order: 3,
    });
  });
});

// =============================================================================
// Radar specific
// =============================================================================

describe('buildMark - radar', () => {
  it('should produce a radar mark for basic radar', () => {
    const config = makeConfig({ type: 'radar' });
    const mark = buildMark(config) as MarkSpec;
    expect(mark.type).toBe('radar');
  });

  it('should produce a filled radar mark for radarFilled', () => {
    const config = makeConfig({ type: 'radar', radarFilled: true });
    const mark = buildMark(config) as MarkSpec;
    expect(mark.type).toBe('radar');
    expect(mark.fillOpacity).toBeGreaterThan(0);
  });

  it('should add point=true for radarMarkers', () => {
    const config = makeConfig({ type: 'radar', radarMarkers: true });
    const mark = buildMark(config) as MarkSpec;
    expect(mark.point).toBe(true);
  });

  it('should combine radarFilled and radarMarkers', () => {
    const config = makeConfig({ type: 'radar', radarFilled: true, radarMarkers: true });
    const mark = buildMark(config) as MarkSpec;
    expect(mark.type).toBe('radar');
    expect(mark.fillOpacity).toBeGreaterThan(0);
    expect(mark.point).toBe(true);
  });
});

// =============================================================================
// Data Labels
// =============================================================================

describe('buildDataLabelLayer', () => {
  it('should return undefined when show=false', () => {
    const result = buildDataLabelLayer(
      { show: false },
      { x: { field: 'category', type: 'nominal' } },
    );
    expect(result).toBeUndefined();
  });

  it('should return text layer when show=true', () => {
    const encoding: EncodingSpec = {
      x: { field: 'category', type: 'nominal' },
      y: { field: 'value', type: 'quantitative' },
    };
    const result = buildDataLabelLayer({ show: true }, encoding);
    expect(result).toBeDefined();
    expect((result!.mark as MarkSpec).type).toBe('text');
    expect(result!.encoding!.text).toEqual({ field: DATA_LABEL_TEXT_FIELD, type: 'nominal' });
    // Should inherit x/y from parent encoding
    expect(result!.encoding!.x).toBeDefined();
    expect(result!.encoding!.y).toBeDefined();
  });
});

// =============================================================================
// Combo Charts
// =============================================================================

describe('buildComboLayers', () => {
  it('should produce one layer per series', () => {
    const config = makeConfig({ type: 'combo' });
    const layers = buildComboLayers(config, MULTI_SERIES_DATA, []);
    expect(layers).toHaveLength(2);
  });

  it('should default first series to bar and second to line', () => {
    const config = makeConfig({ type: 'combo' });
    const layers = buildComboLayers(config, MULTI_SERIES_DATA, []);
    expect((layers[0].mark as MarkSpec).type).toBe('bar');
    expect((layers[1].mark as MarkSpec).type).toBe('line');
  });

  it('should respect series type overrides', () => {
    const config = makeConfig({
      type: 'combo',
      series: [
        { type: 'line', color: '#ff0000' },
        { type: 'area', color: '#00ff00' },
      ],
    });
    const layers = buildComboLayers(config, MULTI_SERIES_DATA, []);
    expect((layers[0].mark as MarkSpec).type).toBe('line');
    expect((layers[0].mark as MarkSpec).color).toBe('#ff0000');
    expect((layers[1].mark as MarkSpec).type).toBe('area');
    expect((layers[1].mark as MarkSpec).color).toBe('#00ff00');
  });

  it('should add filter transform to each layer for the series', () => {
    const config = makeConfig({ type: 'combo' });
    const layers = buildComboLayers(config, MULTI_SERIES_DATA, []);
    for (let i = 0; i < layers.length; i++) {
      expect(layers[i].transform).toBeDefined();
      expect(layers[i].transform).toHaveLength(1);
      const filterTransform = layers[i].transform![0] as {
        type: 'filter';
        filter: { field: string; equal?: number; oneOf?: number[] };
      };
      expect(filterTransform.filter.field).toBe(SERIES_INDEX_FIELD);
      if (filterTransform.filter.oneOf) {
        expect(filterTransform.filter.oneOf).toContain(i);
      } else {
        expect(filterTransform.filter.equal).toBe(i);
      }
    }
  });

  it('should apply series mark properties (lineWidth, showMarkers)', () => {
    const config = makeConfig({
      type: 'combo',
      series: [{ type: 'line', lineWidth: 3, showMarkers: true }],
    });
    const data = makeData(1);
    const layers = buildComboLayers(config, data, []);
    const mark = layers[0].mark as MarkSpec;
    const markerLayer = layers.find((layer) => (layer.mark as MarkSpec).type === 'point');
    expect(mark.strokeWidth).toBe(4);
    expect(markerLayer).toBeDefined();
  });
});

// =============================================================================
// Secondary Y-Axis
// =============================================================================

describe('hasSecondaryYAxis', () => {
  it('should return false when no secondary axis config', () => {
    expect(hasSecondaryYAxis(makeConfig())).toBe(false);
  });

  it('should return false when secondaryYAxis.show is false', () => {
    const config = makeConfig({
      axis: { secondaryYAxis: { type: 'value', show: false } },
    });
    expect(hasSecondaryYAxis(config)).toBe(false);
  });

  it('should return false when no series uses yAxisIndex=1', () => {
    const config = makeConfig({
      axis: { secondaryYAxis: { type: 'value', show: true } },
      series: [{ yAxisIndex: 0 }],
    });
    expect(hasSecondaryYAxis(config)).toBe(false);
  });

  it('should return true when secondaryYAxis.show and a series uses yAxisIndex=1', () => {
    const config = makeConfig({
      axis: { secondaryYAxis: { type: 'value', show: true } },
      series: [{ yAxisIndex: 0 }, { yAxisIndex: 1 }],
    });
    expect(hasSecondaryYAxis(config)).toBe(true);
  });
});

// =============================================================================
// Full configToSpec Integration Tests
// =============================================================================

describe('configToSpec - integration', () => {
  it('should produce a valid spec for a simple bar chart', () => {
    const config = makeConfig({ type: 'bar', title: 'Sales' });
    const spec = configToSpec(config, SINGLE_SERIES_DATA);

    expect(spec.width).toBe(640); // 480pt at 96 CSS px/in
    expect(spec.height).toBe(300); // 225pt at 96 CSS px/in
    expect(spec.mark).toEqual({
      type: 'bar',
      fillField: SERIES_FILL_FIELD,
      strokeField: SERIES_STROKE_FIELD,
      strokeWidthField: SERIES_STROKE_WIDTH_FIELD,
    });
    expect(spec.data).toEqual({ values: expect.any(Array) });
    expect(spec.encoding).toBeDefined();
    expect(spec.encoding!.x!.type).toBe('quantitative');
    expect(spec.encoding!.y!.type).toBe('nominal');
    expect(spec.title).toBe('Sales');
  });

  it('should produce a layered spec for combo charts', () => {
    const config = makeConfig({
      type: 'combo',
      series: [{ type: 'bar' }, { type: 'line' }],
    });
    const spec = configToSpec(config, MULTI_SERIES_DATA);

    expect(spec.layer).toBeDefined();
    expect(spec.layer!.length).toBeGreaterThanOrEqual(2);
    expect(spec.mark).toBeUndefined(); // layered spec has no top-level mark
  });

  it('should produce a layered spec when dataLabels.show=true', () => {
    const config = makeConfig({
      type: 'bar',
      dataLabels: { show: true },
    });
    const spec = configToSpec(config, SINGLE_SERIES_DATA);

    expect(spec.layer).toBeDefined();
    expect(spec.layer!).toHaveLength(4); // main + normal/outer/inner label layers
  });

  it('should include config.stack for stacked bar', () => {
    const config = makeConfig({ type: 'bar', subType: 'stacked' });
    const spec = configToSpec(config, SINGLE_SERIES_DATA);

    expect(spec.config).toBeDefined();
    expect(spec.config!.stack).toBe('zero');
  });

  it('should include config.range.category for custom colors', () => {
    const config = makeConfig({ colors: ['red', 'blue'] });
    const spec = configToSpec(config, SINGLE_SERIES_DATA);

    expect(spec.config).toBeDefined();
    expect(spec.config!.range).toEqual({ category: ['red', 'blue'] });
  });

  it('should produce correct spec for pie chart', () => {
    const config = makeConfig({ type: 'pie' });
    const spec = configToSpec(config, SINGLE_SERIES_DATA);

    const mark = spec.mark as MarkSpec;
    expect(mark.type).toBe('arc');
    expect(spec.encoding!.theta).toBeDefined();
    expect(spec.encoding!.color).toBeDefined();
    expect(spec.encoding!.x).toBeUndefined();
    expect(spec.encoding!.y).toBeUndefined();
  });

  it('should produce correct spec for doughnut chart', () => {
    const config = makeConfig({ type: 'doughnut' });
    const spec = configToSpec(config, SINGLE_SERIES_DATA);

    const mark = spec.mark as MarkSpec;
    expect(mark.type).toBe('arc');
    expect(mark.innerRadius).toBe(0.5);
  });

  it('should include trendline transforms for scatter with trendline', () => {
    const config = makeConfig({
      type: 'scatter',
      trendline: { show: true, type: 'linear' },
    });
    const spec = configToSpec(config, SINGLE_SERIES_DATA);

    expect(
      spec.layer?.some((layer) =>
        layer.transform?.some((transform) => transform.type === 'regression'),
      ),
    ).toBe(true);
  });

  it('should not include transforms when no trendline', () => {
    const config = makeConfig({ type: 'scatter' });
    const spec = configToSpec(config, SINGLE_SERIES_DATA);

    expect(spec.transform).toBeUndefined();
  });

  it('should handle empty data gracefully', () => {
    const config = makeConfig();
    const spec = configToSpec(config, { categories: [], series: [] });

    expect(spec.data).toEqual({ values: [] });
    expect(spec.encoding).toBeDefined();
  });

  it('should handle all axis config together', () => {
    const config = makeConfig({
      type: 'line',
      title: 'Revenue by Month',
      subtitle: 'FY 2025',
      axis: {
        xAxis: { type: 'category', title: 'Month', gridLines: false },
        yAxis: { type: 'value', title: 'Revenue', gridLines: true, min: 0, max: 1000 },
      },
      legend: { show: true, position: 'top' },
    });
    const spec = configToSpec(config, MULTI_SERIES_DATA);

    // Title
    expect(spec.title).toEqual({ text: 'Revenue by Month', subtitle: 'FY 2025' });

    // Axes
    expect(spec.encoding!.x!.axis!.title).toBe('Month');
    expect(spec.encoding!.x!.axis!.grid).toBe(false);
    expect(spec.encoding!.y!.axis!.title).toBe('Revenue');
    expect(spec.encoding!.y!.axis!.grid).toBe(true);
    expect((spec.encoding!.y!.scale as { domain: [number, number] }).domain).toEqual([0, 1000]);

    // Legend
    expect(spec.encoding!.color!.legend).toEqual({
      orient: 'top',
      title: null,
      values: ['Series 1', 'Series 2'],
      entries: [
        {
          value: 'Series 1',
          label: 'Series 1',
          symbolType: 'line',
          seriesIndex: 0,
          sourceSeriesIndex: 0,
          sourceSeriesKey: 'series:0',
        },
        {
          value: 'Series 2',
          label: 'Series 2',
          symbolType: 'line',
          seriesIndex: 1,
          sourceSeriesIndex: 1,
          sourceSeriesKey: 'series:1',
        },
      ],
      symbolType: 'line',
      labelFontSize: 12,
    });
  });

  it('should default width/height when not provided', () => {
    const config = makeConfig({ width: 0, height: 0 });
    const spec = configToSpec(config, SINGLE_SERIES_DATA);
    expect(spec.width).toBe(600);
    expect(spec.height).toBe(400);
  });

  it('should produce a native radar mark', () => {
    const config = makeConfig({ type: 'radar' });
    const spec = configToSpec(config, SINGLE_SERIES_DATA);
    const mark = spec.mark as MarkSpec;
    expect(mark.type).toBe('radar');
  });

  it('should produce data label layer in combo chart', () => {
    const config = makeConfig({
      type: 'combo',
      dataLabels: { show: true },
      series: [{ type: 'bar' }],
    });
    const spec = configToSpec(config, SINGLE_SERIES_DATA);
    expect(spec.layer).toBeDefined();
    // At least 1 series layer + normal/outer/inner data label layers.
    const textLayers = spec.layer!.filter((l) => {
      const m = l.mark as MarkSpec;
      return m.type === 'text';
    });
    expect(textLayers.length).toBe(3);
  });
});

// =============================================================================
// Round-trip test: configToSpec -> compile (smoke test)
// =============================================================================

describe('configToSpec - compile round-trip', () => {
  it('should produce a spec that the compiler accepts (bar chart)', () => {
    // Import compile lazily to verify the spec is structurally valid
    const { compile } = require('../../src/grammar/compiler');
    const config = makeConfig({ type: 'bar', title: 'Test' });
    const spec = configToSpec(config, SINGLE_SERIES_DATA);
    const result = compile(spec, undefined, { width: 600, height: 400 });

    expect(result).toBeDefined();
    expect(result.marks).toBeDefined();
    expect(Array.isArray(result.marks)).toBe(true);
  });

  it('should emit explicit background marks before chart content', () => {
    const config = makeConfig({
      type: 'column',
      chartFormat: { fill: { type: 'solid', color: '#111111' } },
    });
    const spec = configToSpec(config, SINGLE_SERIES_DATA);
    const result = compile(spec, undefined, { width: 600, height: 400 });
    const marks = collectMarks(result);

    expect(spec.config?.background).toBe('#111111');
    expect(result.background).toEqual([
      {
        type: 'rect',
        x: 0,
        y: 0,
        width: 600,
        height: 400,
        style: { fill: '#111111' },
      },
    ]);
    expect(marks[0]).toBe(result.background?.[0]);
  });

  it('should render gridlines behind data marks and axis labels above them', () => {
    const config = makeConfig({
      type: 'column',
      axis: {
        xAxis: {
          visible: true,
          type: 'category',
          tickMarks: 'none',
          format: { textRotation: -1000 },
          crossesAt: 'automatic',
        },
        yAxis: { visible: true, type: 'value', gridLines: true, min: -10, max: 10 },
      },
    });
    const spec = configToSpec(config, SINGLE_SERIES_DATA);
    const result = compile(spec, undefined, { width: 600, height: 400 });
    const marks = collectMarks(result);
    const firstGridlineIndex = marks.findIndex(
      (mark) => (mark.datum as { axisPart?: string } | undefined)?.axisPart === 'grid',
    );
    const firstDataMarkIndex = marks.findIndex((mark) => mark.type === 'rect');
    const firstAxisLabelIndex = marks.findIndex(
      (mark) => (mark.datum as { axisPart?: string } | undefined)?.axisPart === 'label',
    );

    expect(firstGridlineIndex).toBeGreaterThanOrEqual(0);
    expect(firstDataMarkIndex).toBeGreaterThan(firstGridlineIndex);
    expect(firstAxisLabelIndex).toBeGreaterThan(firstDataMarkIndex);
  });

  it('should render Excel gapWidth as narrower stacked columns inside each category slot', () => {
    const config = makeConfig({
      type: 'column',
      subType: 'stacked',
      gapWidth: 150,
      overlap: 100,
    });
    const spec = configToSpec(config, MULTI_SERIES_DATA);
    const result = compile(spec, undefined, { width: 600, height: 400 });
    const rects = result.marks.filter((mark) => mark.type === 'rect');
    const firstCategoryBars = rects
      .filter((mark) => (mark.datum as Record<string, unknown>).category === 'A')
      .sort((a, b) => a.x - b.x);
    const secondCategoryBar = rects.find(
      (mark) => (mark.datum as Record<string, unknown>).category === 'B',
    );

    expect(firstCategoryBars).toHaveLength(2);
    expect(firstCategoryBars[0].x).toBeCloseTo(firstCategoryBars[1].x, 6);
    expect(firstCategoryBars[0].width).toBeCloseTo(firstCategoryBars[1].width, 6);
    expect(secondCategoryBar).toBeDefined();

    const categoryStep = secondCategoryBar!.x - firstCategoryBars[0].x;
    expect(firstCategoryBars[0].width / categoryStep).toBeCloseTo(0.4, 2);
  });

  it('renders stacked column segments with imported per-series fills', () => {
    const categories = [
      'North Coast',
      'Central Plains',
      'Mountain West',
      'River Delta',
      'Island Chain',
    ];
    const seriesNames = ['Forest', 'Agriculture', 'Urban', 'Water/Wetland'];
    const seriesValues = [
      [32, 18, 44, 22, 55],
      [28, 51, 12, 47, 8],
      [16, 21, 9, 19, 25],
      [24, 10, 35, 12, 12],
    ];
    const colors = ['2F75B5', '70AD47', 'ED7D31', '7030A0'];
    const data: ChartData = {
      categories,
      series: seriesNames.map((name, seriesIndex) => ({
        name,
        data: categories.map((category, pointIndex) => ({
          x: category,
          y: seriesValues[seriesIndex][pointIndex],
        })),
      })),
    };
    const config = makeConfig({
      type: 'column',
      subType: 'stacked',
      gapWidth: 150,
      overlap: 100,
      legend: { show: true, position: 'bottom' },
      series: seriesNames.map((name, index) => ({
        name,
        idx: index,
        order: index,
        color: colors[index],
        format: {
          fill: { type: 'solid' as const, color: colors[index] },
          line: { color: colors[index] },
        },
      })),
    });

    const spec = configToSpec(config, data);
    expect(spec.encoding?.y?.scale?.domain).toEqual([0, 120]);

    const result = compile(spec, undefined, { width: 600, height: 400 });
    const firstStack = result.marks.filter(
      (mark) =>
        mark.type === 'rect' && (mark.datum as Record<string, unknown>).category === categories[0],
    );
    const legendLabels = result.legends
      .filter((mark) => mark.type === 'text')
      .map((mark) => (mark as { text: string }).text);

    expect(firstStack).toHaveLength(4);
    expect(firstStack.map((mark) => mark.style.fill)).toEqual([
      '#2F75B5',
      '#70AD47',
      '#ED7D31',
      '#7030A0',
    ]);
    for (let index = 1; index < firstStack.length; index += 1) {
      expect(firstStack[index].x).toBeCloseTo(firstStack[0].x, 6);
      expect(firstStack[index].width).toBeCloseTo(firstStack[0].width, 6);
      expect(firstStack[index].y + firstStack[index].height).toBeCloseTo(
        firstStack[index - 1].y,
        6,
      );
    }
    expect(legendLabels).toEqual(seriesNames);
  });

  it('should produce a spec that the compiler accepts (line chart)', () => {
    const { compile } = require('../../src/grammar/compiler');
    const config = makeConfig({ type: 'line' });
    const spec = configToSpec(config, MULTI_SERIES_DATA);
    const result = compile(spec, undefined, { width: 600, height: 400 });

    expect(result).toBeDefined();
    expect(result.marks.length).toBeGreaterThan(0);
  });

  it('should produce a spec that the compiler accepts (pie chart)', () => {
    const { compile } = require('../../src/grammar/compiler');
    const config = makeConfig({ type: 'pie' });
    const spec = configToSpec(config, SINGLE_SERIES_DATA);
    const result = compile(spec, undefined, { width: 400, height: 400 });

    expect(result).toBeDefined();
    expect(result.marks).toBeDefined();
  });

  it('should produce a spec that the compiler accepts (scatter chart)', () => {
    const { compile } = require('../../src/grammar/compiler');
    const config = makeConfig({ type: 'scatter' });
    const spec = configToSpec(config, SINGLE_SERIES_DATA);
    const result = compile(spec, undefined, { width: 600, height: 400 });

    expect(result).toBeDefined();
    expect(result.marks).toBeDefined();
  });

  it('should produce a spec that the compiler accepts (area chart)', () => {
    const { compile } = require('../../src/grammar/compiler');
    const config = makeConfig({ type: 'area', subType: 'stacked' });
    const spec = configToSpec(config, MULTI_SERIES_DATA);
    const result = compile(spec, undefined, { width: 600, height: 400 });

    expect(result).toBeDefined();
    expect(result.marks).toBeDefined();
  });
});

// =============================================================================
// Enhanced combo chart layering
// =============================================================================

describe('buildComboLayers - enhanced', () => {
  it('should support mixed mark types (bar + line) in combo', () => {
    const config = makeConfig({
      type: 'combo',
      series: [{ type: 'bar' }, { type: 'line' }],
    });
    const layers = buildComboLayers(config, MULTI_SERIES_DATA, []);
    expect((layers[0].mark as MarkSpec).type).toBe('bar');
    expect((layers[1].mark as MarkSpec).type).toBe('line');
  });

  it('should apply series-specific colors to marks', () => {
    const config = makeConfig({
      type: 'combo',
      series: [
        { type: 'bar', color: '#ff0000' },
        { type: 'line', color: '#0000ff' },
      ],
    });
    const layers = buildComboLayers(config, MULTI_SERIES_DATA, []);
    expect(layers[0].encoding?.color?.scale).toEqual({
      range: ['#ff0000', '#0000ff'],
    });
    expect((layers[1].mark as MarkSpec).color).toBe('#0000ff');
  });

  it('should default to bar+line when no series config provided', () => {
    const config = makeConfig({ type: 'combo' });
    const layers = buildComboLayers(config, MULTI_SERIES_DATA, []);
    expect((layers[0].mark as MarkSpec).type).toBe('bar');
    expect((layers[1].mark as MarkSpec).type).toBe('line');
  });

  it('should handle single series in combo chart', () => {
    const config = makeConfig({ type: 'combo' });
    const layers = buildComboLayers(config, SINGLE_SERIES_DATA, []);
    expect(layers).toHaveLength(1);
    expect((layers[0].mark as MarkSpec).type).toBe('bar');
  });
});

// =============================================================================
// Per-series encoding overrides
// =============================================================================

describe('buildComboLayers - per-series overrides', () => {
  it('should apply markerSize as point.size', () => {
    const config = makeConfig({
      type: 'combo',
      series: [{ type: 'line', markerSize: 50 }],
    });
    const layers = buildComboLayers(config, SINGLE_SERIES_DATA, []);
    const markerLayer = layers.find((layer) => (layer.mark as MarkSpec).type === 'point');
    const mark = markerLayer?.mark as MarkSpec | undefined;
    expect(markerLayer).toBeDefined();
    expect(mark!.point).toEqual({ size: 50, filled: true });
  });

  it('should apply lineWidth as strokeWidth', () => {
    const config = makeConfig({
      type: 'combo',
      series: [{ type: 'line', lineWidth: 4 }],
    });
    const layers = buildComboLayers(config, SINGLE_SERIES_DATA, []);
    const mark = layers[0].mark as MarkSpec;
    expect(mark.strokeWidth).toBeCloseTo(16 / 3);
  });

  it('should add data label layer for series with dataLabels.show', () => {
    const config = makeConfig({
      type: 'combo',
      series: [{ type: 'bar', dataLabels: { show: true } }],
    });
    const layers = configToSpec(config, SINGLE_SERIES_DATA).layer!;
    // 1 main layer + normal/outer/inner data label layers
    expect(layers).toHaveLength(4);
    const textLayers = layers.filter((layer) => (layer.mark as MarkSpec).type === 'text');
    expect(textLayers).toHaveLength(3);
    expect((layers[1].mark as MarkSpec).type).toBe('text');
    expect(layers[1].encoding!.text).toBeDefined();
  });

  it('should NOT add data label layer for series with dataLabels.show=false', () => {
    const config = makeConfig({
      type: 'combo',
      series: [{ type: 'bar', dataLabels: { show: false } }],
    });
    const layers = configToSpec(config, SINGLE_SERIES_DATA).layer!;
    expect(layers).toHaveLength(1);
  });

  it('should add trendline layer for series with trendline.show', () => {
    const config = makeConfig({
      type: 'combo',
      series: [
        {
          type: 'scatter',
          trendline: { show: true, type: 'linear', color: '#999', lineWidth: 2 },
        },
      ],
    });
    const layers = configToSpec(config, SINGLE_SERIES_DATA).layer!;
    // 1 main layer + 1 trendline layer
    expect(layers).toHaveLength(2);
    const trendLayer = layers[1];
    expect((trendLayer.mark as MarkSpec).type).toBe('line');
    expect((trendLayer.mark as MarkSpec).stroke).toBe('#999');
    expect((trendLayer.mark as MarkSpec).strokeWidth).toBe(2);
    // Should have filter + regression transforms
    expect(trendLayer.transform!.length).toBeGreaterThanOrEqual(2);
  });

  it('should add both data labels and trendline layers for a series', () => {
    const config = makeConfig({
      type: 'combo',
      series: [
        {
          type: 'line',
          dataLabels: { show: true },
          trendline: { show: true, type: 'linear' },
        },
      ],
    });
    const layers = configToSpec(config, SINGLE_SERIES_DATA).layer!;
    // 1 main + 1 trendline + normal/outer/inner label layers
    expect(layers).toHaveLength(5);
  });
});

// =============================================================================
// Dual-axis support
// =============================================================================

describe('configToSpec - dual-axis', () => {
  it('should add resolve when secondary y-axis is configured', () => {
    const config = makeConfig({
      type: 'combo',
      axis: { secondaryYAxis: { type: 'value', show: true, title: 'Right Axis' } },
      series: [
        { type: 'bar', yAxisIndex: 0 },
        { type: 'line', yAxisIndex: 1 },
      ],
    });
    const spec = configToSpec(config, MULTI_SERIES_DATA);
    expect(spec.resolve).toBeDefined();
    expect(spec.resolve!.scale).toEqual({ y: 'independent' });
    expect(spec.resolve!.axis).toEqual({ y: 'independent' });
  });

  it('should NOT add resolve when no secondary y-axis', () => {
    const config = makeConfig({
      type: 'combo',
      series: [{ type: 'bar' }, { type: 'line' }],
    });
    const spec = configToSpec(config, MULTI_SERIES_DATA);
    expect(spec.resolve).toBeUndefined();
  });

  it('should set secondary axis title on yAxisIndex=1 layers', () => {
    const config = makeConfig({
      type: 'combo',
      axis: { secondaryYAxis: { type: 'value', show: true, title: 'Percentage' } },
      series: [
        { type: 'bar', yAxisIndex: 0 },
        { type: 'line', yAxisIndex: 1 },
      ],
    });
    const spec = configToSpec(config, MULTI_SERIES_DATA);
    // The second layer should have the secondary axis title
    const secondLayer = spec.layer![1];
    expect(secondLayer.encoding!.y!.axis).toBeDefined();
    expect(secondLayer.encoding!.y!.axis!.title).toBe('Percentage');
  });
});

// =============================================================================
// Type-specific chart handling
// =============================================================================

describe('configToSpec - waterfall chart', () => {
  it('should produce a layered spec for waterfall', () => {
    const config = makeConfig({ type: 'waterfall' });
    const spec = configToSpec(config, SINGLE_SERIES_DATA);
    expect(spec.layer).toBeDefined();
    expect(spec.layer!.length).toBeGreaterThanOrEqual(1);
  });

  it('should use waterfall colors from config', () => {
    const config = makeConfig({
      type: 'waterfall',
      waterfall: {
        increaseColor: '#00ff00',
        decreaseColor: '#ff0000',
        totalColor: '#0000ff',
      },
    });
    const spec = configToSpec(config, SINGLE_SERIES_DATA);
    const mainLayer = spec.layer![0];
    const colorScale = mainLayer.encoding!.color!.scale as { range: string[] };
    expect(colorScale.range).toEqual(['#00ff00', '#ff0000', '#0000ff']);
  });

  it('should have default waterfall colors when not specified', () => {
    const config = makeConfig({ type: 'waterfall' });
    const spec = configToSpec(config, SINGLE_SERIES_DATA);
    const mainLayer = spec.layer![0];
    expect(mainLayer.encoding!.color).toBeDefined();
  });

  it('keeps buildWaterfallLayers available from the compatibility import path', () => {
    const config = makeConfig({ type: 'waterfall' });
    const rows = chartDataToRows(SINGLE_SERIES_DATA, config);
    const layers = buildWaterfallLayers(config, SINGLE_SERIES_DATA, rows);

    expect(layers.length).toBeGreaterThan(0);
    expect(layers[0].mark).toBeDefined();
  });
});

describe('buildWaterfallTransforms', () => {
  it('should return calculate transform for running total', () => {
    const transforms = buildWaterfallTransforms();
    expect(transforms.length).toBeGreaterThan(0);
    // Should have a calculate transform
    const calc = transforms.find((t) => 'calculate' in t);
    expect(calc).toBeDefined();
  });
});

describe('configToSpec - stock chart', () => {
  it('should produce a layered spec for stock charts', () => {
    const config = makeConfig({ type: 'stock' });
    const spec = configToSpec(config, STOCK_SERIES_DATA);
    expect(spec.layer).toBeDefined();
    expect(spec.layer!).toHaveLength(1);
  });

  it('should have a stock glyph layer for HLC charts', () => {
    const config = makeConfig({ type: 'stock', subType: 'hlc' });
    const spec = configToSpec(config, STOCK_SERIES_DATA);
    const markTypes = spec.layer!.map((l) => (l.mark as MarkSpec).type);
    expect(markTypes).toEqual(['stockGlyph']);
    expect(spec.layer![0].mark).toEqual(
      expect.objectContaining({ type: 'stockGlyph', stockSubType: 'hlc' }),
    );
  });
});

describe('buildStockLayers', () => {
  it('should produce one HLC stock glyph layer', () => {
    const config = makeConfig({ type: 'stock', subType: 'hlc' });
    const layers = buildStockLayers(config, STOCK_SERIES_DATA, []);
    expect(layers).toHaveLength(1);
    expect(layers[0].mark).toEqual(
      expect.objectContaining({ type: 'stockGlyph', stockSubType: 'hlc' }),
    );
  });
});

describe('configToSpec - funnel chart', () => {
  it('should produce a rect layer for funnel', () => {
    const config = makeConfig({ type: 'funnel' });
    const spec = configToSpec(config, SINGLE_SERIES_DATA);
    const mark = spec.layer?.[0]?.mark as MarkSpec;
    expect(mark.type).toBe('rect');
  });
});

describe('configToSpec - radar verification', () => {
  it('should produce a native radar mark for basic radar', () => {
    const config = makeConfig({ type: 'radar' });
    const spec = configToSpec(config, SINGLE_SERIES_DATA);
    const mark = spec.mark as MarkSpec;
    expect(mark.type).toBe('radar');
  });

  it('should produce a filled native radar mark', () => {
    const config = makeConfig({ type: 'radar', radarFilled: true });
    const spec = configToSpec(config, SINGLE_SERIES_DATA);
    const mark = spec.mark as MarkSpec;
    expect(mark.type).toBe('radar');
    expect(mark.fillOpacity).toBeGreaterThan(0);
  });

  it('should add markers for radar with radarMarkers', () => {
    const config = makeConfig({ type: 'radar', radarMarkers: true });
    const spec = configToSpec(config, SINGLE_SERIES_DATA);
    const mark = spec.mark as MarkSpec;
    expect(mark.point).toBe(true);
  });
});

// =============================================================================
// Round-trip tests for all ChartType values
// =============================================================================

describe('configToSpec - comprehensive round-trip', () => {
  const allChartTypes: ChartType[] = [
    'bar',
    'column',
    'line',
    'area',
    'pie',
    'doughnut',
    'scatter',
    'bubble',
    'combo',
    'radar',
    'stock',
    'funnel',
    'waterfall',
  ];

  it.each(allChartTypes)('should produce a compilable spec for %s chart', (chartType) => {
    const data = chartType === 'combo' ? MULTI_SERIES_DATA : SINGLE_SERIES_DATA;
    const config = makeConfig({ type: chartType });
    const spec = configToSpec(config, data);
    const result = compile(spec, undefined, { width: 600, height: 400 });

    expect(result).toBeDefined();
    expect(result.marks).toBeDefined();
    expect(Array.isArray(result.marks)).toBe(true);
  });

  // SubType variants
  const subTypeVariants: [ChartType, string][] = [
    ['bar', 'stacked'],
    ['bar', 'percentStacked'],
    ['bar', 'clustered'],
    ['column', 'stacked'],
    ['line', 'smooth'],
    ['line', 'stepped'],
    ['line', 'stacked'],
    ['area', 'stacked'],
    ['area', 'percentStacked'],
    ['radar', 'filled'],
  ];

  it.each(subTypeVariants)(
    'should produce a compilable spec for %s chart with subType=%s',
    (chartType, subType) => {
      const config = makeConfig({
        type: chartType,
        subType: subType as ChartConfig['subType'],
      });
      const spec = configToSpec(config, SINGLE_SERIES_DATA);
      const result = compile(spec, undefined, { width: 600, height: 400 });

      expect(result).toBeDefined();
      expect(result.marks).toBeDefined();
      expect(Array.isArray(result.marks)).toBe(true);
    },
  );

  it('should compile a scatter chart with trendline', () => {
    const config = makeConfig({
      type: 'scatter',
      trendline: { show: true, type: 'linear' },
    });
    const spec = configToSpec(config, SINGLE_SERIES_DATA);
    const result = compile(spec, undefined, { width: 600, height: 400 });
    expect(result).toBeDefined();
    expect(result.marks).toBeDefined();
  });

  it('should compile a scatter chart with showLines and smoothLines', () => {
    const config = makeConfig({
      type: 'scatter',
      showLines: true,
      smoothLines: true,
    });
    const spec = configToSpec(config, SINGLE_SERIES_DATA);
    const result = compile(spec, undefined, { width: 600, height: 400 });
    expect(result).toBeDefined();
    expect(result.marks).toBeDefined();
  });

  it('should compile a doughnut chart with pieSlice config', () => {
    const config = makeConfig({
      type: 'doughnut',
      pieSlice: { explodeOffset: 0.05 },
    });
    const spec = configToSpec(config, SINGLE_SERIES_DATA);
    const result = compile(spec, undefined, { width: 400, height: 400 });
    expect(result).toBeDefined();
    expect(result.marks).toBeDefined();
  });

  it('should compile a combo chart with mixed types', () => {
    const config = makeConfig({
      type: 'combo',
      series: [
        { type: 'bar', color: '#ff0000' },
        { type: 'line', color: '#0000ff', lineWidth: 3 },
      ],
    });
    const spec = configToSpec(config, MULTI_SERIES_DATA);
    const result = compile(spec, undefined, { width: 600, height: 400 });
    expect(result).toBeDefined();
    expect(result.marks).toBeDefined();
  });

  it('should compile a chart with custom colors', () => {
    const config = makeConfig({
      type: 'bar',
      colors: ['#ff0000', '#00ff00', '#0000ff'],
    });
    const spec = configToSpec(config, MULTI_SERIES_DATA);
    const result = compile(spec, undefined, { width: 600, height: 400 });
    expect(result).toBeDefined();
    expect(result.marks).toBeDefined();
  });

  it('should compile a chart with axis config, legend, and title', () => {
    const config = makeConfig({
      type: 'line',
      title: 'Test Chart',
      subtitle: 'Subtitle',
      axis: {
        xAxis: { type: 'category', title: 'X', gridLines: true },
        yAxis: { type: 'value', title: 'Y', gridLines: false, min: 0, max: 100 },
      },
      legend: { show: true, position: 'right' },
    });
    const spec = configToSpec(config, MULTI_SERIES_DATA);
    const result = compile(spec, undefined, { width: 600, height: 400 });
    expect(result).toBeDefined();
    expect(result.marks).toBeDefined();
    expect(result.axes.length).toBeGreaterThan(0);
  });

  it('should compile a chart with data labels', () => {
    const config = makeConfig({
      type: 'bar',
      dataLabels: { show: true },
    });
    const spec = configToSpec(config, SINGLE_SERIES_DATA);
    const result = compile(spec, undefined, { width: 600, height: 400 });
    expect(result).toBeDefined();
    expect(result.marks).toBeDefined();
  });
});

// =============================================================================
// Round-trip mark verification for all 12 chart types
// =============================================================================

describe('configToSpec -> compile round-trip: mark verification', () => {
  // Helper: create multi-series data with more categories for richer tests
  function makeRichData(seriesCount = 2): ChartData {
    const categories = ['Q1', 'Q2', 'Q3', 'Q4'];
    const series = [];
    for (let i = 0; i < seriesCount; i++) {
      series.push({
        name: `Series ${i + 1}`,
        data: categories.map((cat, j) => ({
          x: cat,
          y: (j + 1) * 10 * (i + 1),
          name: cat,
        })),
      });
    }
    return { categories, series };
  }

  const richSingle = makeRichData(1);
  const richMulti = makeRichData(3);
  const xySingle: ChartData = {
    categories: [1, 2, 10],
    series: [
      {
        name: 'Series 1',
        data: [
          { x: 1, y: 10, size: 5, name: '1' },
          { x: 2, y: 20, size: 10, name: '2' },
          { x: 10, y: 30, size: 15, name: '10' },
        ],
      },
    ],
  };

  // --- bar variants ---

  it('bar (clustered): produces bar-type marks', () => {
    const config = makeConfig({ type: 'bar', subType: 'clustered' });
    const spec = configToSpec(config, richMulti);
    const result = compile(spec, undefined, { width: 600, height: 400 });
    expect(result.marks.length).toBeGreaterThan(0);
    expect(result.marks.every((m) => m.type === 'rect')).toBe(true);
  });

  it('bar (stacked): produces rect marks', () => {
    const config = makeConfig({ type: 'bar', subType: 'stacked' });
    const spec = configToSpec(config, richMulti);
    const result = compile(spec, undefined, { width: 600, height: 400 });
    expect(result.marks.length).toBeGreaterThan(0);
    expect(result.marks.every((m) => m.type === 'rect')).toBe(true);
  });

  it('bar (percentStacked): produces rect marks', () => {
    const config = makeConfig({ type: 'bar', subType: 'percentStacked' });
    const spec = configToSpec(config, richMulti);
    const result = compile(spec, undefined, { width: 600, height: 400 });
    expect(result.marks.length).toBeGreaterThan(0);
    expect(result.marks.every((m) => m.type === 'rect')).toBe(true);
  });

  // --- column variants ---

  it('column (clustered): produces rect marks (vertical bars)', () => {
    const config = makeConfig({ type: 'column', subType: 'clustered' });
    const spec = configToSpec(config, richSingle);
    const result = compile(spec, undefined, { width: 600, height: 400 });
    expect(result.marks.length).toBeGreaterThan(0);
    expect(result.marks.every((m) => m.type === 'rect')).toBe(true);
  });

  it('column (stacked): produces rect marks', () => {
    const config = makeConfig({ type: 'column', subType: 'stacked' });
    const spec = configToSpec(config, richMulti);
    const result = compile(spec, undefined, { width: 600, height: 400 });
    expect(result.marks.length).toBeGreaterThan(0);
    expect(result.marks.every((m) => m.type === 'rect')).toBe(true);
  });

  it('column (percentStacked): produces rect marks', () => {
    const config = makeConfig({ type: 'column', subType: 'percentStacked' });
    const spec = configToSpec(config, richMulti);
    const result = compile(spec, undefined, { width: 600, height: 400 });
    expect(result.marks.length).toBeGreaterThan(0);
    expect(result.marks.every((m) => m.type === 'rect')).toBe(true);
  });

  // --- line variants ---

  it('line (straight): produces path marks', () => {
    const config = makeConfig({ type: 'line' });
    const spec = configToSpec(config, richSingle);
    const result = compile(spec, undefined, { width: 600, height: 400 });
    expect(result.marks.length).toBeGreaterThan(0);
    expect(result.marks.some((m) => m.type === 'path')).toBe(true);
  });

  it('line (smooth): produces path marks', () => {
    const config = makeConfig({ type: 'line', subType: 'smooth' });
    const spec = configToSpec(config, richSingle);
    const result = compile(spec, undefined, { width: 600, height: 400 });
    expect(result.marks.length).toBeGreaterThan(0);
    expect(result.marks.some((m) => m.type === 'path')).toBe(true);
  });

  it('line (stepped): produces path marks', () => {
    const config = makeConfig({ type: 'line', subType: 'stepped' });
    const spec = configToSpec(config, richSingle);
    const result = compile(spec, undefined, { width: 600, height: 400 });
    expect(result.marks.length).toBeGreaterThan(0);
    expect(result.marks.some((m) => m.type === 'path')).toBe(true);
  });

  it('line (stacked): produces path marks', () => {
    const config = makeConfig({ type: 'line', subType: 'stacked' });
    const spec = configToSpec(config, richMulti);
    const result = compile(spec, undefined, { width: 600, height: 400 });
    expect(result.marks.length).toBeGreaterThan(0);
    expect(result.marks.some((m) => m.type === 'path')).toBe(true);
  });

  it('line (percentStacked): produces path marks', () => {
    const config = makeConfig({ type: 'line', subType: 'percentStacked' });
    const spec = configToSpec(config, richMulti);
    const result = compile(spec, undefined, { width: 600, height: 400 });
    expect(result.marks.length).toBeGreaterThan(0);
    expect(result.marks.some((m) => m.type === 'path')).toBe(true);
  });

  // --- area variants ---

  it('area (standard): produces path marks', () => {
    const config = makeConfig({ type: 'area' });
    const spec = configToSpec(config, richSingle);
    const result = compile(spec, undefined, { width: 600, height: 400 });
    expect(result.marks.length).toBeGreaterThan(0);
    expect(result.marks.some((m) => m.type === 'path')).toBe(true);
  });

  it('area (stacked): produces path marks', () => {
    const config = makeConfig({ type: 'area', subType: 'stacked' });
    const spec = configToSpec(config, richMulti);
    const result = compile(spec, undefined, { width: 600, height: 400 });
    expect(result.marks.length).toBeGreaterThan(0);
    expect(result.marks.some((m) => m.type === 'path')).toBe(true);
  });

  it('area (percentStacked): produces path marks', () => {
    const config = makeConfig({ type: 'area', subType: 'percentStacked' });
    const spec = configToSpec(config, richMulti);
    const result = compile(spec, undefined, { width: 600, height: 400 });
    expect(result.marks.length).toBeGreaterThan(0);
    expect(result.marks.some((m) => m.type === 'path')).toBe(true);
  });

  // --- pie ---

  it('pie: produces arc marks', () => {
    const config = makeConfig({ type: 'pie' });
    const spec = configToSpec(config, richSingle);
    const result = compile(spec, undefined, { width: 400, height: 400 });
    expect(result.marks.length).toBeGreaterThan(0);
    expect(result.marks.every((m) => m.type === 'arc')).toBe(true);
  });

  // --- doughnut ---

  it('doughnut: produces arc marks with innerRadius > 0', () => {
    const config = makeConfig({ type: 'doughnut' });
    const spec = configToSpec(config, richSingle);
    const result = compile(spec, undefined, { width: 400, height: 400 });
    expect(result.marks.length).toBeGreaterThan(0);
    expect(result.marks.every((m) => m.type === 'arc')).toBe(true);
    // Arc marks should have positive innerRadius for doughnut
    for (const m of result.marks) {
      if (m.type === 'arc') {
        expect((m as { innerRadius: number }).innerRadius).toBeGreaterThan(0);
      }
    }
  });

  // --- scatter ---

  it('scatter: produces symbol marks', () => {
    const config = makeConfig({ type: 'scatter' });
    const spec = configToSpec(config, xySingle);
    const result = compile(spec, undefined, { width: 600, height: 400 });
    expect(result.marks.length).toBeGreaterThan(0);
    expect(result.marks.every((m) => m.type === 'symbol')).toBe(true);
  });

  // --- bubble ---

  it('bubble: produces symbol marks', () => {
    const config = makeConfig({ type: 'bubble' });
    const spec = configToSpec(config, xySingle);
    const result = compile(spec, undefined, { width: 600, height: 400 });
    expect(result.marks.length).toBeGreaterThan(0);
    expect(result.marks.every((m) => m.type === 'symbol')).toBe(true);
  });

  // --- combo ---

  it('combo: produces marks from all layers (bar + line)', () => {
    const config = makeConfig({
      type: 'combo',
      series: [
        { type: 'bar', color: '#ff0000' },
        { type: 'line', color: '#0000ff' },
      ],
    });
    const spec = configToSpec(config, richMulti);
    const result = compile(spec, undefined, { width: 600, height: 400 });
    expect(result.marks.length).toBeGreaterThan(0);
    // Should have both rect (bar) and path (line) marks
    const markTypes = new Set(result.marks.map((m) => m.type));
    expect(markTypes.has('rect')).toBe(true);
    expect(markTypes.has('path')).toBe(true);
  });

  it('combo: with 3 series produces marks from all layers', () => {
    const config = makeConfig({
      type: 'combo',
      series: [{ type: 'bar' }, { type: 'line' }, { type: 'area' }],
    });
    const spec = configToSpec(config, richMulti);
    const result = compile(spec, undefined, { width: 600, height: 400 });
    expect(result.marks.length).toBeGreaterThan(0);
    // Multiple mark types should be present
    const markTypes = new Set(result.marks.map((m) => m.type));
    expect(markTypes.size).toBeGreaterThanOrEqual(2);
  });

  // --- radar variants ---

  it('radar (basic): produces path marks', () => {
    const config = makeConfig({ type: 'radar' });
    const spec = configToSpec(config, richSingle);
    const result = compile(spec, undefined, { width: 400, height: 400 });
    expect(result.marks.length).toBeGreaterThan(0);
    expect(result.marks.some((m) => m.type === 'path')).toBe(true);
  });

  it('radar (filled): produces path marks (area fill)', () => {
    const config = makeConfig({ type: 'radar', radarFilled: true });
    const spec = configToSpec(config, richSingle);
    const result = compile(spec, undefined, { width: 400, height: 400 });
    expect(result.marks.length).toBeGreaterThan(0);
    expect(result.marks.some((m) => m.type === 'path')).toBe(true);
  });

  // --- stock variants ---

  it('stock (hlc): produces marks from layered spec', () => {
    const config = makeConfig({ type: 'stock', subType: 'hlc' });
    const spec = configToSpec(config, STOCK_SERIES_DATA);
    const result = compile(spec, undefined, { width: 600, height: 400 });
    expect(result.marks.length).toBeGreaterThan(0);
  });

  it('stock (ohlc): produces marks from layered spec', () => {
    const config = makeConfig({ type: 'stock', subType: 'ohlc' });
    const spec = configToSpec(config, STOCK_SERIES_DATA);
    const result = compile(spec, undefined, { width: 600, height: 400 });
    expect(result.marks.length).toBeGreaterThan(0);
  });

  // --- waterfall ---

  it('waterfall: produces rect marks from layered spec', () => {
    const config = makeConfig({ type: 'waterfall' });
    const spec = configToSpec(config, richSingle);
    const result = compile(spec, undefined, { width: 600, height: 400 });
    expect(result.marks.length).toBeGreaterThan(0);
    expect(result.marks.some((m) => m.type === 'rect')).toBe(true);
  });

  it('waterfall with custom colors: compiles correctly', () => {
    const config = makeConfig({
      type: 'waterfall',
      waterfall: {
        increaseColor: '#00ff00',
        decreaseColor: '#ff0000',
        totalColor: '#0000ff',
        totalIndices: [3],
      },
    });
    const spec = configToSpec(config, richSingle);
    const result = compile(spec, undefined, { width: 600, height: 400 });
    expect(result.marks.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// Verify chart-engine.ts wiring
// =============================================================================

describe('chart-engine configToSpec wiring', () => {
  it('should re-export configToSpec from chart-engine that matches config-to-spec', () => {
    // The chart-engine module should delegate to the comprehensive implementation
    const { configToSpec: engineConfigToSpec } = require('../../src/core/chart-engine');
    const config = makeConfig({ type: 'bar', title: 'Wiring Test' });
    const spec = engineConfigToSpec(config, SINGLE_SERIES_DATA);

    // Should produce the comprehensive spec (not the old lossy one)
    expect(spec.encoding!.x!.type).toBe('quantitative');
    expect(spec.encoding!.y!.type).toBe('nominal');
    expect(spec.title).toBe('Wiring Test'); // string title (no subtitle)
  });

  it('should produce the same result from both import paths', () => {
    const { configToSpec: engineConfigToSpec } = require('../../src/core/chart-engine');
    const config = makeConfig({
      type: 'pie',
      title: 'Pie Test',
      legend: { show: true, position: 'right' },
    });

    const specFromEngine = engineConfigToSpec(config, SINGLE_SERIES_DATA);
    const specFromDirect = configToSpec(config, SINGLE_SERIES_DATA);

    expect(specFromEngine).toEqual(specFromDirect);
  });
});

// =============================================================================
// configToSpec Dropped Fields Tests
// =============================================================================

describe('configToSpec dropped fields', () => {
  describe('axis type -> encoding scale type', () => {
    it('maps log axis type to log scale type on y-axis', () => {
      const config = makeConfig({
        axis: {
          yAxis: { type: 'log', gridLines: true },
        },
      });

      const encoding = buildEncoding(config, SINGLE_SERIES_DATA);

      expect(encoding.y?.scale).toBeDefined();
      expect(encoding.y!.scale!.type).toBe('log');
    });

    it('maps time axis type to time scale type on x-axis', () => {
      const config = makeConfig({
        axis: {
          xAxis: { type: 'time' },
        },
      });

      const encoding = buildEncoding(config, SINGLE_SERIES_DATA);

      expect(encoding.x?.scale).toBeDefined();
      expect(encoding.x!.scale!.type).toBe('time');
    });

    it('does not set explicit scale type for category/value axis types', () => {
      const config = makeConfig({
        type: 'line',
        axis: {
          xAxis: { type: 'category' },
          yAxis: { type: 'value' },
        },
      });

      const encoding = buildEncoding(config, SINGLE_SERIES_DATA);

      // Default category/value axis types should not force an explicit scale type.
      expect(encoding.x?.scale?.type).toBeUndefined();
      expect(encoding.y?.scale?.type).toBeUndefined();
    });

    it('combines log scale type with domain min/max', () => {
      const config = makeConfig({
        axis: {
          yAxis: { type: 'log', min: 1, max: 1000 },
        },
      });

      const encoding = buildEncoding(config, SINGLE_SERIES_DATA);

      expect(encoding.y?.scale).toBeDefined();
      expect(encoding.y!.scale!.type).toBe('log');
      expect(encoding.y!.scale!.domain).toEqual([1, 1000]);
    });
  });

  describe('dataLabels.position and format', () => {
    it('maps format string to text channel format', () => {
      const rows = chartDataToRows(
        SINGLE_SERIES_DATA,
        makeConfig({
          type: 'column',
          dataLabels: { show: true, format: '0.00' },
        }),
      );

      expect(rows[0][DATA_LABEL_TEXT_FIELD]).toBe('10.00');
    });

    it('maps top position to negative baseline offset', () => {
      const rows = chartDataToRows(
        SINGLE_SERIES_DATA,
        makeConfig({
          type: 'column',
          dataLabels: { show: true, position: 'top' },
        }),
      );

      expect(rows[0][DATA_LABEL_DY_FIELD]).toBe(-10);
      expect(rows[0][DATA_LABEL_BASELINE_FIELD]).toBe('bottom');
    });

    it('maps inside position without offset', () => {
      const rows = chartDataToRows(
        SINGLE_SERIES_DATA,
        makeConfig({
          type: 'column',
          dataLabels: { show: true, position: 'inside' },
        }),
      );

      expect(rows[0][DATA_LABEL_DY_FIELD]).toBe(0);
      expect(rows[0][DATA_LABEL_BASELINE_FIELD]).toBe('middle');
    });

    it('maps pie bestFit labels onto the slice instead of outside', () => {
      const rows = chartDataToRows(
        SINGLE_SERIES_DATA,
        makeConfig({
          type: 'doughnut',
          dataLabels: {
            show: true,
            position: 'bestFit',
            showCategoryName: true,
            showPercentage: true,
          },
        }),
      );

      expect(rows[0][DATA_LABEL_DY_FIELD]).toBe(0);
      expect(rows[0][DATA_LABEL_BASELINE_FIELD]).toBe('middle');
      expect(typeof rows[0][DATA_LABEL_X_FIELD]).toBe('number');
      expect(typeof rows[0][DATA_LABEL_Y_FIELD]).toBe('number');
    });

    it('scales wide pie data labels from the pie radius, not plot width', () => {
      const data: ChartData = {
        categories: ['A', 'B', 'C', 'D'],
        series: [
          {
            name: 'Slices',
            data: [
              { x: 'A', y: 10 },
              { x: 'B', y: 10 },
              { x: 'C', y: 10 },
              { x: 'D', y: 10 },
            ],
          },
        ],
      };
      const spec = configToSpec(
        makeConfig({
          type: 'doughnut',
          width: 20,
          height: 10,
          dataLabels: {
            show: true,
            position: 'bestFit',
            showCategoryName: true,
            showPercentage: true,
          },
        }),
        data,
      );

      expect(
        spec.layer?.some(
          (layer) =>
            typeof layer.mark === 'object' &&
            layer.mark.type === 'text' &&
            layer.mark.coordinateSystem === 'plotRadiusFraction',
        ),
      ).toBe(true);

      const result = compile(spec, undefined, {
        skipAxes: true,
        skipLegend: true,
        skipTitle: true,
      });
      const arc = result.marks.find((mark): mark is ArcMark => mark.type === 'arc');
      const labels = result.marks.filter((mark): mark is TextMark => mark.type === 'text');

      expect(arc).toBeDefined();
      expect(labels).toHaveLength(data.categories.length);
      const maxLabelDistance = Math.max(
        ...labels.map((label) => Math.hypot(label.x - arc!.x, label.y - arc!.y)),
      );
      expect(maxLabelDistance).toBeLessThan(arc!.outerRadius * 0.9);
    });
  });

  describe('trendline showEquation/showR2/period', () => {
    it('attaches showEquation metadata to regression transform', () => {
      const transforms = buildTrendlineTransform({
        show: true,
        type: 'linear',
        showEquation: true,
      });

      expect(transforms).toHaveLength(1);
      const ext = transforms[0] as unknown as Record<string, unknown>;
      expect(ext._showEquation).toBe(true);
    });

    it('attaches showR2 metadata to regression transform', () => {
      const transforms = buildTrendlineTransform({
        show: true,
        type: 'polynomial',
        order: 3,
        showR2: true,
      });

      expect(transforms).toHaveLength(1);
      const ext = transforms[0] as unknown as Record<string, unknown>;
      expect(ext._showR2).toBe(true);
    });

    it('attaches moving average period metadata', () => {
      const transforms = buildTrendlineTransform({
        show: true,
        type: 'moving-average',
        period: 5,
      });

      expect(transforms).toHaveLength(1);
      const ext = transforms[0] as unknown as Record<string, unknown>;
      expect(ext._movingAveragePeriod).toBe(5);
    });
  });

  describe('pieSlice explodedIndex/explodedIndices', () => {
    it('attaches explodedIndex metadata to pie mark', () => {
      const config = makeConfig({
        type: 'pie',
        pieSlice: { explodedIndex: 2, explodeOffset: 0.1 },
      });

      const mark = buildMark(config);

      expect(typeof mark).toBe('object');
      const ext = mark as unknown as Record<string, unknown>;
      expect(ext._explodedIndex).toBe(2);
    });

    it('attaches explodedIndices metadata to doughnut mark', () => {
      const config = makeConfig({
        type: 'doughnut',
        pieSlice: { explodedIndices: [0, 3], explodeOffset: 0.15 },
      });

      const mark = buildMark(config);

      expect(typeof mark).toBe('object');
      const ext = mark as unknown as Record<string, unknown>;
      expect(ext._explodedIndices).toEqual([0, 3]);
    });
  });

  describe('stock sub-types', () => {
    const stockData: ChartData = {
      categories: ['Day1', 'Day2'],
      series: [
        {
          name: 'Stock',
          data: [
            { x: 'Day1', y: 100, open: 95, high: 110, low: 90, close: 105 } as any,
            { x: 'Day2', y: 102, open: 105, high: 115, low: 98, close: 108 } as any,
          ],
        },
      ],
    };

    function pathCoordinates(mark: PathMark): [number, number, number, number] {
      const values = mark.path.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
      expect(values).toHaveLength(4);
      return values as [number, number, number, number];
    }

    function samePath(
      coordinates: [number, number, number, number],
      segment: { x1: number; y1: number; x2: number; y2: number },
    ): boolean {
      return (
        coordinates[0] === segment.x1 &&
        coordinates[1] === segment.y1 &&
        coordinates[2] === segment.x2 &&
        coordinates[3] === segment.y2
      );
    }

    it('creates an HLC stock glyph layer for hlc sub-type', () => {
      const config = makeConfig({ type: 'stock', subType: 'hlc' });
      const rows = [{ category: 'Day1', high: 110, low: 90, close: 105 }];

      const layers = buildStockLayers(config, stockData, rows);

      expect(layers.length).toBe(1);
      expect(layers[0].mark).toEqual(
        expect.objectContaining({ type: 'stockGlyph', stockSubType: 'hlc' }),
      );
    });

    it('renders HLC high-low wicks from high to low instead of full-height rules', () => {
      const config = makeConfig({ type: 'stock', subType: 'hlc' });
      const result = compile(configToSpec(config, stockData), undefined, {
        skipAxes: true,
        skipLegend: true,
        skipTitle: true,
      });
      const paths = result.marks.filter((mark): mark is PathMark => mark.type === 'path');
      const [, highY, , lowY] = pathCoordinates(paths[0]);
      const expectedLowY = result.scales.y!(90) as number;
      const expectedHighY = result.scales.y!(110) as number;

      expect(Math.abs(lowY - expectedLowY)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(highY - expectedHighY)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(lowY - highY)).toBeGreaterThan(0);
      expect(Math.abs(lowY - highY)).toBeLessThan(result.layout.plotArea.height);
    });

    it('creates an OHLC stock glyph layer for ohlc sub-type', () => {
      const config = makeConfig({ type: 'stock', subType: 'ohlc' });
      const rows = [{ category: 'Day1', open: 95, high: 110, low: 90, close: 105 }];

      const layers = buildStockLayers(config, stockData, rows);

      expect(layers.length).toBe(1);
      expect(layers[0].mark).toEqual(
        expect.objectContaining({ type: 'stockGlyph', stockSubType: 'ohlc' }),
      );
    });

    it('renders OHLC open and close ticks on the same value scale', () => {
      const config = makeConfig({ type: 'stock', subType: 'ohlc' });
      const result = compile(configToSpec(config, stockData), undefined, {
        skipAxes: true,
        skipLegend: true,
        skipTitle: true,
      });
      const paths = result.marks.filter((mark): mark is PathMark => mark.type === 'path');
      const glyphPoint = result.stockGlyphTrace?.points[0];
      const openTick = paths.find((path) =>
        glyphPoint?.openTick ? samePath(pathCoordinates(path), glyphPoint.openTick) : false,
      );
      const closeTick = paths.find((path) =>
        glyphPoint?.closeTick ? samePath(pathCoordinates(path), glyphPoint.closeTick) : false,
      );
      expect(openTick).toBeDefined();
      expect(closeTick).toBeDefined();
      const [openX1, openY, openX2, openY2] = pathCoordinates(openTick!);
      const [closeX1, closeY, closeX2, closeY2] = pathCoordinates(closeTick!);

      expect(openY).toBeCloseTo(glyphPoint!.openTick!.y1);
      expect(closeY).toBeCloseTo(glyphPoint!.closeTick!.y1);
      expect(openY2).toBe(openY);
      expect(closeY2).toBe(closeY);
      expect(openX1).toBeLessThan(openX2);
      expect(closeX1).toBeLessThan(closeX2);
    });

    it('adds volume geometry to the stock glyph for volume-ohlc sub-type', () => {
      const config = makeConfig({ type: 'stock', subType: 'volume-ohlc' as any });
      const rows = [{ category: 'Day1', open: 95, high: 110, low: 90, close: 105, volume: 1000 }];

      const layers = buildStockLayers(config, stockData, rows);

      expect(layers.length).toBe(1);
      expect(layers[0].mark).toEqual(
        expect.objectContaining({
          type: 'stockGlyph',
          stockSubType: 'volume-ohlc',
          stockVolumeField: STOCK_VOLUME_FIELD,
        }),
      );
    });

    it('uses an independent hidden volume y-scale for volume stock charts', () => {
      const config = makeConfig({ type: 'stock', subType: 'volume-ohlc' as any });
      const data: ChartData = {
        categories: ['Day1'],
        series: [
          {
            name: 'Stock',
            data: [
              {
                x: 'Day1',
                y: 105,
                [STOCK_OPEN_FIELD]: 95,
                [STOCK_HIGH_FIELD]: 110,
                [STOCK_LOW_FIELD]: 90,
                [STOCK_CLOSE_FIELD]: 105,
                [STOCK_VOLUME_FIELD]: 1_000_000,
              },
            ],
          },
        ],
      };

      const spec = configToSpec(config, data) as LayerSpec;

      expect(spec.resolve).toEqual({
        scale: { y: 'independent' },
        axis: { y: 'independent' },
      });
      expect(spec.layer[0]?.encoding?.y).toMatchObject({
        field: STOCK_HIGH_LOW_MIN_FIELD,
        type: 'quantitative',
        axis: { tickStep: 5 },
        scale: { domain: [90, 115], zero: false, nice: false },
      });
    });

    it('keeps volume stock OHLC wicks and bodies on the price scale', () => {
      const data: ChartData = {
        categories: ['Day1', 'Day2'],
        series: [
          {
            name: 'Stock',
            data: [
              {
                x: 'Day1',
                y: 105,
                [STOCK_OPEN_FIELD]: 95,
                [STOCK_HIGH_FIELD]: 110,
                [STOCK_LOW_FIELD]: 90,
                [STOCK_CLOSE_FIELD]: 105,
                [STOCK_VOLUME_FIELD]: 1_000_000,
              },
              {
                x: 'Day2',
                y: 108,
                [STOCK_OPEN_FIELD]: 105,
                [STOCK_HIGH_FIELD]: 115,
                [STOCK_LOW_FIELD]: 98,
                [STOCK_CLOSE_FIELD]: 108,
                [STOCK_VOLUME_FIELD]: 750_000,
              },
            ],
          },
        ],
      };
      const withVolume = compile(
        configToSpec(makeConfig({ type: 'stock', subType: 'volume-ohlc' as any }), data),
        undefined,
        {
          skipAxes: true,
          skipLegend: true,
          skipTitle: true,
        },
      );
      const volumePaths = withVolume.marks.filter((mark): mark is PathMark => mark.type === 'path');
      const [, highY, , lowY] = pathCoordinates(volumePaths[0]);
      const [, openY] = pathCoordinates(volumePaths[1]);
      const [, closeY] = pathCoordinates(volumePaths[2]);

      expect(lowY).toBeGreaterThan(highY);
      expect(openY).toBeLessThan(lowY);
      expect(closeY).toBeGreaterThan(highY);
      expect(Math.abs(lowY - highY)).toBeGreaterThan(5);
      expect(Math.abs(openY - closeY)).toBeGreaterThan(2);
    });

    it('adds volume geometry to the stock glyph for volume-hlc sub-type', () => {
      const config = makeConfig({ type: 'stock', subType: 'volume-hlc' as any });
      const rows = [{ category: 'Day1', high: 110, low: 90, close: 105, volume: 1000 }];

      const layers = buildStockLayers(config, stockData, rows);

      expect(layers.length).toBe(1);
      expect(layers[0].mark).toEqual(
        expect.objectContaining({
          type: 'stockGlyph',
          stockSubType: 'volume-hlc',
          stockVolumeField: STOCK_VOLUME_FIELD,
        }),
      );
    });
  });
});
