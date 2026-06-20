/**
 * Full Pipeline Integration Tests
 *
 * Tests the complete pipeline: ChartConfig -> configToSpec -> compile -> marks
 * for all chart types and configurations.
 */
import { configToSpec } from '../../src/core/config-to-spec';
import { compile, type CompileResult } from '../../src/grammar/compiler';
import type { ChartSpec, MarkSpec } from '../../src/grammar/spec';
import type { ChartConfig, ChartData, ChartType, StoredChartConfig } from '../../src/types';

// =============================================================================
// Test Helpers
// =============================================================================

function makeConfig(overrides: Partial<StoredChartConfig> = {}): StoredChartConfig {
  return {
    id: 'pipeline-test',
    type: 'bar',
    anchorRow: 0,
    anchorCol: 0,
    width: 480,
    height: 225,
    dataRange: 'A1:D10',
    ...overrides,
  };
}

function makeData(seriesCount = 1, categoryCount = 4): ChartData {
  const categories = ['Q1', 'Q2', 'Q3', 'Q4'].slice(0, categoryCount);
  const series = [];
  for (let i = 0; i < seriesCount; i++) {
    series.push({
      name: `Series ${i + 1}`,
      data: categories.map((cat, j) => ({
        x: cat,
        y: (j + 1) * 10 * (i + 1) + Math.round(Math.random() * 5),
        name: cat,
      })),
    });
  }
  return { categories, series };
}

/** Run the full pipeline and return the compile result. */
function runPipeline(config: ChartConfig, data: ChartData): CompileResult {
  const spec = configToSpec(config, data);
  return compile(spec, undefined, { width: 600, height: 400 });
}

// =============================================================================
// Full Pipeline for Each Chart Type
// =============================================================================

