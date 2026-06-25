/**
 * Integration tests for data extraction flow.
 *
 * Tests that data extraction from cell accessor (simulating Store)
 * works correctly with the charts package.
 *
 * This tests the composition: CellDataAccessor → extractChartData → ChartData
 */

import {
  CellDataAccessor,
  ChartCellValue,
  detectSeriesOrientation,
  extractChartData,
  ObjectCellAccessor,
  parseRange,
} from '../../src/core/data-extractor';
import type { StoredChartConfig } from '../../src/types';

/**
 * Create a minimal chart config for testing
 */
function createTestConfig(overrides: Partial<StoredChartConfig> = {}): StoredChartConfig {
  return {
    id: 'test-chart',
    type: 'column',
    anchorRow: 0,
    anchorCol: 0,
    width: 8,
    height: 15,
    dataRange: 'A1:D5',
    ...overrides,
  };
}

/**
 * Simulates how Store would provide cell data
 * This is the integration point between engine and charts package
 */
class MockStoreCellAccessor implements CellDataAccessor {
  private cells: Map<string, ChartCellValue> = new Map();

  constructor(data: [row: number, col: number, value: ChartCellValue][]) {
    for (const [row, col, value] of data) {
      this.cells.set(`${row},${col}`, value);
    }
  }

  getValue(row: number, col: number): ChartCellValue {
    return this.cells.get(`${row},${col}`);
  }

  static fromGrid(grid: ChartCellValue[][]): MockStoreCellAccessor {
    const data: [number, number, ChartCellValue][] = [];
    for (let row = 0; row < grid.length; row++) {
      for (let col = 0; col < grid[row].length; col++) {
        if (grid[row][col] !== undefined) {
          data.push([row, col, grid[row][col]]);
        }
      }
    }
    return new MockStoreCellAccessor(data);
  }
}

