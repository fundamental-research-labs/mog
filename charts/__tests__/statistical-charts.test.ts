/**
 * Statistical chart component tests
 *
 * Additional coverage for BoxPlot, Histogram, Violin, and Heatmap components
 * that complements the existing tests in __tests__/components/statistical/.
 *
 * Includes toChartSpec() integration tests for standard grammar pipeline.
 */
import {
  BoxPlot,
  BoxPlotBuilder,
  calculateBoxStats,
  calculateGroupedStats,
} from '../src/components/statistical/boxplot';
import {
  Heatmap,
  extractCategories,
  processHeatmapData,
} from '../src/components/statistical/heatmap';
import { Histogram, calculateHistogramData } from '../src/components/statistical/histogram';
import { ViolinPlot, calculateViolinStats } from '../src/components/statistical/violin';
import { compile } from '../src/grammar/compiler';
import { isUnitSpec } from '../src/grammar/spec';

// ---------------------------------------------------------------------------
// BoxPlot builder edge cases
// ---------------------------------------------------------------------------

describe('BoxPlotBuilder: edge cases', () => {
  it('builder returns a spec with mark boxplot', () => {
    const spec = BoxPlot()
      .data([{ v: 1 }])
      .values('v')
      .toSpec();
    expect(spec.mark).toBe('boxplot');
    expect(spec.data.values).toHaveLength(1);
    expect(spec.encoding.y).toEqual({ field: 'v', type: 'quantitative' });
  });

  it('boxWidth clamps to [0.1, 1]', () => {
    const spec1 = new BoxPlotBuilder().boxWidth(0.01).toSpec();
    expect(spec1.config?.boxWidth).toBeGreaterThanOrEqual(0.1);
    const spec2 = new BoxPlotBuilder().boxWidth(5).toSpec();
    expect(spec2.config?.boxWidth).toBeLessThanOrEqual(1);
  });

  it('horizontal() sets orientation', () => {
    expect(BoxPlot().horizontal().toSpec().config?.orientation).toBe('horizontal');
  });

  it('notched() enables notch', () => {
    expect(BoxPlot().notched().toSpec().config?.notched).toBe(true);
  });

  it('whiskerMultiplier sets the multiplier', () => {
    expect(BoxPlot().whiskerMultiplier(2.5).toSpec().config?.whiskerMultiplier).toBe(2.5);
  });
});

describe('calculateBoxStats: edge cases', () => {
  it('empty values -> NaN stats', () => {
    const stats = calculateBoxStats([]);
    expect(stats.q1).toBeNaN();
    expect(stats.median).toBeNaN();
    expect(stats.outliers).toEqual([]);
  });

  it('all same values -> zero IQR', () => {
    const stats = calculateBoxStats([5, 5, 5, 5, 5]);
    expect(stats.q1).toBe(5);
    expect(stats.median).toBe(5);
    expect(stats.q3).toBe(5);
    expect(stats.outliers).toEqual([]);
  });

  it('category is passed through', () => {
    const stats = calculateBoxStats([1, 2, 3], 1.5, 'GroupA');
    expect(stats.category).toBe('GroupA');
  });

  it('filters non-finite values', () => {
    const stats = calculateBoxStats([1, 2, Infinity, -Infinity, NaN, 3]);
    expect(stats.q1).not.toBeNaN();
    expect(stats.median).not.toBeNaN();
  });
});

