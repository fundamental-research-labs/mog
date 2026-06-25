/**
 * Performance tests for Charts package
 *
 * Validates:
 * - Data extraction performance for large data ranges (10K+ cells)
 * - Grammar compilation performance
 * - Multiple chart handling
 */
import { extractChartData, parseRange, type CellDataAccessor } from '../src/core/data-extractor';
import { compile } from '../src/grammar/compiler';
import type { ChartSpec, DataRow } from '../src/grammar/spec';
import type { StoredChartConfig } from '../src/types';

const PERFORMANCE_ATTEMPTS = 5;

interface TimedSample<T> {
  duration: number;
  result: T;
}

function measureBest<T>(
  operation: () => T,
  options: { warmups?: number; attempts?: number } = {},
): TimedSample<T> {
  const warmups = options.warmups ?? 1;
  const attempts = options.attempts ?? PERFORMANCE_ATTEMPTS;
  let bestDuration = Number.POSITIVE_INFINITY;
  let bestResult: T | undefined;
  let sampled = false;

  // The root workspace test aggregate runs package tests concurrently; use a
  // warm best sample so scheduling noise does not masquerade as a regression.
  for (let i = 0; i < warmups; i += 1) {
    operation();
  }

  for (let i = 0; i < attempts; i += 1) {
    const startTime = performance.now();
    const result = operation();
    const duration = performance.now() - startTime;
    sampled = true;
    if (duration < bestDuration) {
      bestDuration = duration;
      bestResult = result;
    }
  }

  if (!sampled) {
    throw new Error('Performance measurement did not collect any samples');
  }

  return { duration: bestDuration, result: bestResult as T };
}

