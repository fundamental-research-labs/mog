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
  buildWaterfallTransforms,
  chartDataToRows,
  configToSpec,
  hasSecondaryYAxis,
  resolveStackMode,
  resolveSubTypeMarkProps,
} from '../../src/core/config-to-spec';
import { collectMarks } from '../../src/core/chart-engine';
import { formatTickValue } from '../../src/grammar/axis-generator';
import { compile } from '../../src/grammar/compiler';
import type { EncodingSpec, MarkSpec } from '../../src/grammar/spec';
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
    width: 8,
    height: 15,
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

// =============================================================================
// chartDataToRows
// =============================================================================

describe('chartDataToRows', () => {
  it('should flatten single series data into rows', () => {
    const rows = chartDataToRows(SINGLE_SERIES_DATA);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ category: 'A', value: 10, series: 'Series 1' });
    expect(rows[1]).toEqual({ category: 'B', value: 20, series: 'Series 1' });
    expect(rows[2]).toEqual({ category: 'C', value: 30, series: 'Series 1' });
  });

  it('should flatten multi-series data interleaved by category', () => {
    const rows = chartDataToRows(MULTI_SERIES_DATA);
    expect(rows).toHaveLength(6);
    // Category A: Series 1, then Series 2
    expect(rows[0]).toEqual({ category: 'A', value: 10, series: 'Series 1' });
    expect(rows[1]).toEqual({ category: 'A', value: 20, series: 'Series 2' });
    // Category B
    expect(rows[2]).toEqual({ category: 'B', value: 20, series: 'Series 1' });
    expect(rows[3]).toEqual({ category: 'B', value: 40, series: 'Series 2' });
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
    expect(rows[0]).toEqual({ category: 'A', value: 10, series: 'Sparse' });
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

    expect(rows).toEqual([
      { category: '26', categoryFormatCode: '"FY3/"0"E"', value: 10, series: 'Forecast' },
      { category: '27', categoryFormatCode: '"FY3/"0"E"', value: 20, series: 'Forecast' },
    ]);
  });
});

// =============================================================================
// Mark Type Mapping
// =============================================================================