describe('calculateGroupedStats: edge cases', () => {
  it('no category field -> single box', () => {
    const data = [{ v: 1 }, { v: 2 }, { v: 3 }, { v: 4 }];
    const stats = calculateGroupedStats(data, 'v');
    expect(stats).toHaveLength(1);
  });

  it('grouped by category', () => {
    const data = [
      { v: 1, g: 'A' },
      { v: 2, g: 'A' },
      { v: 10, g: 'B' },
      { v: 20, g: 'B' },
    ];
    const stats = calculateGroupedStats(data, 'v', 'g');
    expect(stats.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Histogram builder edge cases
// ---------------------------------------------------------------------------

describe('HistogramBuilder: edge cases', () => {
  it('builder creates spec with x() field method', () => {
    const spec = Histogram()
      .data([{ v: 1 }])
      .x('v')
      .toSpec();
    expect(spec.mark).toBe('bar');
    expect(spec.encoding.x?.field).toBe('v');
  });

  it('bins() sets bin count', () => {
    const spec = Histogram().bins(20).toSpec();
    expect(spec.config?.binCount).toBe(20);
  });

  it('binWidth() sets bin width', () => {
    const spec = Histogram().binWidth(5).toSpec();
    expect(spec.config?.binWidth).toBe(5);
  });

  it('showDensity() enables density overlay', () => {
    const spec = Histogram().showDensity().toSpec();
    expect(spec.config?.showDensity).toBe(true);
  });
});

describe('calculateHistogramData: edge cases', () => {
  it('handles empty values', () => {
    const result = calculateHistogramData([]);
    expect(result.bins).toHaveLength(0);
  });

  it('handles single value', () => {
    const result = calculateHistogramData([5]);
    expect(result.bins.length).toBeGreaterThanOrEqual(1);
  });

  it('handles specified bin count', () => {
    const values = Array.from({ length: 100 }, (_, i) => i);
    const result = calculateHistogramData(values, { binCount: 10 });
    expect(result.bins.length).toBeLessThanOrEqual(11);
  });

  it('passes through category', () => {
    const result = calculateHistogramData([1, 2, 3], {}, 'GroupA');
    expect(result.category).toBe('GroupA');
  });
});

// ---------------------------------------------------------------------------
// ViolinPlot builder edge cases
// ---------------------------------------------------------------------------

describe('ViolinPlotBuilder: edge cases', () => {
  it('builder creates spec', () => {
    const spec = ViolinPlot()
      .data([{ v: 1 }])
      .values('v')
      .toSpec();
    expect(spec.mark).toBe('violin');
    expect(spec.encoding.y).toEqual({ field: 'v', type: 'quantitative' });
  });

  it('category() sets x encoding', () => {
    const spec = ViolinPlot().category('group').toSpec();
    expect(spec.encoding.x?.field).toBe('group');
  });
});

describe('calculateViolinStats: edge cases', () => {
  it('handles uniform data', () => {
    const stats = calculateViolinStats([5, 5, 5, 5, 5]);
    expect(stats.median).toBe(5);
  });

  it('handles single value', () => {
    const stats = calculateViolinStats([42]);
    expect(stats.median).toBe(42);
  });

  it('empty values -> NaN stats', () => {
    const stats = calculateViolinStats([]);
    expect(stats.median).toBeNaN();
    expect(stats.values).toEqual([]);
  });

  it('passes through category', () => {
    const stats = calculateViolinStats([1, 2, 3], undefined, 100, 'gaussian', 'GroupA');
    expect(stats.category).toBe('GroupA');
  });
});

// ---------------------------------------------------------------------------
// Heatmap builder and processing
// ---------------------------------------------------------------------------

describe('HeatmapBuilder: edge cases', () => {
  it('builder creates spec with x/y/color', () => {
    const spec = Heatmap()
      .data([{ x: 'A', y: 'B', v: 1 }])
      .x('x')
      .y('y')
      .color('v')
      .toSpec();
    expect(spec.mark).toBe('rect');
    expect(spec.encoding.x?.field).toBe('x');
    expect(spec.encoding.y?.field).toBe('y');
    expect(spec.encoding.color?.field).toBe('v');
  });

  it('showLabels() enables labels', () => {
    const spec = Heatmap().showLabels().toSpec();
    expect(spec.config?.showLabels).toBe(true);
  });

  it('cellGap() clamps to [0, 0.5]', () => {
    const spec = Heatmap().cellGap(1).toSpec();
    expect(spec.config?.cellGap).toBeLessThanOrEqual(0.5);
  });

  it('correlationMatrix() flag', () => {
    const spec = Heatmap().correlationMatrix().toSpec();
    expect(spec.config?.correlationMatrix).toBe(true);
  });
});

describe('extractCategories', () => {
  it('extracts unique sorted categories', () => {
    const data = [
      { x: 'B', y: '1' },
      { x: 'A', y: '2' },
      { x: 'B', y: '2' },
    ];
    const cats = extractCategories(data, 'x');
    expect(cats).toEqual(['A', 'B']); // sorted
  });

  it('ignores null/undefined', () => {
    const data = [{ x: 'A' }, { x: null }, { x: undefined }, { x: 'B' }];
    const cats = extractCategories(data, 'x');
    expect(cats).toEqual(['A', 'B']);
  });

  it('empty data returns empty', () => {
    expect(extractCategories([], 'x')).toEqual([]);
  });
});

describe('processHeatmapData', () => {
  it('creates cell entries with color scale', () => {
    const data = [
      { x: 'A', y: '1', v: 10 },
      { x: 'B', y: '2', v: 20 },
    ];
    const encoding = {
      x: { field: 'x', type: 'ordinal' as const },
      y: { field: 'y', type: 'ordinal' as const },
      color: { field: 'v', type: 'quantitative' as const },
    };
    const colorScale = (v: number) => (v > 15 ? '#ff0000' : '#0000ff');
    const result = processHeatmapData(data, encoding, colorScale);
    expect(result).toHaveLength(2);
    expect(result[0].x).toBe('A');
    expect(result[0].color).toBe('#0000ff');
    expect(result[1].color).toBe('#ff0000');
  });

  it('filters out non-finite color values', () => {
    const data = [
      { x: 'A', y: '1', v: 10 },
      { x: 'B', y: '2', v: NaN },
      { x: 'C', y: '3', v: Infinity },
    ];
    const encoding = {
      x: { field: 'x', type: 'ordinal' as const },
      y: { field: 'y', type: 'ordinal' as const },
      color: { field: 'v', type: 'quantitative' as const },
    };
    const result = processHeatmapData(data, encoding, () => '#000');
    expect(result).toHaveLength(1);
  });

  it('returns empty when encoding fields are missing', () => {
    const result = processHeatmapData([{ x: 'A' }], {}, () => '#000');
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// toChartSpec() + compile() integration tests
// ---------------------------------------------------------------------------

describe('BoxPlotBuilder.toChartSpec(): standard grammar pipeline', () => {
  const boxData = [
    { category: 'A', value: 10 },
    { category: 'A', value: 15 },
    { category: 'A', value: 20 },
    { category: 'A', value: 25 },
    { category: 'A', value: 30 },
    { category: 'B', value: 5 },
    { category: 'B', value: 12 },
    { category: 'B', value: 18 },
    { category: 'B', value: 22 },
    { category: 'B', value: 35 },
  ];

  it('toChartSpec() produces a UnitSpec with mark boxplot', () => {
    const spec = BoxPlot().data(boxData).values('value').category('category').toChartSpec();
    expect(isUnitSpec(spec)).toBe(true);
    expect(spec.mark).toBe('boxplot');
    expect(spec.encoding?.y?.field).toBe('value');
    expect(spec.encoding?.y?.type).toBe('quantitative');
    expect(spec.encoding?.x?.field).toBe('category');
    expect(spec.encoding?.x?.type).toBe('nominal');
  });

  it('compile(toChartSpec()) produces marks', () => {
    const spec = BoxPlot().data(boxData).values('value').category('category').toChartSpec();
    const result = compile(spec);
    expect(result.marks.length).toBeGreaterThan(0);
  });

  it('compile(toChartSpec()) without category produces marks', () => {
    const spec = BoxPlot().data(boxData).values('value').toChartSpec();
    const result = compile(spec);
    expect(result.marks.length).toBeGreaterThan(0);
  });
});

describe('HistogramBuilder.toChartSpec(): standard grammar pipeline', () => {
  const histData = Array.from({ length: 50 }, (_, i) => ({ age: 20 + Math.floor(i * 0.8) }));

  it('toChartSpec() produces a UnitSpec with mark histogram', () => {
    const spec = Histogram().data(histData).x('age').toChartSpec();
    expect(isUnitSpec(spec)).toBe(true);
    expect(spec.mark).toBe('histogram');
    expect(spec.encoding?.x?.field).toBe('age');
    expect(spec.encoding?.x?.type).toBe('quantitative');
  });

  it('compile(toChartSpec()) produces marks', () => {
    const spec = Histogram().data(histData).x('age').toChartSpec();
    const result = compile(spec);
    expect(result.marks.length).toBeGreaterThan(0);
  });

  it('toChartSpec() preserves bin encoding', () => {
    const spec = Histogram().data(histData).x('age').toChartSpec();
    expect(spec.encoding?.x?.bin).toBe(true);
  });
});

describe('ViolinPlotBuilder.toChartSpec(): standard grammar pipeline', () => {
  const violinData = [
    { group: 'A', score: 10 },
    { group: 'A', score: 15 },
    { group: 'A', score: 20 },
    { group: 'A', score: 25 },
    { group: 'A', score: 30 },
    { group: 'B', score: 5 },
    { group: 'B', score: 12 },
    { group: 'B', score: 18 },
    { group: 'B', score: 22 },
    { group: 'B', score: 35 },
  ];

  it('toChartSpec() produces a UnitSpec with mark violin', () => {
    const spec = ViolinPlot().data(violinData).values('score').category('group').toChartSpec();
    expect(isUnitSpec(spec)).toBe(true);
    expect(spec.mark).toBe('violin');
    expect(spec.encoding?.y?.field).toBe('score');
    expect(spec.encoding?.y?.type).toBe('quantitative');
    expect(spec.encoding?.x?.field).toBe('group');
    expect(spec.encoding?.x?.type).toBe('nominal');
  });

  it('compile(toChartSpec()) produces marks', () => {
    const spec = ViolinPlot().data(violinData).values('score').category('group').toChartSpec();
    const result = compile(spec);
    expect(result.marks.length).toBeGreaterThan(0);
  });

  it('compile(toChartSpec()) without category produces marks', () => {
    const spec = ViolinPlot().data(violinData).values('score').toChartSpec();
    const result = compile(spec);
    expect(result.marks.length).toBeGreaterThan(0);
  });
});

describe('HeatmapBuilder.toChartSpec(): standard grammar pipeline', () => {
  const heatmapData = [
    { row: 'A', col: 'X', value: 10 },
    { row: 'A', col: 'Y', value: 20 },
    { row: 'B', col: 'X', value: 30 },
    { row: 'B', col: 'Y', value: 40 },
  ];

  it('toChartSpec() produces a UnitSpec with mark rect', () => {
    const spec = Heatmap().data(heatmapData).x('col').y('row').color('value').toChartSpec();
    expect(isUnitSpec(spec)).toBe(true);
    expect(spec.mark).toBe('rect');
    expect(spec.encoding?.x?.field).toBe('col');
    expect(spec.encoding?.x?.type).toBe('ordinal');
    expect(spec.encoding?.y?.field).toBe('row');
    expect(spec.encoding?.y?.type).toBe('ordinal');
    expect(spec.encoding?.color?.field).toBe('value');
    expect(spec.encoding?.color?.type).toBe('quantitative');
  });

  it('compile(toChartSpec()) produces marks', () => {
    const spec = Heatmap().data(heatmapData).x('col').y('row').color('value').toChartSpec();
    const result = compile(spec);
    expect(result.marks.length).toBeGreaterThan(0);
  });
});

describe('Standard builders produce ChartSpec compatible with compile()', () => {
  it('BarChart.toSpec() compiles successfully', () => {
    // Verify existing standard builders still work with compile
    const { BarChart } = require('../src/components/bar-chart');
    const data = [
      { cat: 'A', val: 10 },
      { cat: 'B', val: 20 },
    ];
    const spec = BarChart().data(data).x('cat').y('val').toSpec();
    const result = compile(spec);
    expect(result.marks.length).toBeGreaterThan(0);
  });

  it('LineChart.toSpec() compiles successfully', () => {
    const { LineChart } = require('../src/components/line-chart');
    const data = [
      { x: 1, y: 10 },
      { x: 2, y: 20 },
    ];
    const spec = LineChart().data(data).x('x').y('y').toSpec();
    const result = compile(spec);
    expect(result.marks.length).toBeGreaterThan(0);
  });

  it('ScatterChart.toSpec() compiles successfully', () => {
    const { ScatterChart } = require('../src/components/scatter-chart');
    const data = [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ];
    const spec = ScatterChart().data(data).x('x').y('y').toSpec();
    const result = compile(spec);
    expect(result.marks.length).toBeGreaterThan(0);
  });

  it('PieChart.toSpec() compiles successfully', () => {
    const { PieChart } = require('../src/components/pie-chart');
    const data = [
      { cat: 'A', val: 30 },
      { cat: 'B', val: 70 },
    ];
    const spec = PieChart().data(data).theta('val').category('cat').toSpec();
    const result = compile(spec);
    expect(result.marks.length).toBeGreaterThan(0);
  });
});
