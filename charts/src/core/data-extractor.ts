/**
 * Data Extractor - Parse cell ranges and extract data for charts
 */
import type {
  ChartConfig,
  ChartData,
  ChartDataPoint,
  ChartDataSeries,
  SeriesConfig,
  SeriesOrientation,
} from '../types';

// Import canonical types from contracts - SINGLE SOURCE OF TRUTH
import type { CellAddress, CellRange } from '@mog-sdk/contracts/core';
import { colToLetter, parseCellRange } from '@mog/spreadsheet-utils/a1';

// Re-export for backwards compatibility
export type { CellAddress, CellRange };

/**
 * Generic cell value type that can come from any data source.
 *
 * Intentionally different from the canonical `CellValue` in `@mog-sdk/contracts/core`
 * which is `string | number | boolean | null | CellError`. This chart variant includes `undefined`
 * for missing data points and excludes `CellError`.
 *
 * @see `@mog-sdk/contracts/core` for the canonical `CellValue` type.
 */
export type ChartCellValue = string | number | boolean | null | undefined;

/**
 * Generic cell data accessor interface
 * Implementations can be backed by Yjs, plain objects, etc.
 */
export interface CellDataAccessor {
  getValue(row: number, col: number, sheetId?: string): ChartCellValue;
}

function getRangeValue(
  accessor: CellDataAccessor,
  range: CellRange,
  row: number,
  col: number,
): ChartCellValue {
  return accessor.getValue(row, col, range.sheetId);
}

/**
 * Parse a range string (e.g., "A1:D10" or "B5") to CellRange
 * Returns canonical CellRange format from contracts: { startRow, startCol, endRow, endCol }
 */
export function parseRange(range: string): CellRange {
  const parsed = parseCellRange(range);
  if (!parsed) {
    throw new Error(`Invalid cell range: ${range}`);
  }
  return {
    startRow: Math.min(parsed.startRow, parsed.endRow),
    startCol: Math.min(parsed.startCol, parsed.endCol),
    endRow: Math.max(parsed.startRow, parsed.endRow),
    endCol: Math.max(parsed.startCol, parsed.endCol),
    ...(parsed.sheetName ? { sheetId: parsed.sheetName } : {}),
  };
}

function tryParseRange(range: string | undefined): CellRange | null {
  if (!range) return null;
  const parsed = parseCellRange(range);
  if (!parsed) return null;
  return {
    startRow: Math.min(parsed.startRow, parsed.endRow),
    startCol: Math.min(parsed.startCol, parsed.endCol),
    endRow: Math.max(parsed.startRow, parsed.endRow),
    endCol: Math.max(parsed.startCol, parsed.endCol),
    ...(parsed.sheetName ? { sheetId: parsed.sheetName } : {}),
  };
}

/**
 * Convert a value to a number, returning NaN for non-numeric values
 */
