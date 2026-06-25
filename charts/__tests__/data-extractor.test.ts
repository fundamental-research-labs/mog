/**
 * Tests for data extractor utilities
 */
import {
  detectSeriesOrientation,
  extractChartData,
  extractChartDataFromRange,
  ObjectCellAccessor,
  parseRange,
} from '../src/core/data-extractor';
import type { StoredChartConfig } from '../src/types';

describe('parseRange', () => {
  // Note: parseRange now uses the canonical CellRange format from contracts
  // { startRow, startCol, endRow, endCol } instead of { start, end }

  it('parses simple ranges', () => {
    expect(parseRange('A1:B2')).toEqual({
      startRow: 0,
      startCol: 0,
      endRow: 1,
      endCol: 1,
    });
  });

  it('parses larger ranges', () => {
    expect(parseRange('A1:Z100')).toEqual({
      startRow: 0,
      startCol: 0,
      endRow: 99,
      endCol: 25,
    });
  });

  it('normalizes reversed ranges', () => {
    expect(parseRange('B2:A1')).toEqual({
      startRow: 0,
      startCol: 0,
      endRow: 1,
      endCol: 1,
    });
  });

  it('handles single cell as 1x1 range', () => {
    expect(parseRange('A1')).toEqual({
      startRow: 0,
      startCol: 0,
      endRow: 0,
      endCol: 0,
    });
  });

  it('throws on invalid ranges', () => {
    // parseA1Range from contracts throws on invalid formats
    expect(() => parseRange('')).toThrow();
    expect(() => parseRange('invalid')).toThrow();
  });
});

describe('detectSeriesOrientation', () => {
  it('returns columns for tall ranges', () => {
    const range = parseRange('A1:B10');
    expect(detectSeriesOrientation(range)).toBe('columns');
  });

  it('returns rows for wide ranges', () => {
    const range = parseRange('A1:J2');
    expect(detectSeriesOrientation(range)).toBe('rows');
  });

  it('returns columns for square ranges', () => {
    const range = parseRange('A1:E5');
    expect(detectSeriesOrientation(range)).toBe('columns');
  });

  it('returns rows for single-column ranges (Nx1)', () => {
    // Single column should return 'rows' so all values become one series
    const range = parseRange('A1:A5');
    expect(detectSeriesOrientation(range)).toBe('rows');
  });

  it('returns columns for single-row ranges (1xN)', () => {
    // Single row should return 'columns' so all values become one series
    const range = parseRange('A1:E1');
    expect(detectSeriesOrientation(range)).toBe('columns');
  });

  it('returns rows for single-cell ranges (1x1)', () => {
    // Single cell (degenerate case) - treated as single column
    const range = parseRange('A1');
    expect(detectSeriesOrientation(range)).toBe('rows');
  });
});

describe('ObjectCellAccessor', () => {
  it('retrieves values by row and column', () => {
    const accessor = new ObjectCellAccessor({
      A1: 'Header',
      B1: 100,
      A2: 'Row1',
      B2: 200,
    });

    expect(accessor.getValue(0, 0)).toBe('Header');
    expect(accessor.getValue(0, 1)).toBe(100);
    expect(accessor.getValue(1, 0)).toBe('Row1');
    expect(accessor.getValue(1, 1)).toBe(200);
  });

  it('returns undefined for missing values', () => {
    const accessor = new ObjectCellAccessor({ A1: 'Value' });
    expect(accessor.getValue(10, 10)).toBeUndefined();
  });

  it('creates from 2D array', () => {
    const accessor = ObjectCellAccessor.fromArray([
      ['A', 'B', 'C'],
      [1, 2, 3],
      [4, 5, 6],
    ]);

    expect(accessor.getValue(0, 0)).toBe('A');
    expect(accessor.getValue(0, 2)).toBe('C');
    expect(accessor.getValue(1, 0)).toBe(1);
    expect(accessor.getValue(2, 2)).toBe(6);
  });
});

