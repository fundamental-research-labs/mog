/**
 * Extraction from resolved cell ranges.
 */
import type { ChartData, ChartDataPoint, ChartDataSeries, SeriesOrientation } from '../types';
import type { CellRange } from './data-extractor-primitives';
import {
  type CellDataAccessor,
  createDataPoint,
  extractLabels,
  getRangeValue,
  hasCellValue,
} from './data-extractor-primitives';
import { extractExcelTableData, hasExcelTableShape } from './data-extractor-table';

/**
 * Auto-detect series orientation based on data shape
 * If there are more columns than rows, series are in rows
 * If there are more rows than columns, series are in columns
 *
 * Special handling for single-dimension ranges:
 * - Single column (Nx1): Returns 'rows' so all values become one series
 * - Single row (1xN): Returns 'columns' so all values become one series
 */
export function detectSeriesOrientation(range: CellRange): SeriesOrientation {
  const rowCount = range.endRow - range.startRow + 1;
  const colCount = range.endCol - range.startCol + 1;

  // Special case: single column - treat as one series with rows as data points
  // Return 'rows' so we iterate over rows as data points, not as separate series
  if (colCount === 1) {
    return 'rows';
  }

  // Special case: single row - treat as one series with columns as data points
  // Return 'columns' so we iterate over columns as data points, not as separate series
  if (rowCount === 1) {
    return 'columns';
  }

  // Normal case: wider than tall = series in rows, taller than wide = series in columns
  return colCount > rowCount ? 'rows' : 'columns';
}

/**
 * Extract chart data from a pre-resolved CellRange.
 *
 * This is the preferred method when working with CellIdRange-based charts.
 * The caller resolves CellIdRange to CellRange using Charts.getChartDataRange(),
 * then passes the resolved range to this function.
 *
 * @param accessor - The cell data accessor
 * @param dataRange - Resolved data range (position-based)
 * @param options - Optional configuration for series, categories, orientation
 * @returns Extracted chart data ready for rendering
 */
export function extractChartDataFromRange(
  accessor: CellDataAccessor,
  dataRange: CellRange,
  options?: {
    categoryRange?: CellRange;
    seriesRange?: CellRange;
    seriesOrientation?: SeriesOrientation;
  },
): ChartData {
  const orientation = options?.seriesOrientation || detectSeriesOrientation(dataRange);
  const hasExplicitLayout = Boolean(
    options?.seriesOrientation || options?.categoryRange || options?.seriesRange,
  );

  // Detect single-dimension ranges
  const isSingleColumn = dataRange.endCol === dataRange.startCol;
  const isSingleRow = dataRange.endRow === dataRange.startRow;
  const isSingleDimension = isSingleColumn || isSingleRow;

  // For single-dimension ranges without explicit category range,
  // treat all values as a single series with numeric indices as categories
  if (isSingleDimension && !options?.categoryRange) {
    const series: ChartDataSeries[] = [];
    const data: ChartDataPoint[] = [];
    const categories: (string | number)[] = [];

    if (isSingleColumn) {
      // Single column: iterate rows, each row is a data point
      for (let row = dataRange.startRow; row <= dataRange.endRow; row++) {
        const index = row - dataRange.startRow + 1; // 1-based index
        const rawValue = getRangeValue(accessor, dataRange, row, dataRange.startCol);
        categories.push(index);
        data.push(createDataPoint(index, rawValue, String(index)));
      }
    } else {
      // Single row: iterate columns, each column is a data point
      for (let col = dataRange.startCol; col <= dataRange.endCol; col++) {
        const index = col - dataRange.startCol + 1; // 1-based index
        const rawValue = getRangeValue(accessor, dataRange, dataRange.startRow, col);
        categories.push(index);
        data.push(createDataPoint(index, rawValue, String(index)));
      }
    }

    const name = options?.seriesRange
      ? extractLabels(accessor, options.seriesRange).map(String)[0] || 'Series 1'
      : 'Series 1';
    series.push({ name, data });

    return { categories, series };
  }

  if (!hasExplicitLayout && hasExcelTableShape(accessor, dataRange)) {
    return extractExcelTableData(accessor, dataRange);
  }

  // Extract categories
  let categories: (string | number)[] = [];
  if (options?.categoryRange) {
    categories = extractLabels(accessor, options.categoryRange);
  } else {
    // Auto-extract from first row or column of data range
    if (orientation === 'columns') {
      // First row contains categories
      for (let col = dataRange.startCol; col <= dataRange.endCol; col++) {
        const value = getRangeValue(accessor, dataRange, dataRange.startRow, col);
        categories.push(hasCellValue(value) ? String(value) : `Col ${col + 1}`);
      }
    } else {
      // First column contains categories
      for (let row = dataRange.startRow; row <= dataRange.endRow; row++) {
        const value = getRangeValue(accessor, dataRange, row, dataRange.startCol);
        categories.push(hasCellValue(value) ? String(value) : `Row ${row + 1}`);
      }
    }
  }

  // Extract series labels
  let seriesLabels: string[] = [];
  if (options?.seriesRange) {
    seriesLabels = extractLabels(accessor, options.seriesRange).map(String);
  }

  // Extract series data
  const series: ChartDataSeries[] = [];

  if (orientation === 'columns') {
    // Each row (after header) is a series
    const startRow = options?.categoryRange ? dataRange.startRow : dataRange.startRow + 1;
    for (let row = startRow; row <= dataRange.endRow; row++) {
      const seriesIndex = row - startRow;
      const name = seriesLabels[seriesIndex] || `Series ${seriesIndex + 1}`;
      const data: ChartDataPoint[] = [];

      for (let col = dataRange.startCol; col <= dataRange.endCol; col++) {
        const catIndex = col - dataRange.startCol;
        const category = categories[catIndex] ?? catIndex;
        const rawValue = getRangeValue(accessor, dataRange, row, col);
        data.push(createDataPoint(category, rawValue, String(category)));
      }

      series.push({ name, data });
    }
  } else {
    // Each column (after header) is a series
    const startCol = options?.categoryRange ? dataRange.startCol : dataRange.startCol + 1;
    for (let col = startCol; col <= dataRange.endCol; col++) {
      const seriesIndex = col - startCol;
      const name = seriesLabels[seriesIndex] || `Series ${seriesIndex + 1}`;
      const data: ChartDataPoint[] = [];

      for (let row = dataRange.startRow; row <= dataRange.endRow; row++) {
        const catIndex = row - dataRange.startRow;
        const category = categories[catIndex] ?? catIndex;
        const rawValue = getRangeValue(accessor, dataRange, row, col);
        data.push(createDataPoint(category, rawValue, String(category)));
      }

      series.push({ name, data });
    }
  }

  return { categories, series };
}