function toNumber(value: ChartCellValue): number {
  if (value === null || value === undefined || value === '') {
    return NaN;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  const num = parseFloat(String(value));
  return num;
}

function isNumericLike(value: ChartCellValue): boolean {
  return !Number.isNaN(toNumber(value));
}

function labelValue(value: ChartCellValue, fallback: string | number): string | number {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  return typeof value === 'number' ? value : String(value);
}

function hasExcelTableShape(accessor: CellDataAccessor, range: CellRange): boolean {
  const rowCount = range.endRow - range.startRow + 1;
  const colCount = range.endCol - range.startCol + 1;

  if (rowCount < 3 || colCount < 2) return false;

  let headerLabelCount = 0;
  for (let col = range.startCol + 1; col <= range.endCol; col++) {
    const value = getRangeValue(accessor, range, range.startRow, col);
    if (value !== null && value !== undefined && value !== '' && !isNumericLike(value)) {
      headerLabelCount++;
    }
  }

  let categoryLabelCount = 0;
  let numericBodyCount = 0;
  for (let row = range.startRow + 1; row <= range.endRow; row++) {
    const category = getRangeValue(accessor, range, row, range.startCol);
    if (category !== null && category !== undefined && category !== '') {
      categoryLabelCount++;
    }

    for (let col = range.startCol + 1; col <= range.endCol; col++) {
      if (isNumericLike(getRangeValue(accessor, range, row, col))) {
        numericBodyCount++;
      }
    }
  }

  return headerLabelCount > 0 && categoryLabelCount > 0 && numericBodyCount > 0;
}

function extractExcelTableData(accessor: CellDataAccessor, range: CellRange): ChartData {
  const categories: (string | number)[] = [];
  for (let row = range.startRow + 1; row <= range.endRow; row++) {
    categories.push(
      labelValue(getRangeValue(accessor, range, row, range.startCol), `Row ${row + 1}`),
    );
  }

  const series: ChartDataSeries[] = [];
  for (let col = range.startCol + 1; col <= range.endCol; col++) {
    const seriesIndex = col - range.startCol - 1;
    const header = getRangeValue(accessor, range, range.startRow, col);
    const name = String(labelValue(header, `Series ${seriesIndex + 1}`));
    const data: ChartDataPoint[] = [];

    for (let row = range.startRow + 1; row <= range.endRow; row++) {
      const catIndex = row - range.startRow - 1;
      const value = toNumber(getRangeValue(accessor, range, row, col));
      const category = categories[catIndex] ?? catIndex;
      data.push({
        x: category,
        y: isNaN(value) ? 0 : value,
        name: String(category),
      });
    }

    series.push({ name, data });
  }

  return { categories, series };
}

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
 * Extract chart data from a cell range
 *
 * @param accessor - The cell data accessor
 * @param config - Chart configuration with data range
 * @returns Extracted chart data ready for rendering
 */
export function extractChartData(accessor: CellDataAccessor, config: ChartConfig): ChartData {
  const importedSeries = config.series?.filter((series) => Boolean(series.values));
  if (importedSeries?.length) {
    return extractChartDataFromSeriesRefs(accessor, importedSeries);
  }

  if (!config.dataRange) {
    return { categories: [], series: [] };
  }

  const dataRange = tryParseRange(config.dataRange);
  if (!dataRange) {
    return { categories: [], series: [] };
  }
  const orientation = config.seriesOrientation || detectSeriesOrientation(dataRange);

  // Parse optional category and series label ranges
  const categoryRange = tryParseRange(config.categoryRange);
  const seriesRange = tryParseRange(config.seriesRange);
  const hasExplicitLayout = Boolean(config.seriesOrientation || categoryRange || seriesRange);

  // Detect single-dimension ranges
  const isSingleColumn = dataRange.endCol === dataRange.startCol;
  const isSingleRow = dataRange.endRow === dataRange.startRow;
  const isSingleDimension = isSingleColumn || isSingleRow;

  // For single-dimension ranges without explicit category range,
  // treat all values as a single series with numeric indices as categories
  if (isSingleDimension && !categoryRange) {
    const series: ChartDataSeries[] = [];
    const data: ChartDataPoint[] = [];
    const categories: (string | number)[] = [];

    if (isSingleColumn) {
      // Single column: iterate rows, each row is a data point
      for (let row = dataRange.startRow; row <= dataRange.endRow; row++) {
        const index = row - dataRange.startRow + 1; // 1-based index
        const value = toNumber(getRangeValue(accessor, dataRange, row, dataRange.startCol));
        categories.push(index);
        data.push({
          x: index,
          y: isNaN(value) ? 0 : value,
          name: String(index),
        });
      }
    } else {
      // Single row: iterate columns, each column is a data point
      for (let col = dataRange.startCol; col <= dataRange.endCol; col++) {
        const index = col - dataRange.startCol + 1; // 1-based index
        const value = toNumber(getRangeValue(accessor, dataRange, dataRange.startRow, col));
        categories.push(index);
        data.push({
          x: index,
          y: isNaN(value) ? 0 : value,
          name: String(index),
        });
      }
    }

    const name = seriesRange
      ? extractLabels(accessor, seriesRange).map(String)[0] || 'Series 1'
      : 'Series 1';
    series.push({ name, data });

    return { categories, series };
  }

  if (!hasExplicitLayout && hasExcelTableShape(accessor, dataRange)) {
    return extractExcelTableData(accessor, dataRange);
  }

  // Extract categories
  let categories: (string | number)[] = [];
  if (categoryRange) {
    categories = extractLabels(accessor, categoryRange);
  } else {
    // Auto-extract from first row or column of data range
    if (orientation === 'columns') {
      // First row contains categories
      for (let col = dataRange.startCol; col <= dataRange.endCol; col++) {
        const value = getRangeValue(accessor, dataRange, dataRange.startRow, col);
        categories.push(value != null ? String(value) : `Col ${col + 1}`);
      }
    } else {
      // First column contains categories
      for (let row = dataRange.startRow; row <= dataRange.endRow; row++) {
        const value = getRangeValue(accessor, dataRange, row, dataRange.startCol);
        categories.push(value != null ? String(value) : `Row ${row + 1}`);
      }
    }
  }

  // Extract series labels
  let seriesLabels: string[] = [];
  if (seriesRange) {
    seriesLabels = extractLabels(accessor, seriesRange).map(String);
  }

  // Extract series data
  const series: ChartDataSeries[] = [];

  if (orientation === 'columns') {
    // Each row (after header) is a series
    const startRow = categoryRange ? dataRange.startRow : dataRange.startRow + 1;
    for (let row = startRow; row <= dataRange.endRow; row++) {
      const seriesIndex = row - startRow;
      const name = seriesLabels[seriesIndex] || `Series ${seriesIndex + 1}`;
      const data: ChartDataPoint[] = [];

      for (let col = dataRange.startCol; col <= dataRange.endCol; col++) {
        const catIndex = col - dataRange.startCol;
        const value = toNumber(getRangeValue(accessor, dataRange, row, col));
        data.push({
          x: categories[catIndex] ?? catIndex,
          y: isNaN(value) ? 0 : value,
          name: String(categories[catIndex] ?? catIndex),
        });
      }

      series.push({ name, data });
    }
  } else {
    // Each column (after header) is a series
    const startCol = categoryRange ? dataRange.startCol : dataRange.startCol + 1;
    for (let col = startCol; col <= dataRange.endCol; col++) {
      const seriesIndex = col - startCol;
      const name = seriesLabels[seriesIndex] || `Series ${seriesIndex + 1}`;
      const data: ChartDataPoint[] = [];

      for (let row = dataRange.startRow; row <= dataRange.endRow; row++) {
        const catIndex = row - dataRange.startRow;
        const value = toNumber(getRangeValue(accessor, dataRange, row, col));
        data.push({
          x: categories[catIndex] ?? catIndex,
          y: isNaN(value) ? 0 : value,
          name: String(categories[catIndex] ?? catIndex),
        });
      }

      series.push({ name, data });
    }
  }

  return { categories, series };
}

/**
 * Extract labels from a range (for categories or series names)
 */
function extractLabels(accessor: CellDataAccessor, range: CellRange): (string | number)[] {
  const labels: (string | number)[] = [];

  // Determine if it's a row or column range
  const isRowRange = range.startRow === range.endRow;
  const isColRange = range.startCol === range.endCol;

  if (isRowRange) {
    // Extract from columns in a single row
    for (let col = range.startCol; col <= range.endCol; col++) {
      const value = getRangeValue(accessor, range, range.startRow, col);
      labels.push(value != null ? (typeof value === 'number' ? value : String(value)) : '');
    }
  } else if (isColRange) {
    // Extract from rows in a single column
    for (let row = range.startRow; row <= range.endRow; row++) {
      const value = getRangeValue(accessor, range, row, range.startCol);
      labels.push(value != null ? (typeof value === 'number' ? value : String(value)) : '');
    }
  } else {
    // For multi-row/col ranges, flatten by reading row by row
    for (let row = range.startRow; row <= range.endRow; row++) {
      for (let col = range.startCol; col <= range.endCol; col++) {
        const value = getRangeValue(accessor, range, row, col);
        labels.push(value != null ? (typeof value === 'number' ? value : String(value)) : '');
      }
    }
  }

  return labels;
}

function extractValues(accessor: CellDataAccessor, range: CellRange): ChartCellValue[] {
  const values: ChartCellValue[] = [];
  for (let row = range.startRow; row <= range.endRow; row++) {
    for (let col = range.startCol; col <= range.endCol; col++) {
      values.push(getRangeValue(accessor, range, row, col));
    }
  }
  return values;
}

function extractChartDataFromSeriesRefs(
  accessor: CellDataAccessor,
  seriesConfigs: SeriesConfig[],
): ChartData {
  const series: ChartDataSeries[] = [];
  let categories: (string | number)[] = [];

  for (let seriesIndex = 0; seriesIndex < seriesConfigs.length; seriesIndex++) {
    const seriesConfig = seriesConfigs[seriesIndex];
    const valueRange = tryParseRange(seriesConfig.values);
    if (!valueRange) continue;

    const valueItems = extractValues(accessor, valueRange);
    const categoryRange = tryParseRange(seriesConfig.categories);
    const categoryItems = categoryRange ? extractLabels(accessor, categoryRange) : [];
    if (categories.length === 0 && categoryItems.length > 0) {
      categories = categoryItems;
    }

    const data: ChartDataPoint[] = valueItems.map((rawValue, pointIndex) => {
      const y = toNumber(rawValue);
      const category = categoryItems[pointIndex] ?? categories[pointIndex] ?? pointIndex + 1;
      return {
        x: category,
        y: isNaN(y) ? 0 : y,
        name: String(category),
      };
    });

    if (categories.length === 0) {
      categories = data.map((point) => point.x);
    }

    series.push({
      name: seriesConfig.name ?? `Series ${seriesIndex + 1}`,
      data,
      ...(seriesConfig.type ? { type: seriesConfig.type as ChartDataSeries['type'] } : {}),
      ...(seriesConfig.color ? { color: seriesConfig.color } : {}),
      ...(seriesConfig.yAxisIndex === 0 || seriesConfig.yAxisIndex === 1
        ? { yAxisIndex: seriesConfig.yAxisIndex }
        : {}),
    });
  }

  return { categories, series };
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
        const value = toNumber(getRangeValue(accessor, dataRange, row, dataRange.startCol));
        categories.push(index);
        data.push({
          x: index,
          y: isNaN(value) ? 0 : value,
          name: String(index),
        });
      }
    } else {
      // Single row: iterate columns, each column is a data point
      for (let col = dataRange.startCol; col <= dataRange.endCol; col++) {
        const index = col - dataRange.startCol + 1; // 1-based index
        const value = toNumber(getRangeValue(accessor, dataRange, dataRange.startRow, col));
        categories.push(index);
        data.push({
          x: index,
          y: isNaN(value) ? 0 : value,
          name: String(index),
        });
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
        categories.push(value != null ? String(value) : `Col ${col + 1}`);
      }
    } else {
      // First column contains categories
      for (let row = dataRange.startRow; row <= dataRange.endRow; row++) {
        const value = getRangeValue(accessor, dataRange, row, dataRange.startCol);
        categories.push(value != null ? String(value) : `Row ${row + 1}`);
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
        const value = toNumber(getRangeValue(accessor, dataRange, row, col));
        data.push({
          x: categories[catIndex] ?? catIndex,
          y: isNaN(value) ? 0 : value,
          name: String(categories[catIndex] ?? catIndex),
        });
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
        const value = toNumber(getRangeValue(accessor, dataRange, row, col));
        data.push({
          x: categories[catIndex] ?? catIndex,
          y: isNaN(value) ? 0 : value,
          name: String(categories[catIndex] ?? catIndex),
        });
      }

      series.push({ name, data });
    }
  }

  return { categories, series };
}

/**
 * Simple object-based cell data accessor for testing
 */
export class ObjectCellAccessor implements CellDataAccessor {
  constructor(private data: Record<string, ChartCellValue>) {}

  getValue(row: number, col: number): ChartCellValue {
    const key = `${colToLetter(col)}${row + 1}`;
    return this.data[key];
  }

  static fromArray(data: ChartCellValue[][]): ObjectCellAccessor {
    const obj: Record<string, ChartCellValue> = {};
    for (let row = 0; row < data.length; row++) {
      for (let col = 0; col < data[row].length; col++) {
        const key = `${colToLetter(col)}${row + 1}`;
        obj[key] = data[row][col];
      }
    }
    return new ObjectCellAccessor(obj);
  }
}