describe('extractChartData', () => {
  it('extracts data with rows orientation', () => {
    const accessor = ObjectCellAccessor.fromArray([
      ['Category', 'Jan', 'Feb', 'Mar'],
      ['Sales', 100, 150, 200],
      ['Expenses', 80, 90, 110],
    ]);

    const config: StoredChartConfig = {
      id: 'test-chart',
      type: 'column',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 15,
      dataRange: 'A1:D3',
      seriesOrientation: 'rows',
    };

    const data = extractChartData(accessor, config);

    expect(data.categories).toEqual(['Jan', 'Feb', 'Mar']);
    expect(data.series).toHaveLength(2);
    expect(data.series[0].name).toBe('Sales');
    expect(data.series[0].data.map((d) => d.y)).toEqual([100, 150, 200]);
    expect(data.series[1].name).toBe('Expenses');
    expect(data.series[1].data.map((d) => d.y)).toEqual([80, 90, 110]);
  });

  it('extracts data with columns orientation', () => {
    // In columns orientation, the first column contains category labels
    // and each subsequent column is a data series.
    const accessor = ObjectCellAccessor.fromArray([
      ['Month', 'Sales', 'Expenses'],
      ['Jan', 100, 80],
      ['Feb', 150, 90],
      ['Mar', 200, 110],
    ]);

    const config: StoredChartConfig = {
      id: 'test-chart',
      type: 'bar',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 15,
      dataRange: 'A1:C4',
      seriesOrientation: 'columns',
    };

    const data = extractChartData(accessor, config);

    expect(data.categories).toEqual(['Jan', 'Feb', 'Mar']);
    expect(data.series).toHaveLength(2);
    expect(data.series[0].name).toBe('Sales');
    expect(data.series[1].name).toBe('Expenses');
  });

  it('handles numeric data correctly', () => {
    const accessor = ObjectCellAccessor.fromArray([
      ['Q1', 'Q2', 'Q3', 'Q4'],
      [1000, 1200, 1100, 1500],
    ]);

    const config: StoredChartConfig = {
      id: 'test-chart',
      type: 'line',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 15,
      dataRange: 'A1:D2',
      seriesOrientation: 'rows',
    };

    const data = extractChartData(accessor, config);

    expect(data.series[0].data.map((d) => d.y)).toEqual([1000, 1200, 1100, 1500]);
  });

  it('handles missing/empty values as 0', () => {
    const accessor = ObjectCellAccessor.fromArray([
      ['A', 'B', 'C'],
      [100, null, 300],
      [undefined, 200, ''],
    ]);

    const config: StoredChartConfig = {
      id: 'test-chart',
      type: 'column',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 15,
      dataRange: 'A1:C3',
      seriesOrientation: 'rows',
    };

    const data = extractChartData(accessor, config);

    expect(data.series[0].data.map((d) => d.y)).toEqual([100, 0, 300]);
    expect(data.series[1].data.map((d) => d.y)).toEqual([0, 200, 0]);
  });

  it('returns empty data for missing range', () => {
    const accessor = new ObjectCellAccessor({});
    const config: StoredChartConfig = {
      id: 'test-chart',
      type: 'column',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 15,
      dataRange: '',
    };

    const data = extractChartData(accessor, config);

    expect(data.categories).toEqual([]);
    expect(data.series).toEqual([]);
  });

  it('returns empty data for malformed imported chart data ranges', () => {
    const accessor = ObjectCellAccessor.fromArray([
      ['Jan', 'Feb'],
      [100, 200],
    ]);
    const config: StoredChartConfig = {
      id: 'broken-chart',
      type: 'column',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 15,
      dataRange: 'Dashboard!#REF!',
    };

    expect(extractChartData(accessor, config)).toEqual({ categories: [], series: [] });
  });

  it('ignores malformed imported category and series label ranges', () => {
    const accessor = ObjectCellAccessor.fromArray([
      ['Jan', 'Feb', 'Mar'],
      [100, 150, 200],
      [80, 90, 110],
    ]);
    const config: StoredChartConfig = {
      id: 'broken-label-chart',
      type: 'column',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 15,
      dataRange: 'A1:C3',
      categoryRange: 'Dashboard!#REF!',
      seriesRange: "'Deleted Sheet'!#REF!",
      seriesOrientation: 'rows',
    };

    const data = extractChartData(accessor, config);

    expect(data.categories).toEqual(['Jan', 'Feb', 'Mar']);
    expect(data.series).toHaveLength(2);
    expect(data.series[0].name).toBe('Series 1');
    expect(data.series[0].data.map((d) => d.y)).toEqual([100, 150, 200]);
  });

  it('uses explicit category range', () => {
    const accessor = ObjectCellAccessor.fromArray([
      ['Jan', 'Feb', 'Mar'],
      [100, 150, 200],
      [80, 90, 110],
    ]);

    const config: StoredChartConfig = {
      id: 'test-chart',
      type: 'column',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 15,
      dataRange: 'A2:C3',
      categoryRange: 'A1:C1',
      seriesOrientation: 'rows',
    };

    const data = extractChartData(accessor, config);

    expect(data.categories).toEqual(['Jan', 'Feb', 'Mar']);
    expect(data.series).toHaveLength(2);
    expect(data.series[0].data.map((d) => d.y)).toEqual([100, 150, 200]);
  });

  it('uses explicit series range for names', () => {
    // Setup: labels in A1:B1, data in A2:B3
    const accessor = ObjectCellAccessor.fromArray([
      ['Sales', 'Expenses'], // Row 1: Series labels
      [100, 80], // Row 2: First data row
      [150, 90], // Row 3: Second data row
    ]);

    const config: StoredChartConfig = {
      id: 'test-chart',
      type: 'column',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 15,
      dataRange: 'A2:B3', // Data rows only
      seriesRange: 'A1:B1', // Series names in first row
      categoryRange: 'A2:A3', // Categories from first column of data
      seriesOrientation: 'columns', // Series are in columns
    };

    const data = extractChartData(accessor, config);

    expect(data.series[0].name).toBe('Sales');
    expect(data.series[1].name).toBe('Expenses');
  });

  it('auto-detects Excel-style header row and category column tables', () => {
    const accessor = ObjectCellAccessor.fromArray([
      ['Input', 'Computed'],
      [1, 10],
      [2, 20],
      [3, 30],
      [4, 40],
    ]);

    const config: StoredChartConfig = {
      id: 'test-chart',
      type: 'column',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 15,
      dataRange: 'A1:B5',
    };

    const data = extractChartData(accessor, config);

    expect(data.categories).toEqual([1, 2, 3, 4]);
    expect(data.series).toHaveLength(1);
    expect(data.series[0].name).toBe('Computed');
    expect(data.series[0].data.map((d) => d.y)).toEqual([10, 20, 30, 40]);
  });
});