describe('Chart Performance', () => {
  describe('Data Extraction - Large Data Ranges', () => {
    /**
     * Creates a mock cell accessor with numeric data
     */
    function createLargeMockAccessor(rows: number, cols: number): CellDataAccessor {
      return {
        getValue(row: number, col: number) {
          // Header row
          if (row === 0) {
            return col === 0 ? '' : `Series ${col}`;
          }
          // Category column
          if (col === 0) {
            return `Row ${row}`;
          }
          // Data cells - return deterministic numeric value
          return (row * cols + col) * 1.5;
        },
      };
    }

    it('should extract 1K cells (100 rows x 10 cols) in < 50ms', () => {
      const rows = 100;
      const cols = 10;
      const accessor = createLargeMockAccessor(rows, cols);
      const config: StoredChartConfig = {
        id: 'perf-test',
        type: 'column',
        anchorRow: 0,
        anchorCol: 0,
        width: 8,
        height: 12,
        dataRange: `A1:J${rows}`,
        // columns orientation: first column = categories, other columns = series
        seriesOrientation: 'columns',
      };

      const { duration, result: data } = measureBest(() => extractChartData(accessor, config));

      expect(duration).toBeLessThan(50);
      // With columns orientation: cols - 1 series (exclude category col), header row excluded.
      expect(data.series.length).toBe(cols - 1);
      expect(data.categories.length).toBe(rows - 1);
    });

    it('should extract 10K cells (1000 rows x 10 cols) in < 200ms', () => {
      const rows = 1000;
      const cols = 10;
      const accessor = createLargeMockAccessor(rows, cols);
      const config: StoredChartConfig = {
        id: 'perf-test',
        type: 'column',
        anchorRow: 0,
        anchorCol: 0,
        width: 8,
        height: 12,
        dataRange: `A1:J${rows}`,
        seriesOrientation: 'columns',
      };

      const { duration, result: data } = measureBest(() => extractChartData(accessor, config));

      expect(duration).toBeLessThan(200);
      expect(data.series.length).toBe(cols - 1);
      expect(data.categories.length).toBe(rows - 1);
    });

    it('should extract 10K cells (100 rows x 100 cols) in < 200ms', () => {
      const rows = 100;
      const cols = 100;
      const accessor = createLargeMockAccessor(rows, cols);

      // Build column reference (A to CV)
      const colRef = (col: number): string => {
        if (col < 26) return String.fromCharCode(65 + col);
        return (
          String.fromCharCode(65 + Math.floor(col / 26) - 1) + String.fromCharCode(65 + (col % 26))
        );
      };

      const config: StoredChartConfig = {
        id: 'perf-test',
        type: 'column',
        anchorRow: 0,
        anchorCol: 0,
        width: 8,
        height: 12,
        dataRange: `A1:${colRef(cols - 1)}${rows}`,
        // columns orientation: first column = categories
        seriesOrientation: 'columns',
      };

      const { duration, result: data } = measureBest(() => extractChartData(accessor, config));

      expect(duration).toBeLessThan(200);
      expect(data.series.length).toBe(cols - 1);
    });

    it('should extract 50K cells (5000 rows x 10 cols) in < 1000ms', () => {
      const rows = 5000;
      const cols = 10;
      const accessor = createLargeMockAccessor(rows, cols);
      const config: StoredChartConfig = {
        id: 'perf-test',
        type: 'line',
        anchorRow: 0,
        anchorCol: 0,
        width: 8,
        height: 12,
        dataRange: `A1:J${rows}`,
        seriesOrientation: 'columns',
      };

      const { duration, result: data } = measureBest(() => extractChartData(accessor, config));

      expect(duration).toBeLessThan(1000);
      expect(data.series.length).toBe(cols - 1);
      expect(data.categories.length).toBe(rows - 1);
    });
  });

  describe('Grammar Compilation Performance', () => {
    const createLargeSpec = (pointsCount: number): ChartSpec => {
      const data: DataRow[] = [];
      for (let i = 0; i < pointsCount; i++) {
        data.push({
          category: `Cat ${i}`,
          value: ((i * 9301 + 49297) % 233280) / 233.28,
          series: `Series ${i % 5}`,
        });
      }

      return {
        width: 800,
        height: 600,
        mark: 'bar',
        data: { values: data },
        encoding: {
          x: { field: 'category', type: 'nominal' },
          y: { field: 'value', type: 'quantitative' },
          color: { field: 'series', type: 'nominal' },
        },
        title: 'Performance Test',
      };
    };

    it('should compile spec with 100 points in < 20ms', () => {
      const spec = createLargeSpec(100);

      const { duration, result } = measureBest(() => compile(spec));

      expect(duration).toBeLessThan(20);
      expect(result.marks.length).toBeGreaterThan(0);
    });

    it('should compile spec with 1000 points in < 100ms', () => {
      const spec = createLargeSpec(1000);

      const { duration, result } = measureBest(() => compile(spec));

      expect(duration).toBeLessThan(100);
      expect(result.marks.length).toBeGreaterThan(0);
    });

    it('should compile spec with 5000 points in < 500ms', () => {
      const spec = createLargeSpec(5000);

      const { duration, result } = measureBest(() => compile(spec));

      expect(duration).toBeLessThan(500);
      expect(result.marks.length).toBeGreaterThan(0);
    });
  });

  describe('Multiple Charts Performance', () => {
    it('should compile 20 different specs in < 100ms', () => {
      const specs: ChartSpec[] = [];
      const markTypes = ['bar', 'line', 'area', 'point', 'arc'] as const;

      for (let i = 0; i < 20; i++) {
        specs.push({
          width: 400,
          height: 300,
          mark: markTypes[i % markTypes.length],
          data: {
            values: [
              { category: 'A', value: 100 },
              { category: 'B', value: 200 },
              { category: 'C', value: 150 },
              { category: 'D', value: 300 },
            ],
          },
          encoding: {
            x: { field: 'category', type: 'nominal' },
            y: { field: 'value', type: 'quantitative' },
          },
          title: `Chart ${i}`,
        });
      }

      const { duration } = measureBest(() => {
        for (const spec of specs) {
          compile(spec);
        }
      });

      expect(duration).toBeLessThan(100);
    });

    it('should parse range references quickly (1000 iterations)', () => {
      const ranges = ['A1:Z100', 'AA1:AZ50', 'B10:D500', 'A1:CV100'];

      const { duration } = measureBest(() => {
        for (let i = 0; i < 1000; i++) {
          for (const range of ranges) {
            parseRange(range);
          }
        }
      });

      expect(duration).toBeLessThan(100); // 4000 parses in < 100ms
    });
  });

  describe('Memory Efficiency', () => {
    it('should not create excessive objects for large datasets', () => {
      const rows = 1000;
      const cols = 10;

      const accessor: CellDataAccessor = {
        getValue(row: number, col: number) {
          if (row === 0) return col === 0 ? '' : `S${col}`;
          if (col === 0) return `R${row}`;
          return row * cols + col;
        },
      };

      const config: StoredChartConfig = {
        id: 'memory-test',
        type: 'column',
        anchorRow: 0,
        anchorCol: 0,
        width: 8,
        height: 12,
        dataRange: `A1:J${rows}`,
        seriesOrientation: 'rows',
      };

      // Track memory before
      const memBefore = process.memoryUsage().heapUsed;

      // Extract data multiple times
      for (let i = 0; i < 10; i++) {
        extractChartData(accessor, config);
      }

      // Force GC if available
      if (global.gc) {
        global.gc();
      }

      const memAfter = process.memoryUsage().heapUsed;
      const memIncrease = (memAfter - memBefore) / 1024 / 1024; // MB

      // Memory increase should be reasonable (< 50MB for 10 extractions of 10K cells)
      expect(memIncrease).toBeLessThan(50);
    });
  });
});
