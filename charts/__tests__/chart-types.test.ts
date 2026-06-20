/**
 * Tests for chart types and defaults
 */
import {
  DEFAULT_CHART_COLORS,
  DEFAULT_CHART_CONFIG,
  type ChartType,
  type StoredChartConfig,
  type SubTypeFor,
  type TypedChartConfig,
} from '../src/types';

describe('DEFAULT_CHART_COLORS', () => {
  it('has 10 colors in the default palette', () => {
    expect(DEFAULT_CHART_COLORS).toHaveLength(10);
  });

  it('all colors are valid hex strings', () => {
    const hexPattern = /^#[0-9A-Fa-f]{6}$/;
    DEFAULT_CHART_COLORS.forEach((color) => {
      expect(color).toMatch(hexPattern);
    });
  });

  it('has unique colors', () => {
    const uniqueColors = new Set(DEFAULT_CHART_COLORS);
    expect(uniqueColors.size).toBe(DEFAULT_CHART_COLORS.length);
  });
});

describe('DEFAULT_CHART_CONFIG', () => {
  it('has reasonable default dimensions', () => {
    expect(DEFAULT_CHART_CONFIG.width).toBe(480);
    expect(DEFAULT_CHART_CONFIG.height).toBe(225);
  });

  it('has legend shown by default', () => {
    expect(DEFAULT_CHART_CONFIG.legend?.show).toBe(true);
    expect(DEFAULT_CHART_CONFIG.legend?.position).toBe('bottom');
  });

  it('has proper axis defaults', () => {
    expect(DEFAULT_CHART_CONFIG.axis?.xAxis?.type).toBe('category');
    expect(DEFAULT_CHART_CONFIG.axis?.yAxis?.type).toBe('value');
    expect(DEFAULT_CHART_CONFIG.axis?.yAxis?.gridLines).toBe(true);
  });

  it('has data labels hidden by default', () => {
    expect(DEFAULT_CHART_CONFIG.dataLabels?.show).toBe(false);
  });

  it('uses the default color palette', () => {
    expect(DEFAULT_CHART_CONFIG.colors).toEqual(DEFAULT_CHART_COLORS);
  });
});

describe('ChartType', () => {
  it('supports all required chart types', () => {
    const chartTypes: ChartType[] = [
      'bar',
      'column',
      'line',
      'area',
      'pie',
      'doughnut',
      'scatter',
      'bubble',
      'combo',
    ];

    // TypeScript will error if any type is invalid
    chartTypes.forEach((type) => {
      expect(typeof type).toBe('string');
    });
  });
});

