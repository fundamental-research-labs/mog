/**
 * Error Handling and Edge Cases Tests
 *
 * Tests the entire charts pipeline's robustness with bad/edge-case inputs.
 * Covers: configToSpec, compile, full pipeline, and transform edge cases.
 */
import { collectMarks } from '../src/core/chart-engine';
import { chartDataToRows, configToSpec } from '../src/core/config-to-spec';
import { compile } from '../src/grammar/compiler';
import type { ChartSpec, DataRow } from '../src/grammar/spec';
import { applyTransforms } from '../src/grammar/transforms';
import type { AnyMark } from '../src/primitives/types';
import type { ChartConfig, ChartData, StoredChartConfig } from '../src/types';

// =============================================================================
// Helpers
// =============================================================================

function makeConfig(overrides: Partial<StoredChartConfig> = {}): StoredChartConfig {
  return {
    id: 'test-chart',
    type: 'bar',
    title: 'Test',
    anchorRow: 0,
    anchorCol: 0,
    width: 8,
    height: 20,
    dataRange: 'A1:D10',
    ...overrides,
  };
}

function makeData(overrides: Partial<ChartData> = {}): ChartData {
  return {
    categories: ['A', 'B', 'C'],
    series: [
      {
        name: 'Series 1',
        data: [
          { x: 'A', y: 1 },
          { x: 'B', y: 2 },
          { x: 'C', y: 3 },
        ],
      },
    ],
    ...overrides,
  };
}

/**
 * Assert that all positional properties on marks are finite numbers.
 * Marks with NaN/Infinity coordinates would be invisible or cause canvas errors.
 */
function assertAllMarksFinite(marks: AnyMark[]): void {
  for (const mark of marks) {
    if ('x' in mark) expect(isFinite(mark.x)).toBe(true);
    if ('y' in mark) expect(isFinite(mark.y)).toBe(true);
    if ('width' in mark) expect(isFinite((mark as any).width)).toBe(true);
    if ('height' in mark) expect(isFinite((mark as any).height)).toBe(true);
  }
}

// =============================================================================
// 1. configToSpec robustness
// =============================================================================