describe('buildMark - mark type mapping', () => {
  const simpleMarkTypes: [ChartType, string][] = [
    ['bar', 'bar'],
    ['column', 'bar'],
    ['line', 'line'],
    ['area', 'area'],
    ['scatter', 'point'],
    ['bubble', 'point'],
    ['waterfall', 'bar'],
  ];

  it.each(simpleMarkTypes)('should map %s to mark type %s', (chartType, expectedMark) => {
    const config = makeConfig({ type: chartType });
    const mark = buildMark(config);
    expect(mark).toBe(expectedMark);
  });

  it('should map funnel to bar mark with cornerRadius', () => {
    const config = makeConfig({ type: 'funnel' });
    const mark = buildMark(config) as MarkSpec;
    expect(mark.type).toBe('bar');
    expect(mark.cornerRadius).toBe(2);
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
    expect(mark).toBe('bar');
  });

  it('should map stock to rule as default base mark', () => {
    // Stock charts use rule marks for OHLC ranges
    const config = makeConfig({ type: 'stock' });
    const mark = buildMark(config);
    expect(mark).toBe('rule');
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

    expect(encoding.y?.scale?.domain).toEqual([0, 90]);
  });

  it('uses cumulative stacked totals for horizontal bar value domain', () => {
    const config = makeConfig({ type: 'bar', subType: 'stacked' });
    const encoding = buildEncoding(config, MULTI_SERIES_DATA);

    expect(encoding.x?.scale?.domain).toEqual([0, 90]);
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

  it('should produce x=nominal, y=quantitative for scatter charts', () => {
    const config = makeConfig({ type: 'scatter' });
    const encoding = buildEncoding(config, SINGLE_SERIES_DATA);
    expect(encoding.x!.type).toBe('nominal');
    expect(encoding.y!.type).toBe('quantitative');
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
    expect(encoding.color!.field).toBe('category');
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

  it('should always add color encoding for pie charts (maps to category)', () => {
    const config = makeConfig({ type: 'pie' });
    const encoding = buildEncoding(config, SINGLE_SERIES_DATA);

    expect(encoding.color).toBeDefined();
    expect(encoding.color!.field).toBe('category');
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
        labelAngle: -45,
        crossesAt: 'automatic',
      }),
    );
    expect(encoding.y!.axis).toEqual(
      expect.objectContaining({
        title: null,
        domain: false,
        grid: true,
        gridColor: '#D9D9D9',
        gridWidth: 0.75,
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
        gridWidth: 0.75,
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

  it('should return undefined when no colors and no subType', () => {
    const config = makeConfig({});
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
    expect(shortConfigSpec?.layoutHints?.yAxisLabelWidth).toBeLessThan(62);
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
          format: { font: { size: 9 }, textRotation: -1000 },
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
        labelAngle: -45,
        labelPadding: 14,
      }),
    );
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
        { name: 'Staffing', idx: 0, format: { fill: { type: 'solid', color: { theme: 'accent1' } } } },
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
  it('should set padAngle from pieSlice.explodeOffset', () => {
    const config = makeConfig({
      type: 'pie',
      pieSlice: { explodeOffset: 0.1 },
    });
    const mark = buildMark(config) as MarkSpec;
    expect(mark.type).toBe('arc');
    expect(mark.padAngle).toBe(0.1);
  });

  it('should set innerRadius and padAngle for doughnut with pieSlice', () => {
    const config = makeConfig({
      type: 'doughnut',
      pieSlice: { explodeOffset: 0.05 },
    });
    const mark = buildMark(config) as MarkSpec;
    expect(mark.type).toBe('arc');
    expect(mark.innerRadius).toBe(0.5);
    expect(mark.padAngle).toBe(0.05);
  });
});

// =============================================================================
// Scatter specific
// =============================================================================

describe('buildMark - scatter', () => {
  it('should return point for basic scatter', () => {
    const config = makeConfig({ type: 'scatter' });
    const mark = buildMark(config);
    expect(mark).toBe('point');
  });

  it('should return line with point=true when showLines', () => {
    const config = makeConfig({ type: 'scatter', showLines: true });
    const mark = buildMark(config) as MarkSpec;
    expect(mark.type).toBe('line');
    expect(mark.point).toBe(true);
  });

  it('should return line with monotone interpolation when showLines + smoothLines', () => {
    const config = makeConfig({ type: 'scatter', showLines: true, smoothLines: true });
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
  it('should produce line with linear-closed for basic radar', () => {
    const config = makeConfig({ type: 'radar' });
    const mark = buildMark(config) as MarkSpec;
    expect(mark.type).toBe('line');
    expect(mark.interpolate).toBe('linear-closed');
  });

  it('should produce area with linear-closed for radarFilled', () => {
    const config = makeConfig({ type: 'radar', radarFilled: true });
    const mark = buildMark(config) as MarkSpec;
    expect(mark.type).toBe('area');
    expect(mark.interpolate).toBe('linear-closed');
  });

  it('should add point=true for radarMarkers', () => {
    const config = makeConfig({ type: 'radar', radarMarkers: true });
    const mark = buildMark(config) as MarkSpec;
    expect(mark.point).toBe(true);
  });

  it('should combine radarFilled and radarMarkers', () => {
    const config = makeConfig({ type: 'radar', radarFilled: true, radarMarkers: true });
    const mark = buildMark(config) as MarkSpec;
    expect(mark.type).toBe('area');
    expect(mark.interpolate).toBe('linear-closed');
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
    expect(result!.encoding!.text).toEqual({ field: 'value', type: 'quantitative' });
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
        filter: { field: string; equal: string };
      };
      expect(filterTransform.filter.field).toBe('series');
      expect(filterTransform.filter.equal).toBe(MULTI_SERIES_DATA.series[i].name);
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
    expect(mark.strokeWidth).toBe(3);
    expect(mark.point).toBe(true);
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

    expect(spec.width).toBe(640); // 8 * 80
    expect(spec.height).toBe(300); // 15 * 20
    expect(spec.mark).toBe('bar');
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
    expect(spec.layer!).toHaveLength(2); // main + label layer
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

    expect(spec.transform).toBeDefined();
    expect(spec.transform!.length).toBeGreaterThan(0);
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
    expect(spec.encoding!.color!.legend).toEqual({ orient: 'top', title: null });
  });

  it('should default width/height when not provided', () => {
    const config = makeConfig({ width: 0, height: 0 });
    const spec = configToSpec(config, SINGLE_SERIES_DATA);
    expect(spec.width).toBe(600);
    expect(spec.height).toBe(400);
  });

  it('should produce radar mark with linear-closed interpolation', () => {
    const config = makeConfig({ type: 'radar' });
    const spec = configToSpec(config, SINGLE_SERIES_DATA);
    const mark = spec.mark as MarkSpec;
    expect(mark.type).toBe('line');
    expect(mark.interpolate).toBe('linear-closed');
  });

  it('should produce data label layer in combo chart', () => {
    const config = makeConfig({
      type: 'combo',
      dataLabels: { show: true },
      series: [{ type: 'bar' }],
    });
    const spec = configToSpec(config, SINGLE_SERIES_DATA);
    expect(spec.layer).toBeDefined();
    // At least 1 series layer + 1 data label layer
    const textLayers = spec.layer!.filter((l) => {
      const m = l.mark as MarkSpec;
      return m.type === 'text';
    });
    expect(textLayers.length).toBe(1);
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
    expect((layers[0].mark as MarkSpec).color).toBe('#ff0000');
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
    const mark = layers[0].mark as MarkSpec;
    expect(mark.point).toEqual({ size: 50, filled: true });
  });

  it('should apply lineWidth as strokeWidth', () => {
    const config = makeConfig({
      type: 'combo',
      series: [{ type: 'line', lineWidth: 4 }],
    });
    const layers = buildComboLayers(config, SINGLE_SERIES_DATA, []);
    const mark = layers[0].mark as MarkSpec;
    expect(mark.strokeWidth).toBe(4);
  });

  it('should add data label layer for series with dataLabels.show', () => {
    const config = makeConfig({
      type: 'combo',
      series: [{ type: 'bar', dataLabels: { show: true } }],
    });
    const layers = buildComboLayers(config, SINGLE_SERIES_DATA, []);
    // 1 main layer + 1 data label layer
    expect(layers).toHaveLength(2);
    expect((layers[1].mark as MarkSpec).type).toBe('text');
    expect(layers[1].encoding!.text).toBeDefined();
  });

  it('should NOT add data label layer for series with dataLabels.show=false', () => {
    const config = makeConfig({
      type: 'combo',
      series: [{ type: 'bar', dataLabels: { show: false } }],
    });
    const layers = buildComboLayers(config, SINGLE_SERIES_DATA, []);
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
    const layers = buildComboLayers(config, SINGLE_SERIES_DATA, []);
    // 1 main layer + 1 trendline layer
    expect(layers).toHaveLength(2);
    const trendLayer = layers[1];
    expect((trendLayer.mark as MarkSpec).type).toBe('line');
    expect((trendLayer.mark as MarkSpec).color).toBe('#999');
    expect((trendLayer.mark as MarkSpec).strokeWidth).toBe(2);
    expect((trendLayer.mark as MarkSpec).strokeDash).toEqual([4, 4]);
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
    const layers = buildComboLayers(config, SINGLE_SERIES_DATA, []);
    // 1 main + 1 label + 1 trendline
    expect(layers).toHaveLength(3);
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
    const spec = configToSpec(config, SINGLE_SERIES_DATA);
    expect(spec.layer).toBeDefined();
    expect(spec.layer!.length).toBeGreaterThanOrEqual(2);
  });

  it('should have a rule layer and a bar layer', () => {
    const config = makeConfig({ type: 'stock' });
    const spec = configToSpec(config, SINGLE_SERIES_DATA);
    const markTypes = spec.layer!.map((l) => (l.mark as MarkSpec).type);
    expect(markTypes).toContain('rule');
    expect(markTypes).toContain('bar');
  });
});

describe('buildStockLayers', () => {
  it('should produce two layers (wick + body)', () => {
    const config = makeConfig({ type: 'stock' });
    const layers = buildStockLayers(config, SINGLE_SERIES_DATA, []);
    expect(layers).toHaveLength(2);
    expect((layers[0].mark as MarkSpec).type).toBe('rule');
    expect((layers[1].mark as MarkSpec).type).toBe('bar');
  });
});

describe('configToSpec - funnel chart', () => {
  it('should produce a bar mark with cornerRadius for funnel', () => {
    const config = makeConfig({ type: 'funnel' });
    const spec = configToSpec(config, SINGLE_SERIES_DATA);
    const mark = spec.mark as MarkSpec;
    expect(mark.type).toBe('bar');
    expect(mark.cornerRadius).toBe(2);
  });
});

describe('configToSpec - radar verification', () => {
  it('should produce linear-closed for basic radar', () => {
    const config = makeConfig({ type: 'radar' });
    const spec = configToSpec(config, SINGLE_SERIES_DATA);
    const mark = spec.mark as MarkSpec;
    expect(mark.type).toBe('line');
    expect(mark.interpolate).toBe('linear-closed');
  });

  it('should produce area with linear-closed for filled radar', () => {
    const config = makeConfig({ type: 'radar', radarFilled: true });
    const spec = configToSpec(config, SINGLE_SERIES_DATA);
    const mark = spec.mark as MarkSpec;
    expect(mark.type).toBe('area');
    expect(mark.interpolate).toBe('linear-closed');
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
    const spec = configToSpec(config, richSingle);
    const result = compile(spec, undefined, { width: 600, height: 400 });
    expect(result.marks.length).toBeGreaterThan(0);
    expect(result.marks.every((m) => m.type === 'symbol')).toBe(true);
  });

  // --- bubble ---

  it('bubble: produces symbol marks', () => {
    const config = makeConfig({ type: 'bubble' });
    const spec = configToSpec(config, richSingle);
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
    const spec = configToSpec(config, richSingle);
    const result = compile(spec, undefined, { width: 600, height: 400 });
    expect(result.marks.length).toBeGreaterThan(0);
  });

  it('stock (ohlc): produces marks from layered spec', () => {
    const config = makeConfig({ type: 'stock', subType: 'ohlc' });
    const spec = configToSpec(config, richSingle);
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
        axis: {
          xAxis: { type: 'category' },
          yAxis: { type: 'value' },
        },
      });

      const encoding = buildEncoding(config, SINGLE_SERIES_DATA);

      // No scale should be set for default axis types
      expect(encoding.x?.scale).toBeUndefined();
      expect(encoding.y?.scale).toBeUndefined();
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
      const encoding: EncodingSpec = {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
      };

      const layer = buildDataLabelLayer({ show: true, format: '0.00%' }, encoding);

      expect(layer).toBeDefined();
      expect(layer!.encoding!.text!.format).toBe('0.00%');
    });

    it('maps top position to negative baseline offset', () => {
      const encoding: EncodingSpec = {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
      };

      const layer = buildDataLabelLayer({ show: true, position: 'top' }, encoding);

      expect(layer).toBeDefined();
      const mark = layer!.mark as MarkSpec;
      expect(mark.baseline).toBe(-10);
    });

    it('maps inside position without offset', () => {
      const encoding: EncodingSpec = {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
      };

      const layer = buildDataLabelLayer({ show: true, position: 'inside' }, encoding);

      expect(layer).toBeDefined();
      const mark = layer!.mark as MarkSpec;
      expect(mark.baseline).toBeUndefined();
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

    it('creates HLC layers (rule + tick) for hlc sub-type', () => {
      const config = makeConfig({ type: 'stock', subType: 'hlc' });
      const rows = [{ category: 'Day1', high: 110, low: 90, close: 105 }];

      const layers = buildStockLayers(config, stockData, rows);

      // Should have 2 layers: rule (wick) + tick (close)
      expect(layers.length).toBe(2);
      expect((layers[0].mark as MarkSpec).type).toBe('rule');
      expect((layers[1].mark as MarkSpec).type).toBe('tick');
    });

    it('creates OHLC layers (rule + bar) for ohlc sub-type', () => {
      const config = makeConfig({ type: 'stock', subType: 'ohlc' });
      const rows = [{ category: 'Day1', open: 95, high: 110, low: 90, close: 105 }];

      const layers = buildStockLayers(config, stockData, rows);

      // Should have 2 layers: rule (wick) + bar (body)
      expect(layers.length).toBe(2);
      expect((layers[0].mark as MarkSpec).type).toBe('rule');
      expect((layers[1].mark as MarkSpec).type).toBe('bar');
    });

    it('adds volume layer for volume-ohlc sub-type', () => {
      const config = makeConfig({ type: 'stock', subType: 'volume-ohlc' as any });
      const rows = [{ category: 'Day1', open: 95, high: 110, low: 90, close: 105, volume: 1000 }];

      const layers = buildStockLayers(config, stockData, rows);

      // Should have 3 layers: volume bar + rule (wick) + bar (body)
      expect(layers.length).toBe(3);
      expect((layers[0].mark as MarkSpec).type).toBe('bar');
      expect((layers[0].mark as MarkSpec).opacity).toBe(0.3);
      expect((layers[1].mark as MarkSpec).type).toBe('rule');
      expect((layers[2].mark as MarkSpec).type).toBe('bar');
    });

    it('adds volume layer for volume-hlc sub-type', () => {
      const config = makeConfig({ type: 'stock', subType: 'volume-hlc' as any });
      const rows = [{ category: 'Day1', high: 110, low: 90, close: 105, volume: 1000 }];

      const layers = buildStockLayers(config, stockData, rows);

      // Should have 3 layers: volume bar + rule (wick) + tick (close)
      expect(layers.length).toBe(3);
      expect((layers[0].mark as MarkSpec).type).toBe('bar');
      expect((layers[1].mark as MarkSpec).type).toBe('rule');
      expect((layers[2].mark as MarkSpec).type).toBe('tick');
    });
  });
});