describe('ChartConfig', () => {
  it('can be created with minimal properties', () => {
    const config: StoredChartConfig = {
      id: 'test-chart',
      type: 'column',
      anchorRow: 0,
      anchorCol: 0,
      width: 480,
      height: 225,
      dataRange: 'A1:D10',
    };

    expect(config.id).toBe('test-chart');
    expect(config.type).toBe('column');
    expect(config.dataRange).toBe('A1:D10');
  });

  it('can be created with all optional properties', () => {
    const config: StoredChartConfig = {
      id: 'full-chart',
      type: 'combo',
      subType: 'stacked',
      anchorRow: 5,
      anchorCol: 3,
      width: 10,
      height: 20,
      dataRange: 'A1:E20',
      seriesRange: 'A1:A5',
      categoryRange: 'B1:E1',
      seriesOrientation: 'columns',
      title: 'Sales Analysis',
      subtitle: 'Q1 2024',
      legend: {
        show: true,
        position: 'right',
      },
      axis: {
        xAxis: {
          type: 'category',
          title: 'Month',
          gridLines: true,
        },
        yAxis: {
          type: 'value',
          title: 'Revenue',
          min: 0,
          max: 1000,
          gridLines: true,
        },
        secondaryYAxis: {
          type: 'value',
          title: 'Units',
          show: true,
        },
      },
      colors: ['#FF0000', '#00FF00', '#0000FF'],
      series: [
        {
          name: 'Revenue',
          type: 'column',
          color: '#FF0000',
          yAxisIndex: 0,
        },
        {
          name: 'Units',
          type: 'line',
          color: '#00FF00',
          yAxisIndex: 1,
          showMarkers: true,
          markerSize: 8,
          lineWidth: 3,
        },
      ],
      dataLabels: {
        show: true,
        position: 'top',
        format: '${value}',
      },
      sheetId: 'sheet-1',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    expect(config.title).toBe('Sales Analysis');
    expect(config.series).toHaveLength(2);
    expect(config.axis?.secondaryYAxis?.show).toBe(true);
  });
});

/**
 * Compile-time validation tests for TypedChartConfig<T>.
 *
 * These tests verify that TypedChartConfig constrains chart-specific fields
 * and subType to match the chart type. The @ts-expect-error comments prove
 * that invalid combinations are rejected at compile time.
 */
describe('TypedChartConfig', () => {
  // Shared base fields used by all typed configs
  const base = {
    id: 'test',
    anchorRow: 0,
    anchorCol: 0,
    width: 480,
    height: 225,
    dataRange: 'A1:D10',
  } as const;

  it('bar: allows type bar with subType clustered', () => {
    const config: TypedChartConfig<'bar'> = {
      ...base,
      type: 'bar',
      subType: 'clustered',
    };
    expect(config.type).toBe('bar');
    expect(config.subType).toBe('clustered');
  });

  it('bar: allows stacked and percentStacked subTypes', () => {
    const stacked: TypedChartConfig<'bar'> = { ...base, type: 'bar', subType: 'stacked' };
    const pctStacked: TypedChartConfig<'bar'> = { ...base, type: 'bar', subType: 'percentStacked' };
    expect(stacked.subType).toBe('stacked');
    expect(pctStacked.subType).toBe('percentStacked');
  });

  it('bar: rejects pie-specific fields', () => {
    const config: TypedChartConfig<'bar'> = {
      ...base,
      type: 'bar',
      // @ts-expect-error pieSlice is not available on bar charts
      pieSlice: { explodedIndex: 0 },
    };
    expect(config).toBeDefined();
  });

  it('bar: rejects scatter-specific fields', () => {
    const config: TypedChartConfig<'bar'> = {
      ...base,
      type: 'bar',
      // @ts-expect-error trendline is not available on bar charts
      trendline: { show: true, type: 'linear' },
    };
    expect(config).toBeDefined();
  });

  it('bar: rejects radar-specific fields', () => {
    const config: TypedChartConfig<'bar'> = {
      ...base,
      type: 'bar',
      // @ts-expect-error radarFilled is not available on bar charts
      radarFilled: true,
    };
    expect(config).toBeDefined();
  });

  it('pie: allows pieSlice', () => {
    const config: TypedChartConfig<'pie'> = {
      ...base,
      type: 'pie',
      pieSlice: { explodedIndex: 0, explodeOffset: 0.1 },
    };
    expect(config.pieSlice?.explodedIndex).toBe(0);
  });

  it('pie: rejects trendline', () => {
    const config: TypedChartConfig<'pie'> = {
      ...base,
      type: 'pie',
      // @ts-expect-error trendline is not available on pie charts
      trendline: { show: true, type: 'linear' },
    };
    expect(config).toBeDefined();
  });

  it('pie: rejects showLines', () => {
    const config: TypedChartConfig<'pie'> = {
      ...base,
      type: 'pie',
      // @ts-expect-error showLines is not available on pie charts
      showLines: true,
    };
    expect(config).toBeDefined();
  });

  it('pie: rejects radarFilled', () => {
    const config: TypedChartConfig<'pie'> = {
      ...base,
      type: 'pie',
      // @ts-expect-error radarFilled is not available on pie charts
      radarFilled: true,
    };
    expect(config).toBeDefined();
  });

  it('scatter: allows trendline and showLines', () => {
    const config: TypedChartConfig<'scatter'> = {
      ...base,
      type: 'scatter',
      trendline: { show: true, type: 'linear', showEquation: true },
      showLines: true,
      smoothLines: false,
    };
    expect(config.trendline?.show).toBe(true);
    expect(config.showLines).toBe(true);
  });

  it('scatter: rejects pieSlice', () => {
    const config: TypedChartConfig<'scatter'> = {
      ...base,
      type: 'scatter',
      // @ts-expect-error pieSlice is not available on scatter charts
      pieSlice: { explodedIndex: 0 },
    };
    expect(config).toBeDefined();
  });

  it('scatter: rejects radarFilled', () => {
    const config: TypedChartConfig<'scatter'> = {
      ...base,
      type: 'scatter',
      // @ts-expect-error radarFilled is not available on scatter charts
      radarFilled: true,
    };
    expect(config).toBeDefined();
  });

  it('scatter: rejects waterfall', () => {
    const config: TypedChartConfig<'scatter'> = {
      ...base,
      type: 'scatter',
      // @ts-expect-error waterfall is not available on scatter charts
      waterfall: { totalIndices: [3] },
    };
    expect(config).toBeDefined();
  });

  it('radar: allows radarFilled and radarMarkers', () => {
    const config: TypedChartConfig<'radar'> = {
      ...base,
      type: 'radar',
      subType: 'filled',
      radarFilled: true,
      radarMarkers: true,
    };
    expect(config.radarFilled).toBe(true);
    expect(config.radarMarkers).toBe(true);
    expect(config.subType).toBe('filled');
  });

  it('radar: rejects pieSlice', () => {
    const config: TypedChartConfig<'radar'> = {
      ...base,
      type: 'radar',
      // @ts-expect-error pieSlice is not available on radar charts
      pieSlice: { explodedIndex: 0 },
    };
    expect(config).toBeDefined();
  });

  it('radar: rejects trendline', () => {
    const config: TypedChartConfig<'radar'> = {
      ...base,
      type: 'radar',
      // @ts-expect-error trendline is not available on radar charts
      trendline: { show: true, type: 'linear' },
    };
    expect(config).toBeDefined();
  });

  it('waterfall: allows waterfall config', () => {
    const config: TypedChartConfig<'waterfall'> = {
      ...base,
      type: 'waterfall',
      waterfall: {
        totalIndices: [3, 7],
        increaseColor: '#00FF00',
        decreaseColor: '#FF0000',
        totalColor: '#0000FF',
      },
    };
    expect(config.waterfall?.totalIndices).toEqual([3, 7]);
  });

  it('waterfall: rejects pieSlice', () => {
    const config: TypedChartConfig<'waterfall'> = {
      ...base,
      type: 'waterfall',
      // @ts-expect-error pieSlice is not available on waterfall charts
      pieSlice: { explodedIndex: 0 },
    };
    expect(config).toBeDefined();
  });

  it('waterfall: rejects showLines', () => {
    const config: TypedChartConfig<'waterfall'> = {
      ...base,
      type: 'waterfall',
      // @ts-expect-error showLines is not available on waterfall charts
      showLines: true,
    };
    expect(config).toBeDefined();
  });

  it('line: allows trendline but rejects showLines', () => {
    const config: TypedChartConfig<'line'> = {
      ...base,
      type: 'line',
      subType: 'smooth',
      trendline: { show: true, type: 'polynomial', order: 3 },
      // @ts-expect-error showLines is scatter-only, not available on line charts
      showLines: true,
    };
    expect(config.trendline?.type).toBe('polynomial');
  });
});

describe('SubTypeFor', () => {
  it('maps bar to BarSubType', () => {
    const subType: SubTypeFor<'bar'> = 'clustered';
    expect(subType).toBe('clustered');
  });

  it('maps line to LineSubType', () => {
    const subType: SubTypeFor<'line'> = 'smooth';
    expect(subType).toBe('smooth');
  });

  it('maps area to AreaSubType', () => {
    const subType: SubTypeFor<'area'> = 'stacked';
    expect(subType).toBe('stacked');
  });

  it('maps stock to StockSubType', () => {
    const subType: SubTypeFor<'stock'> = 'ohlc';
    expect(subType).toBe('ohlc');
  });

  it('maps radar to RadarSubType', () => {
    const subType: SubTypeFor<'radar'> = 'filled';
    expect(subType).toBe('filled');
  });
});