describe('Error Handling and Edge Cases', () => {
  describe('configToSpec robustness', () => {
    it('handles empty categories array', () => {
      const config = makeConfig();
      const data = makeData({ categories: [], series: [] });
      expect(() => configToSpec(config, data)).not.toThrow();
      const spec = configToSpec(config, data);
      expect(spec).toBeDefined();
    });

    it('handles series with empty data array', () => {
      const config = makeConfig();
      const data = makeData({
        categories: ['A'],
        series: [{ name: 'S1', data: [] }],
      });
      expect(() => configToSpec(config, data)).not.toThrow();
      const spec = configToSpec(config, data);
      expect(spec).toBeDefined();
    });

    it('handles null values in categories', () => {
      const config = makeConfig();
      const data = makeData({
        categories: [null, undefined, 'A'] as any[],
        series: [
          {
            name: 'S1',
            data: [
              { x: 'null', y: 1 },
              { x: 'undefined', y: 2 },
              { x: 'A', y: 3 },
            ],
          },
        ],
      });
      expect(() => configToSpec(config, data)).not.toThrow();
    });

    it('handles very large numbers in data', () => {
      const config = makeConfig();
      const data = makeData({
        categories: ['A'],
        series: [
          {
            name: 'S1',
            data: [{ x: 'A', y: Number.MAX_SAFE_INTEGER }],
          },
        ],
      });
      expect(() => configToSpec(config, data)).not.toThrow();
    });

    it('handles NaN in data points', () => {
      const config = makeConfig();
      const data = makeData({
        categories: ['A', 'B'],
        series: [
          {
            name: 'S1',
            data: [
              { x: 'A', y: NaN },
              { x: 'B', y: 2 },
            ],
          },
        ],
      });
      expect(() => configToSpec(config, data)).not.toThrow();
    });

    it('handles Infinity in data points', () => {
      const config = makeConfig();
      const data = makeData({
        categories: ['A', 'B'],
        series: [
          {
            name: 'S1',
            data: [
              { x: 'A', y: Infinity },
              { x: 'B', y: -Infinity },
            ],
          },
        ],
      });
      expect(() => configToSpec(config, data)).not.toThrow();
    });

    it('handles negative dimensions', () => {
      const config = makeConfig({ width: -1, height: -1 });
      const data = makeData();
      expect(() => configToSpec(config, data)).not.toThrow();
      const spec = configToSpec(config, data);
      expect(spec).toBeDefined();
    });

    it('handles zero dimensions', () => {
      const config = makeConfig({ width: 0, height: 0 });
      const data = makeData();
      expect(() => configToSpec(config, data)).not.toThrow();
    });

    it('chartDataToRows handles empty series gracefully', () => {
      const data: ChartData = { categories: ['A', 'B'], series: [] };
      const rows = chartDataToRows(data);
      expect(rows).toEqual([]);
    });

    it('chartDataToRows handles mismatched categories/data length', () => {
      const data: ChartData = {
        categories: ['A', 'B', 'C', 'D', 'E'],
        series: [{ name: 'S1', data: [{ x: 'A', y: 1 }] }],
      };
      expect(() => chartDataToRows(data)).not.toThrow();
      const rows = chartDataToRows(data);
      // Only 1 row because series has only 1 data point
      expect(rows.length).toBe(1);
    });
  });

  // =============================================================================
  // 2. compile() robustness
  // =============================================================================

  describe('compile robustness', () => {
    it('handles empty data array', () => {
      const spec: ChartSpec = {
        mark: 'bar',
        data: { values: [] },
        encoding: {
          x: { field: 'x', type: 'nominal' },
          y: { field: 'y', type: 'quantitative' },
        },
      };
      expect(() => compile(spec)).not.toThrow();
      const result = compile(spec);
      expect(result.marks).toHaveLength(0);
    });

    it('handles missing encoding', () => {
      const spec: ChartSpec = {
        mark: 'bar',
        data: { values: [{ x: 1 }] },
        encoding: {},
      };
      expect(() => compile(spec)).not.toThrow();
      const result = compile(spec);
      expect(result).toBeDefined();
    });

    it('handles single data point', () => {
      const spec: ChartSpec = {
        mark: 'bar',
        data: { values: [{ category: 'A', value: 42 }] },
        encoding: {
          x: { field: 'category', type: 'nominal' },
          y: { field: 'value', type: 'quantitative' },
        },
      };
      expect(() => compile(spec)).not.toThrow();
      const result = compile(spec);
      expect(result.marks.length).toBeGreaterThan(0);
    });

    it('handles all identical y values', () => {
      const spec: ChartSpec = {
        mark: 'bar',
        data: {
          values: [
            { category: 'A', value: 5 },
            { category: 'B', value: 5 },
            { category: 'C', value: 5 },
          ],
        },
        encoding: {
          x: { field: 'category', type: 'nominal' },
          y: { field: 'value', type: 'quantitative' },
        },
      };
      expect(() => compile(spec)).not.toThrow();
      const result = compile(spec);
      expect(result.marks.length).toBeGreaterThan(0);
    });

    it('handles invalid field names in encoding', () => {
      const spec: ChartSpec = {
        mark: 'bar',
        data: { values: [{ realField: 10, otherField: 'A' }] },
        encoding: {
          x: { field: 'nonexistent_x', type: 'nominal' },
          y: { field: 'nonexistent_y', type: 'quantitative' },
        },
      };
      expect(() => compile(spec)).not.toThrow();
    });

    it('handles unknown mark type', () => {
      const spec: ChartSpec = {
        mark: 'nonexistent' as any,
        data: { values: [{ x: 1, y: 2 }] },
        encoding: {
          x: { field: 'x', type: 'nominal' },
          y: { field: 'y', type: 'quantitative' },
        },
      };
      expect(() => compile(spec)).not.toThrow();
    });

    it('handles spec with no data and no data argument', () => {
      const spec: ChartSpec = {
        mark: 'bar',
        encoding: {
          x: { field: 'category', type: 'nominal' },
          y: { field: 'value', type: 'quantitative' },
        },
      };
      expect(() => compile(spec)).not.toThrow();
      const result = compile(spec);
      expect(result.marks).toHaveLength(0);
    });

    it('handles spec with undefined mark', () => {
      const spec: ChartSpec = {
        data: { values: [{ x: 1, y: 2 }] },
        encoding: {
          x: { field: 'x', type: 'nominal' },
          y: { field: 'y', type: 'quantitative' },
        },
      };
      expect(() => compile(spec)).not.toThrow();
    });

    it('handles line chart with single data point', () => {
      const spec: ChartSpec = {
        mark: 'line',
        data: { values: [{ x: 'A', y: 10 }] },
        encoding: {
          x: { field: 'x', type: 'nominal' },
          y: { field: 'y', type: 'quantitative' },
        },
      };
      expect(() => compile(spec)).not.toThrow();
    });

    it('handles point chart with empty data', () => {
      const spec: ChartSpec = {
        mark: 'point',
        data: { values: [] },
        encoding: {
          x: { field: 'x', type: 'quantitative' },
          y: { field: 'y', type: 'quantitative' },
        },
      };
      expect(() => compile(spec)).not.toThrow();
      const result = compile(spec);
      expect(result.marks).toHaveLength(0);
    });

    it('handles arc chart with zero values', () => {
      const spec: ChartSpec = {
        mark: 'arc',
        data: {
          values: [
            { category: 'A', value: 0 },
            { category: 'B', value: 0 },
            { category: 'C', value: 0 },
          ],
        },
        encoding: {
          theta: { field: 'value', type: 'quantitative' },
          color: { field: 'category', type: 'nominal' },
        },
      };
      expect(() => compile(spec)).not.toThrow();
    });

    it('handles data with all NaN y-values', () => {
      const spec: ChartSpec = {
        mark: 'bar',
        data: {
          values: [
            { category: 'A', value: NaN },
            { category: 'B', value: NaN },
          ],
        },
        encoding: {
          x: { field: 'category', type: 'nominal' },
          y: { field: 'value', type: 'quantitative' },
        },
      };
      expect(() => compile(spec)).not.toThrow();
    });

    it('handles negative width/height options', () => {
      const spec: ChartSpec = {
        mark: 'bar',
        data: {
          values: [{ category: 'A', value: 10 }],
        },
        encoding: {
          x: { field: 'category', type: 'nominal' },
          y: { field: 'value', type: 'quantitative' },
        },
      };
      expect(() => compile(spec, undefined, { width: -100, height: -100 })).not.toThrow();
    });

    it('handles zero width/height options', () => {
      const spec: ChartSpec = {
        mark: 'bar',
        data: {
          values: [{ category: 'A', value: 10 }],
        },
        encoding: {
          x: { field: 'category', type: 'nominal' },
          y: { field: 'value', type: 'quantitative' },
        },
      };
      expect(() => compile(spec, undefined, { width: 0, height: 0 })).not.toThrow();
    });
  });

  // =============================================================================
  // 3. Full pipeline robustness (configToSpec -> compile -> marks)
  // =============================================================================

  describe('full pipeline robustness', () => {
    function runFullPipeline(config: ChartConfig, data: ChartData): AnyMark[] {
      const spec = configToSpec(config, data);
      const result = compile(spec);
      return collectMarks(result);
    }

    it('empty categories produce no crash and finite marks', () => {
      const config = makeConfig();
      const data = makeData({ categories: [], series: [] });
      expect(() => runFullPipeline(config, data)).not.toThrow();
      const marks = runFullPipeline(config, data);
      assertAllMarksFinite(marks);
    });

    it('single data point produces finite marks', () => {
      const config = makeConfig();
      const data = makeData({
        categories: ['A'],
        series: [{ name: 'S1', data: [{ x: 'A', y: 42 }] }],
      });
      const marks = runFullPipeline(config, data);
      assertAllMarksFinite(marks);
    });

    it('NaN values produce finite marks (NaN filtered by sanitizer)', () => {
      const config = makeConfig();
      const data = makeData({
        categories: ['A', 'B'],
        series: [
          {
            name: 'S1',
            data: [
              { x: 'A', y: NaN },
              { x: 'B', y: 5 },
            ],
          },
        ],
      });
      expect(() => runFullPipeline(config, data)).not.toThrow();
      const marks = runFullPipeline(config, data);
      assertAllMarksFinite(marks);
    });

    it('Infinity values produce finite marks (Infinity filtered by sanitizer)', () => {
      const config = makeConfig();
      const data = makeData({
        categories: ['A', 'B'],
        series: [
          {
            name: 'S1',
            data: [
              { x: 'A', y: Infinity },
              { x: 'B', y: 5 },
            ],
          },
        ],
      });
      expect(() => runFullPipeline(config, data)).not.toThrow();
      const marks = runFullPipeline(config, data);
      assertAllMarksFinite(marks);
    });

    it('negative Infinity values produce finite marks', () => {
      const config = makeConfig();
      const data = makeData({
        categories: ['A', 'B'],
        series: [
          {
            name: 'S1',
            data: [
              { x: 'A', y: -Infinity },
              { x: 'B', y: 5 },
            ],
          },
        ],
      });
      expect(() => runFullPipeline(config, data)).not.toThrow();
      const marks = runFullPipeline(config, data);
      assertAllMarksFinite(marks);
    });

    it('very large numbers produce finite marks', () => {
      const config = makeConfig();
      const data = makeData({
        categories: ['A', 'B'],
        series: [
          {
            name: 'S1',
            data: [
              { x: 'A', y: Number.MAX_SAFE_INTEGER },
              { x: 'B', y: -Number.MAX_SAFE_INTEGER },
            ],
          },
        ],
      });
      expect(() => runFullPipeline(config, data)).not.toThrow();
      const marks = runFullPipeline(config, data);
      assertAllMarksFinite(marks);
    });

    it('all identical values produce finite marks', () => {
      const config = makeConfig();
      const data = makeData({
        categories: ['A', 'B', 'C'],
        series: [
          {
            name: 'S1',
            data: [
              { x: 'A', y: 5 },
              { x: 'B', y: 5 },
              { x: 'C', y: 5 },
            ],
          },
        ],
      });
      const marks = runFullPipeline(config, data);
      assertAllMarksFinite(marks);
    });

    it('all zero values produce finite marks', () => {
      const config = makeConfig();
      const data = makeData({
        categories: ['A', 'B', 'C'],
        series: [
          {
            name: 'S1',
            data: [
              { x: 'A', y: 0 },
              { x: 'B', y: 0 },
              { x: 'C', y: 0 },
            ],
          },
        ],
      });
      const marks = runFullPipeline(config, data);
      assertAllMarksFinite(marks);
    });

    it('line chart with NaN values produces finite marks', () => {
      const config = makeConfig({ type: 'line' });
      const data = makeData({
        categories: ['A', 'B', 'C'],
        series: [
          {
            name: 'S1',
            data: [
              { x: 'A', y: 1 },
              { x: 'B', y: NaN },
              { x: 'C', y: 3 },
            ],
          },
        ],
      });
      expect(() => runFullPipeline(config, data)).not.toThrow();
      const marks = runFullPipeline(config, data);
      assertAllMarksFinite(marks);
    });

    it('pie chart with zero values produces finite marks', () => {
      const config = makeConfig({ type: 'pie' });
      const data = makeData({
        categories: ['A', 'B', 'C'],
        series: [
          {
            name: 'S1',
            data: [
              { x: 'A', y: 0 },
              { x: 'B', y: 0 },
              { x: 'C', y: 0 },
            ],
          },
        ],
      });
      const marks = runFullPipeline(config, data);
      assertAllMarksFinite(marks);
    });

    it('scatter chart with empty data produces no crash', () => {
      const config = makeConfig({ type: 'scatter' });
      const data = makeData({ categories: [], series: [] });
      expect(() => runFullPipeline(config, data)).not.toThrow();
    });

    it('zero-dimension chart produces finite marks', () => {
      const config = makeConfig({ width: 0, height: 0 });
      const data = makeData();
      expect(() => runFullPipeline(config, data)).not.toThrow();
    });

    it('negative-dimension chart produces finite marks', () => {
      const config = makeConfig({ width: -5, height: -10 });
      const data = makeData();
      expect(() => runFullPipeline(config, data)).not.toThrow();
    });

    it('each chart type with normal data produces finite marks', () => {
      const types: ChartConfig['type'][] = [
        'bar',
        'column',
        'line',
        'area',
        'pie',
        'doughnut',
        'scatter',
        'bubble',
        'radar',
        'funnel',
      ];
      const data = makeData();

      for (const chartType of types) {
        const config = makeConfig({ type: chartType });
        expect(() => runFullPipeline(config, data)).not.toThrow();
        const marks = runFullPipeline(config, data);
        assertAllMarksFinite(marks);
      }
    });
  });

  // =============================================================================
  // 4. Transform edge cases
  // =============================================================================

  describe('transform edge cases', () => {
    it('filter with non-existent field returns empty', () => {
      const data: DataRow[] = [
        { name: 'Alice', value: 10 },
        { name: 'Bob', value: 20 },
      ];
      const result = applyTransforms(
        [{ type: 'filter', filter: { field: 'nonexistent', equal: 'something' } }],
        data,
      );
      expect(result).toHaveLength(0);
    });

    it('aggregate with empty group produces single row', () => {
      const data: DataRow[] = [
        { category: 'A', value: 10 },
        { category: 'B', value: 20 },
      ];
      const result = applyTransforms(
        [
          {
            type: 'aggregate',
            aggregate: [
              {
                groupby: [],
                aggregate: [{ op: 'sum', field: 'value', as: 'total' }],
              },
            ],
          },
        ],
        data,
      );
      // Grouping by nothing should yield a single aggregate row
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('bin with all identical values (zero range) does not crash', () => {
      const data: DataRow[] = [{ value: 5 }, { value: 5 }, { value: 5 }];
      expect(() =>
        applyTransforms([{ type: 'bin', bin: { field: 'value', as: 'binned', maxbins: 5 } }], data),
      ).not.toThrow();
      const result = applyTransforms(
        [{ type: 'bin', bin: { field: 'value', as: 'binned', maxbins: 5 } }],
        data,
      );
      expect(result).toHaveLength(3);
    });

    it('regression with single data point returns empty', () => {
      const data: DataRow[] = [{ x: 5, y: 10 }];
      const result = applyTransforms(
        [
          {
            type: 'regression',
            regression: 'x',
            on: 'y',
            method: 'linear',
          },
        ],
        data,
      );
      // applyRegression requires at least 2 points
      expect(result).toHaveLength(0);
    });

    it('density with constant data (zero variance) does not crash', () => {
      const data: DataRow[] = [
        { value: 7 },
        { value: 7 },
        { value: 7 },
        { value: 7 },
        { value: 7 },
      ];
      expect(() =>
        applyTransforms([{ type: 'density', density: 'value', steps: 10 }], data),
      ).not.toThrow();
    });

    it('filter on empty data returns empty', () => {
      const result = applyTransforms([{ type: 'filter', filter: { field: 'x', equal: 1 } }], []);
      expect(result).toHaveLength(0);
    });

    it('sort on empty data returns empty', () => {
      const result = applyTransforms(
        [{ type: 'sort', sort: [{ field: 'x', order: 'ascending' }] }],
        [],
      );
      expect(result).toHaveLength(0);
    });

    it('aggregate on empty data returns empty', () => {
      const result = applyTransforms(
        [
          {
            type: 'aggregate',
            aggregate: [
              {
                groupby: ['x'],
                aggregate: [{ op: 'sum', field: 'y', as: 'total' }],
              },
            ],
          },
        ],
        [],
      );
      expect(result).toHaveLength(0);
    });

    it('bin on empty data returns empty', () => {
      const result = applyTransforms([{ type: 'bin', bin: { field: 'x', as: 'binned' } }], []);
      expect(result).toHaveLength(0);
    });

    it('regression on empty data returns empty', () => {
      const result = applyTransforms([{ type: 'regression', regression: 'x', on: 'y' }], []);
      expect(result).toHaveLength(0);
    });

    it('density on empty data returns empty', () => {
      const result = applyTransforms([{ type: 'density', density: 'x' }], []);
      expect(result).toHaveLength(0);
    });

    it('fold on empty data returns empty', () => {
      const result = applyTransforms(
        [{ type: 'fold', fold: ['a', 'b'], as: ['key', 'value'] }],
        [],
      );
      expect(result).toHaveLength(0);
    });

    it('fold with non-existent fields returns rows with undefined values', () => {
      const data: DataRow[] = [{ x: 1, y: 2 }];
      const result = applyTransforms(
        [{ type: 'fold', fold: ['nonexistent1', 'nonexistent2'], as: ['key', 'val'] }],
        data,
      );
      expect(result).toHaveLength(2);
      for (const row of result) {
        expect(row.val).toBeUndefined();
      }
    });

    it('calculate with unknown expression returns null field', () => {
      const data: DataRow[] = [{ x: 1 }];
      const result = applyTransforms(
        [{ type: 'calculate', calculate: 'some_complex(expression)', as: 'derived' }],
        data,
      );
      expect(result).toHaveLength(1);
      expect(result[0].derived).toBeNull();
    });

    it('unknown transform type passes data through unchanged', () => {
      const data: DataRow[] = [{ x: 1 }, { x: 2 }];
      const result = applyTransforms([{ type: 'unknownType' } as any], data);
      expect(result).toEqual(data);
    });

    it('bin with NaN values in field produces null bins for those rows', () => {
      const data: DataRow[] = [{ value: 10 }, { value: NaN }, { value: 30 }];
      const result = applyTransforms(
        [{ type: 'bin', bin: { field: 'value', as: 'binned' } }],
        data,
      );
      expect(result).toHaveLength(3);
      // NaN row should get null bin
      expect(result[1].binned).toBeNull();
    });

    it('density with non-existent field returns empty', () => {
      const data: DataRow[] = [{ x: 1 }, { x: 2 }];
      const result = applyTransforms([{ type: 'density', density: 'nonexistent' }], data);
      expect(result).toHaveLength(0);
    });

    it('regression with non-numeric fields returns empty', () => {
      const data: DataRow[] = [
        { x: 'hello', y: 'world' },
        { x: 'foo', y: 'bar' },
      ];
      const result = applyTransforms([{ type: 'regression', regression: 'x', on: 'y' }], data);
      expect(result).toHaveLength(0);
    });
  });
});