describe('extractChartData - single-dimension ranges', () => {
  it('extracts single column range (A1:A5) as one series with 5 data points', () => {
    // This is the core bug fix: A1:A5 with values 1-5 should produce
    // 1 series with 5 data points, not 4 series with 1 data point each
    const accessor = ObjectCellAccessor.fromArray([[1], [2], [3], [4], [5]]);

    const config: StoredChartConfig = {
      id: 'test-chart',
      type: 'line',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 15,
      dataRange: 'A1:A5',
    };

    const data = extractChartData(accessor, config);

    // Should have 1 series with 5 data points
    expect(data.series).toHaveLength(1);
    expect(data.series[0].data).toHaveLength(5);
    expect(data.series[0].data.map((d) => d.y)).toEqual([1, 2, 3, 4, 5]);
    expect(data.series[0].name).toBe('Series 1');
    // Categories should be numeric indices (1-based)
    expect(data.categories).toEqual([1, 2, 3, 4, 5]);
  });

  it('extracts single row range (A1:E1) as one series with 5 data points', () => {
    const accessor = ObjectCellAccessor.fromArray([[10, 20, 30, 40, 50]]);

    const config: StoredChartConfig = {
      id: 'test-chart',
      type: 'line',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 15,
      dataRange: 'A1:E1',
    };

    const data = extractChartData(accessor, config);

    // Should have 1 series with 5 data points
    expect(data.series).toHaveLength(1);
    expect(data.series[0].data).toHaveLength(5);
    expect(data.series[0].data.map((d) => d.y)).toEqual([10, 20, 30, 40, 50]);
    expect(data.series[0].name).toBe('Series 1');
    // Categories should be numeric indices (1-based)
    expect(data.categories).toEqual([1, 2, 3, 4, 5]);
  });

  it('extracts single cell range (A1:A1) as one series with 1 data point', () => {
    const accessor = ObjectCellAccessor.fromArray([[42]]);

    const config: StoredChartConfig = {
      id: 'test-chart',
      type: 'line',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 15,
      dataRange: 'A1:A1',
    };

    const data = extractChartData(accessor, config);

    // Should have 1 series with 1 data point
    expect(data.series).toHaveLength(1);
    expect(data.series[0].data).toHaveLength(1);
    expect(data.series[0].data[0].y).toBe(42);
    expect(data.categories).toEqual([1]);
  });

  it('handles null/undefined values in single-column range', () => {
    const accessor = ObjectCellAccessor.fromArray([[1], [null], [3], [undefined], [5]]);

    const config: StoredChartConfig = {
      id: 'test-chart',
      type: 'line',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 15,
      dataRange: 'A1:A5',
    };

    const data = extractChartData(accessor, config);

    expect(data.series[0].data.map((d) => d.y)).toEqual([1, 0, 3, 0, 5]);
  });

  it('preserves normal 2x2 range behavior', () => {
    // Make sure we didn't break normal multi-dimensional behavior
    const accessor = ObjectCellAccessor.fromArray([
      ['Q1', 'Q2'],
      [100, 200],
    ]);

    const config: StoredChartConfig = {
      id: 'test-chart',
      type: 'column',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 15,
      dataRange: 'A1:B2',
      seriesOrientation: 'rows',
    };

    const data = extractChartData(accessor, config);

    // Should still use first row as categories, remaining rows as series
    expect(data.categories).toEqual(['Q1', 'Q2']);
    expect(data.series).toHaveLength(1);
    expect(data.series[0].data.map((d) => d.y)).toEqual([100, 200]);
  });
});