describe('Full pipeline: ChartConfig -> configToSpec -> compile -> marks', () => {
  const SINGLE_DATA = makeData(1);
  const MULTI_DATA = makeData(3);
  const XY_DATA: ChartData = {
    categories: [1, 2, 3, 4],
    series: [
      {
        name: 'Series 1',
        data: [
          { x: 1, y: 10, size: 5, name: '1' },
          { x: 2, y: 20, size: 10, name: '2' },
          { x: 3, y: 30, size: 15, name: '3' },
          { x: 4, y: 40, size: 20, name: '4' },
        ],
      },
    ],
  };
  const STOCK_DATA: ChartData = {
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

  // --- bar ---

  describe('bar chart', () => {
    it('produces rect marks for basic bar', () => {
      const result = runPipeline(makeConfig({ type: 'bar' }), SINGLE_DATA);
      expect(result.marks.length).toBeGreaterThan(0);
      expect(result.marks.every((m) => m.type === 'rect')).toBe(true);
    });

    it('produces rect marks for stacked bar with multi-series', () => {
      const result = runPipeline(makeConfig({ type: 'bar', subType: 'stacked' }), MULTI_DATA);
      expect(result.marks.length).toBeGreaterThan(0);
      expect(result.marks.every((m) => m.type === 'rect')).toBe(true);
    });

    it('produces rect marks for percentStacked bar', () => {
      const result = runPipeline(
        makeConfig({ type: 'bar', subType: 'percentStacked' }),
        MULTI_DATA,
      );
      expect(result.marks.length).toBeGreaterThan(0);
      expect(result.marks.every((m) => m.type === 'rect')).toBe(true);
    });
  });

  // --- column ---

  describe('column chart', () => {
    it('produces rect marks for vertical bars', () => {
      const result = runPipeline(makeConfig({ type: 'column' }), SINGLE_DATA);
      expect(result.marks.length).toBeGreaterThan(0);
      expect(result.marks.every((m) => m.type === 'rect')).toBe(true);
    });

    it('produces rect marks for stacked column', () => {
      const result = runPipeline(makeConfig({ type: 'column', subType: 'stacked' }), MULTI_DATA);
      expect(result.marks.length).toBeGreaterThan(0);
      expect(result.marks.every((m) => m.type === 'rect')).toBe(true);
    });

    it('produces rect marks for percentStacked column', () => {
      const result = runPipeline(
        makeConfig({ type: 'column', subType: 'percentStacked' }),
        MULTI_DATA,
      );
      expect(result.marks.length).toBeGreaterThan(0);
      expect(result.marks.every((m) => m.type === 'rect')).toBe(true);
    });
  });

  // --- line ---

  describe('line chart', () => {
    it('produces path marks for straight line', () => {
      const result = runPipeline(makeConfig({ type: 'line' }), SINGLE_DATA);
      expect(result.marks.length).toBeGreaterThan(0);
      expect(result.marks.some((m) => m.type === 'path')).toBe(true);
    });

    it('produces path marks for smooth line', () => {
      const result = runPipeline(makeConfig({ type: 'line', subType: 'smooth' }), SINGLE_DATA);
      expect(result.marks.length).toBeGreaterThan(0);
      expect(result.marks.some((m) => m.type === 'path')).toBe(true);
    });

    it('produces path marks for stepped line', () => {
      const result = runPipeline(makeConfig({ type: 'line', subType: 'stepped' }), SINGLE_DATA);
      expect(result.marks.length).toBeGreaterThan(0);
      expect(result.marks.some((m) => m.type === 'path')).toBe(true);
    });

    it('produces path marks for stacked line', () => {
      const result = runPipeline(makeConfig({ type: 'line', subType: 'stacked' }), MULTI_DATA);
      expect(result.marks.length).toBeGreaterThan(0);
      expect(result.marks.some((m) => m.type === 'path')).toBe(true);
    });

    it('produces path marks for percentStacked line', () => {
      const result = runPipeline(
        makeConfig({ type: 'line', subType: 'percentStacked' }),
        MULTI_DATA,
      );
      expect(result.marks.length).toBeGreaterThan(0);
      expect(result.marks.some((m) => m.type === 'path')).toBe(true);
    });
  });

  // --- area ---

  describe('area chart', () => {
    it('produces path marks for standard area', () => {
      const result = runPipeline(makeConfig({ type: 'area' }), SINGLE_DATA);
      expect(result.marks.length).toBeGreaterThan(0);
      expect(result.marks.some((m) => m.type === 'path')).toBe(true);
    });

    it('produces path marks for stacked area', () => {
      const result = runPipeline(makeConfig({ type: 'area', subType: 'stacked' }), MULTI_DATA);
      expect(result.marks.length).toBeGreaterThan(0);
      expect(result.marks.some((m) => m.type === 'path')).toBe(true);
    });

    it('produces path marks for percentStacked area', () => {
      const result = runPipeline(
        makeConfig({ type: 'area', subType: 'percentStacked' }),
        MULTI_DATA,
      );
      expect(result.marks.length).toBeGreaterThan(0);
      expect(result.marks.some((m) => m.type === 'path')).toBe(true);
    });
  });

  // --- pie ---

  describe('pie chart', () => {
    it('produces arc marks', () => {
      const result = runPipeline(makeConfig({ type: 'pie' }), SINGLE_DATA);
      expect(result.marks.length).toBeGreaterThan(0);
      expect(result.marks.every((m) => m.type === 'arc')).toBe(true);
    });
  });

  // --- doughnut ---

  describe('doughnut chart', () => {
    it('produces arc marks with innerRadius > 0', () => {
      const result = runPipeline(makeConfig({ type: 'doughnut' }), SINGLE_DATA);
      expect(result.marks.length).toBeGreaterThan(0);
      expect(result.marks.every((m) => m.type === 'arc')).toBe(true);
      for (const m of result.marks) {
        expect((m as { innerRadius: number }).innerRadius).toBeGreaterThan(0);
      }
    });
  });

  // --- scatter ---

  describe('scatter chart', () => {
    it('produces symbol marks', () => {
      const result = runPipeline(makeConfig({ type: 'scatter' }), XY_DATA);
      expect(result.marks.length).toBeGreaterThan(0);
      expect(result.marks.every((m) => m.type === 'symbol')).toBe(true);
    });
  });

  // --- bubble ---

  describe('bubble chart', () => {
    it('produces symbol marks', () => {
      const result = runPipeline(makeConfig({ type: 'bubble' }), XY_DATA);
      expect(result.marks.length).toBeGreaterThan(0);
      expect(result.marks.every((m) => m.type === 'symbol')).toBe(true);
    });
  });

  // --- radar ---

  describe('radar chart', () => {
    it('produces path marks for basic radar', () => {
      const result = runPipeline(makeConfig({ type: 'radar' }), SINGLE_DATA);
      expect(result.marks.length).toBeGreaterThan(0);
      expect(result.marks.some((m) => m.type === 'path')).toBe(true);
    });

    it('produces path marks for filled radar', () => {
      const result = runPipeline(makeConfig({ type: 'radar', radarFilled: true }), SINGLE_DATA);
      expect(result.marks.length).toBeGreaterThan(0);
      expect(result.marks.some((m) => m.type === 'path')).toBe(true);
    });
  });

  // --- stock ---

  describe('stock chart', () => {
    it('produces marks for hlc stock chart', () => {
      const result = runPipeline(makeConfig({ type: 'stock', subType: 'hlc' }), STOCK_DATA);
      expect(result.marks.length).toBeGreaterThan(0);
    });

    it('produces marks for ohlc stock chart', () => {
      const result = runPipeline(makeConfig({ type: 'stock', subType: 'ohlc' }), STOCK_DATA);
      expect(result.marks.length).toBeGreaterThan(0);
    });
  });

  // --- waterfall ---

  describe('waterfall chart', () => {
    it('produces rect marks', () => {
      const result = runPipeline(makeConfig({ type: 'waterfall' }), SINGLE_DATA);
      expect(result.marks.length).toBeGreaterThan(0);
      expect(result.marks.some((m) => m.type === 'rect')).toBe(true);
    });

    it('produces marks with custom waterfall colors', () => {
      const result = runPipeline(
        makeConfig({
          type: 'waterfall',
          waterfall: {
            increaseColor: '#00ff00',
            decreaseColor: '#ff0000',
            totalColor: '#0000ff',
            totalIndices: [3],
          },
        }),
        SINGLE_DATA,
      );
      expect(result.marks.length).toBeGreaterThan(0);
    });
  });
});

// =============================================================================
// Layered Specs (Combo) Produce Marks from All Layers
// =============================================================================

describe('Full pipeline: layered specs (combo)', () => {
  const MULTI_DATA = makeData(2);
  const THREE_SERIES_DATA = makeData(3);

  it('combo (bar + line): produces both rect and path marks', () => {
    const config = makeConfig({
      type: 'combo',
      series: [
        { type: 'bar', color: '#ff0000' },
        { type: 'line', color: '#0000ff' },
      ],
    });
    const result = runPipeline(config, MULTI_DATA);
    expect(result.marks.length).toBeGreaterThan(0);
    const markTypes = new Set(result.marks.map((m) => m.type));
    expect(markTypes.has('rect')).toBe(true);
    expect(markTypes.has('path')).toBe(true);
  });

  it('combo (bar + line + area): produces marks from 3 layers', () => {
    const config = makeConfig({
      type: 'combo',
      series: [{ type: 'bar' }, { type: 'line' }, { type: 'area' }],
    });
    const result = runPipeline(config, THREE_SERIES_DATA);
    expect(result.marks.length).toBeGreaterThan(0);
    // Should have at least 2 distinct mark types
    const markTypes = new Set(result.marks.map((m) => m.type));
    expect(markTypes.size).toBeGreaterThanOrEqual(2);
  });

  it('combo: mark count >= number of data points per layer', () => {
    const data = makeData(2, 4);
    const config = makeConfig({
      type: 'combo',
      series: [{ type: 'bar' }, { type: 'line' }],
    });
    const result = runPipeline(config, data);
    // Bar layer should have at least 4 marks (one per data point for that series)
    // Line layer should have at least 1 path mark
    expect(result.marks.length).toBeGreaterThanOrEqual(5);
  });

  it('combo with data labels: produces text marks in addition to data marks', () => {
    const config = makeConfig({
      type: 'combo',
      series: [{ type: 'bar', dataLabels: { show: true } }, { type: 'line' }],
    });
    const result = runPipeline(config, MULTI_DATA);
    expect(result.marks.length).toBeGreaterThan(0);
    const markTypes = new Set(result.marks.map((m) => m.type));
    expect(markTypes.has('text')).toBe(true);
  });
});

// =============================================================================
// Statistical Marks Through Standard Pipeline
// =============================================================================

describe('Full pipeline: statistical marks', () => {
  const STAT_DATA = makeData(1, 4);

  it('boxplot: compiles through standard pipeline', () => {
    const spec: ChartSpec = {
      mark: 'boxplot',
      data: {
        values: [
          { category: 'A', value: 10 },
          { category: 'A', value: 20 },
          { category: 'A', value: 15 },
          { category: 'A', value: 25 },
          { category: 'A', value: 18 },
          { category: 'B', value: 30 },
          { category: 'B', value: 35 },
          { category: 'B', value: 28 },
          { category: 'B', value: 40 },
          { category: 'B', value: 33 },
        ],
      },
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
      },
    };

    const result = compile(spec, undefined, { width: 600, height: 400 });
    expect(result).toBeDefined();
    expect(result.marks).toBeDefined();
    expect(result.marks.length).toBeGreaterThan(0);
  });

  it('histogram: compiles through standard pipeline', () => {
    const spec: ChartSpec = {
      mark: 'histogram',
      data: {
        values: [
          { value: 5 },
          { value: 10 },
          { value: 15 },
          { value: 20 },
          { value: 25 },
          { value: 30 },
          { value: 12 },
          { value: 18 },
          { value: 22 },
        ],
      },
      encoding: {
        x: { field: 'value', type: 'quantitative' },
        y: { field: 'value', type: 'quantitative' },
      },
    };

    const result = compile(spec, undefined, { width: 600, height: 400 });
    expect(result).toBeDefined();
    expect(result.marks).toBeDefined();
    expect(result.marks.length).toBeGreaterThan(0);
  });

  it('histogram with density curve: generates path marks', () => {
    const spec: ChartSpec = {
      mark: { type: 'histogram', density: true } as MarkSpec,
      data: {
        values: [
          { value: 5 },
          { value: 10 },
          { value: 15 },
          { value: 20 },
          { value: 25 },
          { value: 30 },
          { value: 12 },
          { value: 18 },
          { value: 22 },
          { value: 8 },
          { value: 28 },
          { value: 14 },
        ],
      },
      encoding: {
        x: { field: 'value', type: 'quantitative' },
        y: { field: 'value', type: 'quantitative' },
      },
    };

    const result = compile(spec, undefined, { width: 600, height: 400 });
    const pathMarks = result.marks.filter((m) => m.type === 'path');
    expect(pathMarks.length).toBeGreaterThan(0);
    // Density curve should have no fill, only stroke
    for (const pm of pathMarks) {
      expect(pm.style?.fill).toBe('none');
      expect(pm.style?.stroke).toBeDefined();
    }
  });

  it('histogram without density: no path marks', () => {
    const spec: ChartSpec = {
      mark: 'histogram',
      data: {
        values: [
          { value: 5 },
          { value: 10 },
          { value: 15 },
          { value: 20 },
          { value: 25 },
          { value: 30 },
          { value: 12 },
          { value: 18 },
          { value: 22 },
          { value: 8 },
          { value: 28 },
          { value: 14 },
        ],
      },
      encoding: {
        x: { field: 'value', type: 'quantitative' },
        y: { field: 'value', type: 'quantitative' },
      },
    };

    const result = compile(spec, undefined, { width: 600, height: 400 });
    const pathMarks = result.marks.filter((m) => m.type === 'path');
    expect(pathMarks).toHaveLength(0);
  });

  it('violin: compiles through standard pipeline', () => {
    const spec: ChartSpec = {
      mark: 'violin',
      data: {
        values: [
          { category: 'A', value: 10 },
          { category: 'A', value: 20 },
          { category: 'A', value: 15 },
          { category: 'A', value: 25 },
          { category: 'A', value: 18 },
          { category: 'B', value: 30 },
          { category: 'B', value: 35 },
          { category: 'B', value: 28 },
          { category: 'B', value: 40 },
          { category: 'B', value: 33 },
        ],
      },
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
      },
    };

    const result = compile(spec, undefined, { width: 600, height: 400 });
    expect(result).toBeDefined();
    expect(result.marks).toBeDefined();
    expect(result.marks.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// Config Options Produce Corresponding Marks
// =============================================================================

describe('Full pipeline: config options produce corresponding output', () => {
  const SINGLE_DATA = makeData(1);
  const MULTI_DATA = makeData(2);

  it('title option produces title marks', () => {
    const config = makeConfig({
      type: 'bar',
      title: 'Sales Report',
      subtitle: 'FY 2025',
    });
    const result = runPipeline(config, SINGLE_DATA);
    expect(result.title).toBeDefined();
    expect(result.title!.length).toBeGreaterThan(0);
  });

  it('legend option produces legend marks', () => {
    const config = makeConfig({
      type: 'bar',
      legend: { show: true, position: 'right' },
    });
    const result = runPipeline(config, MULTI_DATA);
    expect(result.legends).toBeDefined();
    expect(result.legends.length).toBeGreaterThan(0);
  });

  it('axes are generated for x/y chart types', () => {
    const config = makeConfig({
      type: 'bar',
      axis: {
        xAxis: { type: 'category', title: 'Quarter', gridLines: true },
        yAxis: { type: 'value', title: 'Revenue', gridLines: true },
      },
    });
    const result = runPipeline(config, SINGLE_DATA);
    expect(result.axes).toBeDefined();
    expect(result.axes.length).toBeGreaterThan(0);
  });

  it('data labels produce additional text marks in layered output', () => {
    const config = makeConfig({
      type: 'bar',
      dataLabels: { show: true },
    });
    const result = runPipeline(config, SINGLE_DATA);
    expect(result.marks.length).toBeGreaterThan(0);
    const textMarks = result.marks.filter((m) => m.type === 'text');
    expect(textMarks.length).toBeGreaterThan(0);
  });

  it('custom colors affect the compiled output', () => {
    const config = makeConfig({
      type: 'bar',
      colors: ['#ff0000', '#00ff00', '#0000ff'],
    });
    const result = runPipeline(config, MULTI_DATA);
    expect(result.marks.length).toBeGreaterThan(0);
    expect(result.scales).toBeDefined();
  });

  it('layout bounds reflect configured dimensions', () => {
    const config = makeConfig({
      type: 'bar',
      width: 600,
      height: 300,
    });
    const spec = configToSpec(config, SINGLE_DATA);
    // Width: 600pt at 96 CSS px/in = 800, Height: 300pt = 400
    expect(spec.width).toBe(800);
    expect(spec.height).toBe(400);

    const result = compile(spec, undefined);
    expect(result.bounds.width).toBe(800);
    expect(result.bounds.height).toBe(400);
  });

  it('empty data produces empty marks but does not throw', () => {
    const emptyData: ChartData = { categories: [], series: [] };
    const config = makeConfig({ type: 'bar' });
    const result = runPipeline(config, emptyData);
    expect(result).toBeDefined();
    expect(result.marks).toBeDefined();
    expect(Array.isArray(result.marks)).toBe(true);
  });
});

// =============================================================================
// Pipeline Structural Invariants
// =============================================================================

describe('Full pipeline: structural invariants', () => {
  const DATA = makeData(2);

  const allSimpleTypes: ChartType[] = [
    'bar',
    'column',
    'line',
    'area',
    'pie',
    'doughnut',
    'scatter',
    'bubble',
    'radar',
  ];

  it.each(allSimpleTypes)(
    '%s: result has marks, axes, legends, bounds, layout, scales',
    (chartType) => {
      const config = makeConfig({ type: chartType });
      const result = runPipeline(config, DATA);

      expect(result.marks).toBeDefined();
      expect(Array.isArray(result.marks)).toBe(true);
      expect(result.axes).toBeDefined();
      expect(Array.isArray(result.axes)).toBe(true);
      expect(result.legends).toBeDefined();
      expect(Array.isArray(result.legends)).toBe(true);
      expect(result.bounds).toBeDefined();
      expect(result.bounds.width).toBeGreaterThan(0);
      expect(result.bounds.height).toBeGreaterThan(0);
      expect(result.layout).toBeDefined();
      expect(result.layout.plotArea).toBeDefined();
      expect(result.scales).toBeDefined();
    },
  );

  const layeredTypes: ChartType[] = ['combo', 'stock', 'waterfall'];

  it.each(layeredTypes)(
    '%s (layered): result has marks, axes, legends, bounds, layout, scales',
    (chartType) => {
      const config = makeConfig({
        type: chartType,
        ...(chartType === 'combo' ? { series: [{ type: 'bar' }, { type: 'line' }] } : {}),
      });
      const result = runPipeline(config, DATA);

      expect(result.marks).toBeDefined();
      expect(Array.isArray(result.marks)).toBe(true);
      expect(result.bounds).toBeDefined();
      expect(result.bounds.width).toBeGreaterThan(0);
      expect(result.bounds.height).toBeGreaterThan(0);
      expect(result.layout).toBeDefined();
      expect(result.scales).toBeDefined();
    },
  );

  it('all marks have valid x, y, and type fields', () => {
    const config = makeConfig({ type: 'bar' });
    const result = runPipeline(config, DATA);
    for (const mark of result.marks) {
      expect(mark.type).toBeDefined();
      expect(typeof mark.x).toBe('number');
      expect(typeof mark.y).toBe('number');
      expect(isFinite(mark.x)).toBe(true);
      expect(isFinite(mark.y)).toBe(true);
    }
  });
});