describe('Data Extraction Flow Integration', () => {
  describe('numeric data extraction', () => {
    it('extracts integer values correctly', () => {
      const accessor = MockStoreCellAccessor.fromGrid([
        ['Q1', 'Q2', 'Q3', 'Q4'],
        [100, 200, 300, 400],
        [150, 250, 350, 450],
      ]);

      const config = createTestConfig({
        dataRange: 'A1:D3',
        seriesOrientation: 'rows',
      });

      const data = extractChartData(accessor, config);

      expect(data.series).toHaveLength(2);
      expect(data.series[0].data.map((d) => d.y)).toEqual([100, 200, 300, 400]);
      expect(data.series[1].data.map((d) => d.y)).toEqual([150, 250, 350, 450]);
    });

    it('extracts decimal values correctly', () => {
      const accessor = MockStoreCellAccessor.fromGrid([
        ['A', 'B', 'C'],
        [1.5, 2.75, 3.125],
      ]);

      const config = createTestConfig({
        dataRange: 'A1:C2',
        seriesOrientation: 'rows',
      });

      const data = extractChartData(accessor, config);

      expect(data.series[0].data.map((d) => d.y)).toEqual([1.5, 2.75, 3.125]);
    });

    it('extracts negative values correctly', () => {
      const accessor = MockStoreCellAccessor.fromGrid([
        ['Cat1', 'Cat2', 'Cat3'],
        [-100, 50, -25],
      ]);

      const config = createTestConfig({
        dataRange: 'A1:C2',
        seriesOrientation: 'rows',
      });

      const data = extractChartData(accessor, config);

      expect(data.series[0].data.map((d) => d.y)).toEqual([-100, 50, -25]);
    });

    it('extracts very large numbers correctly', () => {
      const accessor = MockStoreCellAccessor.fromGrid([
        ['X', 'Y'],
        [1000000000, 9999999999],
      ]);

      const config = createTestConfig({
        dataRange: 'A1:B2',
        seriesOrientation: 'rows',
      });

      const data = extractChartData(accessor, config);

      expect(data.series[0].data.map((d) => d.y)).toEqual([1000000000, 9999999999]);
    });

    it('extracts very small numbers correctly', () => {
      // Use explicit ranges to isolate the numeric data
      const accessor = MockStoreCellAccessor.fromGrid([['Precision'], [0.000001], [0.0000001]]);

      const config = createTestConfig({
        dataRange: 'A2:A3',
        categoryRange: 'A1:A1',
        seriesOrientation: 'columns',
      });

      const data = extractChartData(accessor, config);

      expect(data.categories).toEqual(['Precision', 2]);
      expect(data.series[0].data[0].y).toBeCloseTo(0.000001, 10);
    });
  });

  describe('string labels extraction', () => {
    it('extracts category labels from first row', () => {
      const accessor = MockStoreCellAccessor.fromGrid([
        ['January', 'February', 'March', 'April'],
        [100, 150, 200, 175],
      ]);

      const config = createTestConfig({
        dataRange: 'A1:D2',
        seriesOrientation: 'rows',
      });

      const data = extractChartData(accessor, config);

      expect(data.categories).toEqual(['January', 'February', 'March', 'April']);
    });

    it('extracts category labels from first column', () => {
      const accessor = MockStoreCellAccessor.fromGrid([
        ['Product A', 100],
        ['Product B', 200],
        ['Product C', 300],
      ]);

      const config = createTestConfig({
        dataRange: 'A1:B3',
        seriesOrientation: 'columns',
      });

      const data = extractChartData(accessor, config);

      expect(data.categories).toEqual(['Product A', 'Product B', 'Product C']);
    });

    it('handles unicode labels', () => {
      const accessor = MockStoreCellAccessor.fromGrid([
        ['日本語', '中文', '한국어', 'العربية'],
        [100, 200, 300, 400],
      ]);

      const config = createTestConfig({
        dataRange: 'A1:D2',
        seriesOrientation: 'rows',
      });

      const data = extractChartData(accessor, config);

      expect(data.categories).toEqual(['日本語', '中文', '한국어', 'العربية']);
    });

    it('handles emoji labels', () => {
      const accessor = MockStoreCellAccessor.fromGrid([
        ['🍎', '🍊', '🍋', '🍇'],
        [10, 20, 30, 40],
      ]);

      const config = createTestConfig({
        dataRange: 'A1:D2',
        seriesOrientation: 'rows',
      });

      const data = extractChartData(accessor, config);

      expect(data.categories).toEqual(['🍎', '🍊', '🍋', '🍇']);
    });

    it('handles special characters in labels', () => {
      const accessor = MockStoreCellAccessor.fromGrid([
        ["O'Brien", 'Smith & Co', 'Test "quoted"', 'A/B'],
        [100, 200, 300, 400],
      ]);

      const config = createTestConfig({
        dataRange: 'A1:D2',
        seriesOrientation: 'rows',
      });

      const data = extractChartData(accessor, config);

      expect(data.categories).toEqual(["O'Brien", 'Smith & Co', 'Test "quoted"', 'A/B']);
    });
  });

  describe('mixed data (headers + values)', () => {
    it('extracts typical spreadsheet data with headers and values', () => {
      // Typical spreadsheet layout:
      // |        | Q1  | Q2  | Q3  |
      // | Sales  | 100 | 150 | 200 |
      // | Costs  | 80  | 90  | 110 |
      const accessor = MockStoreCellAccessor.fromGrid([
        ['', 'Q1', 'Q2', 'Q3'],
        ['Sales', 100, 150, 200],
        ['Costs', 80, 90, 110],
      ]);

      const config = createTestConfig({
        dataRange: 'B2:D3', // Only the numeric data
        categoryRange: 'B1:D1', // Category headers
        seriesRange: 'A2:A3', // Series names
        seriesOrientation: 'rows',
      });

      const data = extractChartData(accessor, config);

      expect(data.categories).toEqual(['Q1', 'Q2', 'Q3']);
      expect(data.series).toHaveLength(2);
      expect(data.series[0].name).toBe('Sales');
      expect(data.series[1].name).toBe('Costs');
      expect(data.series[0].data.map((d) => d.y)).toEqual([100, 150, 200]);
      expect(data.series[1].data.map((d) => d.y)).toEqual([80, 90, 110]);
    });

    it('handles numeric category labels (years, months)', () => {
      const accessor = MockStoreCellAccessor.fromGrid([
        [2020, 2021, 2022, 2023],
        [1000, 1200, 1500, 1800],
      ]);

      const config = createTestConfig({
        dataRange: 'A1:D2',
        seriesOrientation: 'rows',
      });

      const data = extractChartData(accessor, config);

      // Numeric categories should be converted to strings
      expect(data.categories).toEqual(['2020', '2021', '2022', '2023']);
    });

    it('handles boolean values in data', () => {
      const accessor = MockStoreCellAccessor.fromGrid([
        ['Feature', 'Enabled'],
        ['A', true],
        ['B', false],
        ['C', true],
      ]);

      const config = createTestConfig({
        dataRange: 'B2:B4', // Only the boolean data
        categoryRange: 'A2:A4', // Feature names as categories
        seriesOrientation: 'columns',
      });

      const data = extractChartData(accessor, config);

      // Boolean true = 1, false = 0
      expect(data.series[0].data.map((d) => d.y)).toEqual([1, 0, 1]);
    });
  });

  describe('empty cells handling', () => {
    it('converts null cells to 0', () => {
      const accessor = MockStoreCellAccessor.fromGrid([
        ['A', 'B', 'C'],
        [100, null, 300],
      ]);

      const config = createTestConfig({
        dataRange: 'A1:C2',
        seriesOrientation: 'rows',
      });

      const data = extractChartData(accessor, config);

      expect(data.series[0].data.map((d) => d.y)).toEqual([100, 0, 300]);
    });

    it('converts undefined cells to 0', () => {
      const accessor = MockStoreCellAccessor.fromGrid([
        ['A', 'B', 'C'],
        [100, undefined, 300],
      ]);

      const config = createTestConfig({
        dataRange: 'A1:C2',
        seriesOrientation: 'rows',
      });

      const data = extractChartData(accessor, config);

      expect(data.series[0].data.map((d) => d.y)).toEqual([100, 0, 300]);
    });

    it('converts empty string cells to 0', () => {
      const accessor = MockStoreCellAccessor.fromGrid([
        ['A', 'B', 'C'],
        [100, '', 300],
      ]);

      const config = createTestConfig({
        dataRange: 'A1:C2',
        seriesOrientation: 'rows',
      });

      const data = extractChartData(accessor, config);

      expect(data.series[0].data.map((d) => d.y)).toEqual([100, 0, 300]);
    });

    it('handles sparse data (many empty cells)', () => {
      const accessor = MockStoreCellAccessor.fromGrid([
        ['A', 'B', 'C', 'D', 'E'],
        [100, null, null, null, 500],
      ]);

      const config = createTestConfig({
        dataRange: 'A1:E2',
        seriesOrientation: 'rows',
      });

      const data = extractChartData(accessor, config);

      expect(data.series[0].data.map((d) => d.y)).toEqual([100, 0, 0, 0, 500]);
    });

    it('handles completely empty row', () => {
      const accessor = MockStoreCellAccessor.fromGrid([
        ['A', 'B', 'C'],
        [100, 200, 300],
        [null, null, null],
        [400, 500, 600],
      ]);

      const config = createTestConfig({
        dataRange: 'A1:C4',
        seriesOrientation: 'rows',
      });

      const data = extractChartData(accessor, config);

      expect(data.series).toHaveLength(3);
      expect(data.series[1].data.map((d) => d.y)).toEqual([0, 0, 0]);
    });

    it('handles non-numeric strings as 0', () => {
      const accessor = MockStoreCellAccessor.fromGrid([
        ['A', 'B', 'C'],
        [100, 'not a number', 300],
      ]);

      const config = createTestConfig({
        dataRange: 'A1:C2',
        seriesOrientation: 'rows',
      });

      const data = extractChartData(accessor, config);

      expect(data.series[0].data.map((d) => d.y)).toEqual([100, 0, 300]);
    });

    it('parses numeric strings correctly', () => {
      const accessor = MockStoreCellAccessor.fromGrid([
        ['A', 'B', 'C'],
        ['100', '200.5', '300'],
      ]);

      const config = createTestConfig({
        dataRange: 'A1:C2',
        seriesOrientation: 'rows',
      });

      const data = extractChartData(accessor, config);

      expect(data.series[0].data.map((d) => d.y)).toEqual([100, 200.5, 300]);
    });
  });

  describe('series orientation auto-detection', () => {
    it('auto-detects columns orientation for tall ranges', () => {
      // 10 rows x 3 cols -> columns orientation (taller than wide)
      const range = parseRange('A1:C10');
      expect(detectSeriesOrientation(range)).toBe('columns');
    });

    it('auto-detects rows orientation for wide ranges', () => {
      // 2 rows x 10 cols -> rows orientation (wider than tall)
      const range = parseRange('A1:J2');
      expect(detectSeriesOrientation(range)).toBe('rows');
    });

    it('defaults to columns for square ranges', () => {
      const range = parseRange('A1:E5');
      expect(detectSeriesOrientation(range)).toBe('columns');
    });

    it('extraction uses correct orientation for tall data', () => {
      const accessor = MockStoreCellAccessor.fromGrid([
        ['Category', 'Value'],
        ['A', 100],
        ['B', 200],
        ['C', 300],
        ['D', 400],
        ['E', 500],
      ]);

      const config = createTestConfig({
        dataRange: 'A1:B6',
        // No explicit orientation - should auto-detect
      });

      const data = extractChartData(accessor, config);

      // Auto extraction uses Excel-style table inference: first row is headers,
      // first column is categories, remaining columns are series.
      expect(data.categories).toEqual(['A', 'B', 'C', 'D', 'E']);
      expect(data.series).toHaveLength(1);
      expect(data.series[0].name).toBe('Value');
      expect(data.series[0].data.map((d) => d.y)).toEqual([100, 200, 300, 400, 500]);
    });

    it('extraction uses correct orientation for wide data', () => {
      const accessor = MockStoreCellAccessor.fromGrid([
        ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
        [100, 150, 200, 175, 225, 250],
      ]);

      const config = createTestConfig({
        dataRange: 'A1:F2',
        // No explicit orientation - should auto-detect
      });

      const data = extractChartData(accessor, config);

      expect(data.categories).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']);
      expect(data.series).toHaveLength(1);
    });
  });

  describe('large dataset performance', () => {
    it('handles 1000 rows efficiently', () => {
      const grid: ChartCellValue[][] = [['Category', 'Value']];
      for (let i = 0; i < 1000; i++) {
        grid.push([`Row ${i}`, i * 10]);
      }

      const accessor = MockStoreCellAccessor.fromGrid(grid);
      const config = createTestConfig({
        dataRange: 'A1:B1001',
        seriesOrientation: 'columns',
      });

      const start = performance.now();
      const data = extractChartData(accessor, config);
      const elapsed = performance.now() - start;

      expect(data.series).toHaveLength(1);
      expect(data.series[0].data).toHaveLength(1000);
      expect(elapsed).toBeLessThan(100); // Should complete in <100ms
    });

    it('handles 100 columns efficiently', () => {
      const headers: ChartCellValue[] = [];
      const values: ChartCellValue[] = [];
      for (let i = 0; i < 100; i++) {
        headers.push(`Col ${i}`);
        values.push(i * 10);
      }

      const accessor = MockStoreCellAccessor.fromGrid([headers, values]);
      const config = createTestConfig({
        dataRange: 'A1:CV2', // CV is column 100
        seriesOrientation: 'rows',
      });

      const start = performance.now();
      const data = extractChartData(accessor, config);
      const elapsed = performance.now() - start;

      expect(data.categories.length).toBe(100);
      expect(elapsed).toBeLessThan(50); // Should complete in <50ms
    });

    it('handles 10K cells (100x100 grid) efficiently', () => {
      const grid: ChartCellValue[][] = [];
      for (let row = 0; row < 100; row++) {
        const rowData: ChartCellValue[] = [];
        for (let col = 0; col < 100; col++) {
          rowData.push(row === 0 ? `Col ${col}` : row * col);
        }
        grid.push(rowData);
      }

      const accessor = MockStoreCellAccessor.fromGrid(grid);
      const config = createTestConfig({
        dataRange: 'A1:CV100',
        seriesOrientation: 'rows',
      });

      const start = performance.now();
      const data = extractChartData(accessor, config);
      const elapsed = performance.now() - start;

      expect(data.series.length).toBe(99); // 99 data rows after header
      expect(data.categories.length).toBe(100);
      expect(elapsed).toBeLessThan(500); // Should complete in <500ms
    });
  });

  describe('accessor compatibility', () => {
    it('works with ObjectCellAccessor (dict-based)', () => {
      const accessor = new ObjectCellAccessor({
        A1: 'Header',
        B1: 'Data',
        A2: 'Row1',
        B2: 100,
      });

      const config = createTestConfig({
        dataRange: 'A1:B2',
        seriesOrientation: 'rows',
      });

      const data = extractChartData(accessor, config);

      expect(data.categories).toEqual(['Data']);
      expect(data.series[0].name).toBe('Row1');
      expect(data.series[0].data.map((d) => d.y)).toEqual([100]);
    });

    it('works with ObjectCellAccessor.fromArray', () => {
      const accessor = ObjectCellAccessor.fromArray([
        ['A', 'B', 'C'],
        [1, 2, 3],
      ]);

      const config = createTestConfig({
        dataRange: 'A1:C2',
        seriesOrientation: 'rows',
      });

      const data = extractChartData(accessor, config);

      expect(data.series[0].data.map((d) => d.y)).toEqual([1, 2, 3]);
    });

    it('works with custom accessor implementation', () => {
      // Custom implementation that could simulate any data source
      const customAccessor: CellDataAccessor = {
        getValue(row: number, col: number): ChartCellValue {
          if (row === 0) return `Col ${col}`;
          return row * col * 10;
        },
      };

      const config = createTestConfig({
        dataRange: 'A1:D5',
        seriesOrientation: 'rows',
      });

      const data = extractChartData(customAccessor, config);

      expect(data.categories).toEqual(['Col 0', 'Col 1', 'Col 2', 'Col 3']);
      expect(data.series).toHaveLength(4);
    });
  });
});