describe('extractChartDataFromRange - single-dimension ranges', () => {
  it('extracts single column range as one series with data points', () => {
    const accessor = ObjectCellAccessor.fromArray([[1], [2], [3], [4], [5]]);
    const dataRange = parseRange('A1:A5');

    const data = extractChartDataFromRange(accessor, dataRange);

    expect(data.series).toHaveLength(1);
    expect(data.series[0].data).toHaveLength(5);
    expect(data.series[0].data.map((d) => d.y)).toEqual([1, 2, 3, 4, 5]);
    expect(data.categories).toEqual([1, 2, 3, 4, 5]);
  });

  it('extracts single row range as one series with data points', () => {
    const accessor = ObjectCellAccessor.fromArray([[10, 20, 30, 40, 50]]);
    const dataRange = parseRange('A1:E1');

    const data = extractChartDataFromRange(accessor, dataRange);

    expect(data.series).toHaveLength(1);
    expect(data.series[0].data).toHaveLength(5);
    expect(data.series[0].data.map((d) => d.y)).toEqual([10, 20, 30, 40, 50]);
    expect(data.categories).toEqual([1, 2, 3, 4, 5]);
  });

  it('uses series name from seriesRange for single-dimension data', () => {
    const accessor = new ObjectCellAccessor({
      A1: 'Revenue',
      B1: 100,
      B2: 200,
      B3: 300,
    });
    const dataRange = parseRange('B1:B3');
    const seriesRange = parseRange('A1');

    const data = extractChartDataFromRange(accessor, dataRange, { seriesRange });

    expect(data.series).toHaveLength(1);
    expect(data.series[0].name).toBe('Revenue');
    expect(data.series[0].data.map((d) => d.y)).toEqual([100, 200, 300]);
  });

  it('reads sheet-tagged data, category, and series ranges through the accessor', () => {
    const values = new Map<string, string | number>([
      ['data:0,1', 10],
      ['data:1,1', 20],
      ['labels:0,0', 'Jan'],
      ['labels:1,0', 'Feb'],
      ['meta:0,0', 'Revenue'],
    ]);
    const accessor = {
      getValue: (row: number, col: number, sheetId?: string) =>
        values.get(`${sheetId}:${row},${col}`) ?? null,
    };

    const data = extractChartDataFromRange(
      accessor,
      { ...parseRange('B1:B2'), sheetId: 'data' },
      {
        categoryRange: { ...parseRange('A1:A2'), sheetId: 'labels' },
        seriesRange: { ...parseRange('A1'), sheetId: 'meta' },
        seriesOrientation: 'columns',
      },
    );

    expect(data.categories).toEqual(['Jan', 'Feb']);
    expect(data.series[0].name).toBe('Revenue');
    expect(data.series[0].data.map((d) => d.y)).toEqual([10, 20]);
  });

  it('handles single cell range edge case', () => {
    const accessor = ObjectCellAccessor.fromArray([[99]]);
    const dataRange = parseRange('A1');

    const data = extractChartDataFromRange(accessor, dataRange);

    expect(data.series).toHaveLength(1);
    expect(data.series[0].data).toHaveLength(1);
    expect(data.series[0].data[0].y).toBe(99);
    expect(data.categories).toEqual([1]);
  });

  it('uses explicit categories for single-column data', () => {
    const accessor = new ObjectCellAccessor({
      A1: 'Jan',
      A2: 'Feb',
      A3: 'Mar',
      B1: 100,
      B2: 200,
      B3: 300,
    });
    const dataRange = parseRange('B1:B3');
    const categoryRange = parseRange('A1:A3');

    const data = extractChartDataFromRange(accessor, dataRange, { categoryRange });

    expect(data.categories).toEqual(['Jan', 'Feb', 'Mar']);
    expect(data.series).toHaveLength(1);
    expect(data.series[0].data.map((d) => d.y)).toEqual([100, 200, 300]);
  });

  it('auto-detects Excel-style header row and category column tables', () => {
    const accessor = ObjectCellAccessor.fromArray([
      ['Input', 'Computed'],
      [1, 10],
      [2, 90],
      [3, 30],
      [4, 40],
    ]);
    const dataRange = parseRange('A1:B5');

    const data = extractChartDataFromRange(accessor, dataRange);

    expect(data.categories).toEqual([1, 2, 3, 4]);
    expect(data.series).toHaveLength(1);
    expect(data.series[0].name).toBe('Computed');
    expect(data.series[0].data.map((d) => d.y)).toEqual([10, 90, 30, 40]);
  });
});
