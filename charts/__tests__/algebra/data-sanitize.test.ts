import { extendDataForLayerFields, sanitizeDataForScales } from '../../src/algebra/data-sanitize';
import type { ChartSpec, DataRow, EncodingSpec } from '../../src/grammar/spec';

// ---------------------------------------------------------------------------
// sanitizeDataForScales
// ---------------------------------------------------------------------------

describe('sanitizeDataForScales', () => {
  it('returns original array when no encoding provided', () => {
    const data: DataRow[] = [{ x: 1 }, { x: 2 }];
    const result = sanitizeDataForScales(data);
    expect(result).toBe(data); // same reference
  });

  it('returns original array when no quantitative fields', () => {
    const data: DataRow[] = [{ category: 'A' }, { category: 'B' }];
    const encoding: EncodingSpec = {
      x: { field: 'category', type: 'nominal' },
    };
    const result = sanitizeDataForScales(data, encoding);
    expect(result).toBe(data);
  });

  it('returns original array when all values are finite', () => {
    const data: DataRow[] = [{ value: 10 }, { value: 20 }, { value: -5 }];
    const encoding: EncodingSpec = {
      y: { field: 'value', type: 'quantitative' },
    };
    const result = sanitizeDataForScales(data, encoding);
    expect(result).toBe(data);
  });

  it('replaces Infinity with undefined', () => {
    const data: DataRow[] = [{ value: 10 }, { value: Infinity }, { value: 30 }];
    const encoding: EncodingSpec = {
      y: { field: 'value', type: 'quantitative' },
    };
    const result = sanitizeDataForScales(data, encoding);
    expect(result).not.toBe(data);
    expect(result[0].value).toBe(10);
    expect(result[1].value).toBeUndefined();
    expect(result[2].value).toBe(30);
  });

  it('replaces -Infinity with undefined', () => {
    const data: DataRow[] = [{ value: 5 }, { value: -Infinity }];
    const encoding: EncodingSpec = {
      y: { field: 'value', type: 'quantitative' },
    };
    const result = sanitizeDataForScales(data, encoding);
    expect(result[0].value).toBe(5);
    expect(result[1].value).toBeUndefined();
  });

  it('replaces NaN with undefined', () => {
    const data: DataRow[] = [{ value: NaN }, { value: 42 }];
    const encoding: EncodingSpec = {
      y: { field: 'value', type: 'quantitative' },
    };
    const result = sanitizeDataForScales(data, encoding);
    expect(result[0].value).toBeUndefined();
    expect(result[1].value).toBe(42);
  });

  it('only sanitizes quantitative fields (leaves nominal/ordinal/temporal untouched)', () => {
    const data: DataRow[] = [{ category: Infinity, value: Infinity }];
    const encoding: EncodingSpec = {
      x: { field: 'category', type: 'nominal' },
      y: { field: 'value', type: 'quantitative' },
    };
    const result = sanitizeDataForScales(data, encoding);
    // category is nominal => should NOT be sanitized
    expect(result[0].category).toBe(Infinity);
    // value is quantitative => should be sanitized
    expect(result[0].value).toBeUndefined();
  });

  it('handles multiple quantitative fields', () => {
    const data: DataRow[] = [
      { x: Infinity, y: NaN, z: 10 },
      { x: 5, y: -Infinity, z: 20 },
    ];
    const encoding: EncodingSpec = {
      x: { field: 'x', type: 'quantitative' },
      y: { field: 'y', type: 'quantitative' },
      size: { field: 'z', type: 'quantitative' },
    };
    const result = sanitizeDataForScales(data, encoding);
    expect(result[0].x).toBeUndefined();
    expect(result[0].y).toBeUndefined();
    expect(result[0].z).toBe(10);
    expect(result[1].x).toBe(5);
    expect(result[1].y).toBeUndefined();
    expect(result[1].z).toBe(20);
  });

  it('does not modify original data (returns new objects)', () => {
    const data: DataRow[] = [{ value: Infinity }, { value: 10 }];
    const encoding: EncodingSpec = {
      y: { field: 'value', type: 'quantitative' },
    };
    const result = sanitizeDataForScales(data, encoding);
    // Original data should be unchanged
    expect(data[0].value).toBe(Infinity);
    expect(data[1].value).toBe(10);
    // Result should be a new array with new objects
    expect(result).not.toBe(data);
    expect(result[0]).not.toBe(data[0]);
    expect(result[1]).not.toBe(data[1]);
  });

  it('empty data returns empty array', () => {
    const encoding: EncodingSpec = {
      y: { field: 'value', type: 'quantitative' },
    };
    const result = sanitizeDataForScales([], encoding);
    expect(result).toEqual([]);
  });

  it('mixed finite and non-finite values — only non-finite replaced', () => {
    const data: DataRow[] = [
      { value: 1 },
      { value: Infinity },
      { value: 3 },
      { value: NaN },
      { value: 5 },
      { value: -Infinity },
    ];
    const encoding: EncodingSpec = {
      y: { field: 'value', type: 'quantitative' },
    };
    const result = sanitizeDataForScales(data, encoding);
    expect(result[0].value).toBe(1);
    expect(result[1].value).toBeUndefined();
    expect(result[2].value).toBe(3);
    expect(result[3].value).toBeUndefined();
    expect(result[4].value).toBe(5);
    expect(result[5].value).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// extendDataForLayerFields
// ---------------------------------------------------------------------------

describe('extendDataForLayerFields', () => {
  it('returns original data when no alternative fields exist', () => {
    const data: DataRow[] = [{ x: 1, y: 10 }];
    const encoding: EncodingSpec = {
      x: { field: 'x', type: 'quantitative' },
      y: { field: 'y', type: 'quantitative' },
    };
    const layers: ChartSpec[] = [
      { mark: 'bar', encoding: { x: { field: 'x' }, y: { field: 'y' } } },
    ];
    const result = extendDataForLayerFields(data, encoding, layers);
    expect(result).toBe(data);
  });

  it('returns original data when layers use same fields as merged encoding', () => {
    const data: DataRow[] = [{ month: 'Jan', sales: 100 }];
    const encoding: EncodingSpec = {
      x: { field: 'month', type: 'nominal' },
      y: { field: 'sales', type: 'quantitative' },
    };
    const layers: ChartSpec[] = [
      { mark: 'bar', encoding: { x: { field: 'month' }, y: { field: 'sales' } } },
      { mark: 'line', encoding: { x: { field: 'month' }, y: { field: 'sales' } } },
    ];
    const result = extendDataForLayerFields(data, encoding, layers);
    expect(result).toBe(data);
  });

  it('creates synthetic rows when layers use different y fields', () => {
    const data: DataRow[] = [
      { month: 'Jan', bar_value: 100, line_value: 200 },
      { month: 'Feb', bar_value: 150, line_value: 300 },
    ];
    const encoding: EncodingSpec = {
      x: { field: 'month', type: 'nominal' },
      y: { field: 'bar_value', type: 'quantitative' },
    };
    const layers: ChartSpec[] = [
      { mark: 'bar', encoding: { x: { field: 'month' }, y: { field: 'bar_value' } } },
      { mark: 'line', encoding: { x: { field: 'month' }, y: { field: 'line_value' } } },
    ];
    const result = extendDataForLayerFields(data, encoding, layers);
    // Original 2 rows + 2 synthetic rows (one for each row's line_value -> bar_value)
    expect(result.length).toBe(4);
    expect(result[0]).toBe(data[0]); // original data preserved
    expect(result[1]).toBe(data[1]);
    // Synthetic rows map line_value values into bar_value field
    expect(result[2]).toEqual({ bar_value: 200 });
    expect(result[3]).toEqual({ bar_value: 300 });
  });

  it('creates synthetic rows when layers use different x fields', () => {
    const data: DataRow[] = [{ x1: 10, x2: 20, y: 100 }];
    const encoding: EncodingSpec = {
      x: { field: 'x1', type: 'quantitative' },
      y: { field: 'y', type: 'quantitative' },
    };
    const layers: ChartSpec[] = [
      { mark: 'point', encoding: { x: { field: 'x1' }, y: { field: 'y' } } },
      { mark: 'point', encoding: { x: { field: 'x2' }, y: { field: 'y' } } },
    ];
    const result = extendDataForLayerFields(data, encoding, layers);
    expect(result.length).toBe(2);
    expect(result[0]).toBe(data[0]);
    expect(result[1]).toEqual({ x1: 20 });
  });

  it('handles multiple alternative fields', () => {
    const data: DataRow[] = [{ month: 'Jan', series_a: 10, series_b: 20, series_c: 30 }];
    const encoding: EncodingSpec = {
      x: { field: 'month', type: 'nominal' },
      y: { field: 'series_a', type: 'quantitative' },
    };
    const layers: ChartSpec[] = [
      { mark: 'line', encoding: { x: { field: 'month' }, y: { field: 'series_a' } } },
      { mark: 'line', encoding: { x: { field: 'month' }, y: { field: 'series_b' } } },
      { mark: 'line', encoding: { x: { field: 'month' }, y: { field: 'series_c' } } },
    ];
    const result = extendDataForLayerFields(data, encoding, layers);
    // 1 original + 2 synthetic (series_b -> series_a, series_c -> series_a)
    expect(result.length).toBe(3);
    expect(result[1]).toEqual({ series_a: 20 });
    expect(result[2]).toEqual({ series_a: 30 });
  });

  it('skips null/undefined values in alternative fields', () => {
    const data: DataRow[] = [
      { month: 'Jan', bar_value: 100, line_value: null },
      { month: 'Feb', bar_value: 150, line_value: undefined },
      { month: 'Mar', bar_value: 200, line_value: 300 },
    ];
    const encoding: EncodingSpec = {
      x: { field: 'month', type: 'nominal' },
      y: { field: 'bar_value', type: 'quantitative' },
    };
    const layers: ChartSpec[] = [
      { mark: 'bar', encoding: { x: { field: 'month' }, y: { field: 'bar_value' } } },
      { mark: 'line', encoding: { x: { field: 'month' }, y: { field: 'line_value' } } },
    ];
    const result = extendDataForLayerFields(data, encoding, layers);
    // 3 original + 1 synthetic (only Mar's line_value=300 is non-null/non-undefined)
    expect(result.length).toBe(4);
    expect(result[3]).toEqual({ bar_value: 300 });
  });

  it('empty layers array', () => {
    const data: DataRow[] = [{ x: 1, y: 10 }];
    const encoding: EncodingSpec = {
      x: { field: 'x', type: 'quantitative' },
      y: { field: 'y', type: 'quantitative' },
    };
    const result = extendDataForLayerFields(data, encoding, []);
    expect(result).toBe(data);
  });

  it('merged encoding with no field set', () => {
    const data: DataRow[] = [{ x: 1, y: 10 }];
    const encoding: EncodingSpec = {
      x: { type: 'quantitative' }, // no field
      y: { type: 'quantitative' }, // no field
    };
    const layers: ChartSpec[] = [
      { mark: 'bar', encoding: { x: { field: 'x' }, y: { field: 'y' } } },
    ];
    const result = extendDataForLayerFields(data, encoding, layers);
    expect(result).toBe(data);
  });

  it('two layers with different y fields create synthetic rows for both', () => {
    const data: DataRow[] = [
      { month: 'Jan', revenue: 1000, cost: 500, profit: 500 },
      { month: 'Feb', revenue: 1200, cost: 600, profit: 600 },
    ];
    const encoding: EncodingSpec = {
      x: { field: 'month', type: 'nominal' },
      y: { field: 'revenue', type: 'quantitative' },
    };
    const layers: ChartSpec[] = [
      { mark: 'bar', encoding: { x: { field: 'month' }, y: { field: 'revenue' } } },
      { mark: 'line', encoding: { x: { field: 'month' }, y: { field: 'cost' } } },
      { mark: 'line', encoding: { x: { field: 'month' }, y: { field: 'profit' } } },
    ];
    const result = extendDataForLayerFields(data, encoding, layers);
    // 2 original rows + 4 synthetic (2 rows * 2 alt fields: cost, profit)
    expect(result.length).toBe(6);
    // Verify synthetic rows contain the mapped values
    const syntheticRows = result.slice(2);
    const syntheticValues = syntheticRows.map((r) => r.revenue);
    expect(syntheticValues).toContain(500); // cost from Jan
    expect(syntheticValues).toContain(600); // cost or profit from Feb
  });
});
