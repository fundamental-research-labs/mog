/**
 * Extraction from resolved cell ranges.
 */
import type {
  ChartConfig,
  ChartData,
  ChartDataPoint,
  ChartDataSeries,
  SeriesOrientation,
} from '../types';
import type { CellRange } from './data-extractor-primitives';
import {
  type CellDataAccessor,
  type ChartCellValue,
  createDataPoint,
  extractLabels,
  getRangeValue,
  hasCellValue,
  isHiddenChartCellValue,
  isNumericLike,
  labelValue,
  xyValue,
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

type EdgeValueStats = {
  labels: number;
  numeric: number;
};

function collectEdgeStats(values: ChartCellValue[]): EdgeValueStats {
  let labels = 0;
  let numeric = 0;

  for (const value of values) {
    if (!hasCellValue(value)) continue;
    if (isNumericLike(value)) {
      numeric += 1;
    } else {
      labels += 1;
    }
  }

  return { labels, numeric };
}

function firstColumnValues(
  accessor: CellDataAccessor,
  range: CellRange,
  options?: { skipTopCell?: boolean },
): ChartCellValue[] {
  const values: ChartCellValue[] = [];
  const startRow = options?.skipTopCell ? range.startRow + 1 : range.startRow;
  for (let row = startRow; row <= range.endRow; row += 1) {
    values.push(getRangeValue(accessor, range, row, range.startCol));
  }
  return values;
}

function firstRowValues(
  accessor: CellDataAccessor,
  range: CellRange,
  options?: { skipLeftCell?: boolean },
): ChartCellValue[] {
  const values: ChartCellValue[] = [];
  const startCol = options?.skipLeftCell ? range.startCol + 1 : range.startCol;
  for (let col = startCol; col <= range.endCol; col += 1) {
    values.push(getRangeValue(accessor, range, range.startRow, col));
  }
  return values;
}

function detectSeriesOrientationFromValues(
  accessor: CellDataAccessor,
  range: CellRange,
): SeriesOrientation {
  const shapeOrientation = detectSeriesOrientation(range);
  const rowCount = range.endRow - range.startRow + 1;
  const colCount = range.endCol - range.startCol + 1;
  if (rowCount === 1 || colCount === 1) return shapeOrientation;

  const firstColumn = collectEdgeStats(firstColumnValues(accessor, range));
  const firstColumnBelowTop = collectEdgeStats(
    firstColumnValues(accessor, range, { skipTopCell: true }),
  );
  const firstRow = collectEdgeStats(firstRowValues(accessor, range));
  const firstRowAfterLeft = collectEdgeStats(
    firstRowValues(accessor, range, { skipLeftCell: true }),
  );
  const firstColumnIsLabels = firstColumn.labels >= 2 && firstColumn.numeric === 0;
  const firstColumnBelowTopIsNumeric =
    firstColumnBelowTop.numeric >= 2 && firstColumnBelowTop.labels === 0;
  const firstRowIsLabels = firstRow.labels >= 2 && firstRow.numeric === 0;
  const firstRowAfterLeftIsNumeric =
    firstRowAfterLeft.numeric >= 2 && firstRowAfterLeft.labels === 0;

  if (firstColumnIsLabels && firstRowAfterLeftIsNumeric) return 'rows';
  if (firstRowIsLabels && firstColumnBelowTopIsNumeric) return 'columns';

  return shapeOrientation;
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
    chartType?: ChartConfig['type'];
    seriesRange?: CellRange;
    seriesOrientation?: SeriesOrientation;
  },
): ChartData {
  const shapeOrientation = options?.seriesOrientation || detectSeriesOrientation(dataRange);
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

  if (options?.chartType === 'bubble') {
    const bubbleData = extractBubbleChartDataFromRange(accessor, dataRange, {
      ...options,
      seriesOrientation: shapeOrientation,
    });
    if (bubbleData) return bubbleData;
  }

  if (!hasExplicitLayout && hasExcelTableShape(accessor, dataRange)) {
    return extractExcelTableData(accessor, dataRange);
  }

  const orientation =
    options?.seriesOrientation || detectSeriesOrientationFromValues(accessor, dataRange);

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

type BubbleRangeLayout =
  | {
      orientation: 'vertical';
      pointStart: number;
      pointEnd: number;
      xIndex: number;
      seriesPairs: Array<{ valueIndex: number; sizeIndex: number; name: string }>;
    }
  | {
      orientation: 'horizontal';
      pointStart: number;
      pointEnd: number;
      xIndex: number;
      seriesPairs: Array<{ valueIndex: number; sizeIndex: number; name: string }>;
    };

function extractBubbleChartDataFromRange(
  accessor: CellDataAccessor,
  dataRange: CellRange,
  options: {
    categoryRange?: CellRange;
    seriesRange?: CellRange;
    seriesOrientation?: SeriesOrientation;
  },
): ChartData | null {
  if (options.categoryRange || options.seriesRange) return null;

  const layout = chooseBubbleRangeLayout(accessor, dataRange, options.seriesOrientation);
  if (!layout) return null;

  const categories: Array<string | number> = [];
  const series = layout.seriesPairs.map((pair): ChartDataSeries => {
    const data: ChartDataPoint[] = [];
    for (let pointIndex = layout.pointStart; pointIndex <= layout.pointEnd; pointIndex += 1) {
      const rawX =
        layout.orientation === 'vertical'
          ? getRangeValue(accessor, dataRange, pointIndex, layout.xIndex)
          : getRangeValue(accessor, dataRange, layout.xIndex, pointIndex);
      const rawY =
        layout.orientation === 'vertical'
          ? getRangeValue(accessor, dataRange, pointIndex, pair.valueIndex)
          : getRangeValue(accessor, dataRange, pair.valueIndex, pointIndex);
      const rawSize =
        layout.orientation === 'vertical'
          ? getRangeValue(accessor, dataRange, pointIndex, pair.sizeIndex)
          : getRangeValue(accessor, dataRange, pair.sizeIndex, pointIndex);
      const x = xyValue(rawX);
      const categoryIndex = pointIndex - layout.pointStart;
      if (categories[categoryIndex] === undefined) categories[categoryIndex] = x;
      data.push(
        createDataPoint(x, rawY, String(x), {
          rawSize,
          hidden:
            isHiddenChartCellValue(rawX) ||
            isHiddenChartCellValue(rawY) ||
            isHiddenChartCellValue(rawSize),
        }),
      );
    }
    return { name: pair.name, data };
  });

  return { categories, series };
}

function chooseBubbleRangeLayout(
  accessor: CellDataAccessor,
  range: CellRange,
  seriesOrientation: SeriesOrientation | undefined,
): BubbleRangeLayout | null {
  const rowCount = range.endRow - range.startRow + 1;
  const colCount = range.endCol - range.startCol + 1;
  const vertical = colCount >= 3 ? verticalBubbleLayout(accessor, range) : null;
  const horizontal = rowCount >= 3 ? horizontalBubbleLayout(accessor, range) : null;

  if (seriesOrientation === 'columns') return vertical ?? horizontal;
  if (seriesOrientation === 'rows') return horizontal ?? vertical;
  return vertical ?? horizontal;
}

function verticalBubbleLayout(
  accessor: CellDataAccessor,
  range: CellRange,
): BubbleRangeLayout | null {
  const firstRow = valuesAcrossColumns(accessor, range, range.startRow);
  const header = isBubbleHeader(firstRow);
  const pointStart = header ? range.startRow + 1 : range.startRow;
  if (pointStart > range.endRow) return null;

  const dimensionColStart = range.startCol;
  const dimensionCount = range.endCol - dimensionColStart + 1;
  const seriesPairs = bubbleSeriesPairs({
    dimensionStart: dimensionColStart,
    dimensionEnd: range.endCol,
    nameForPair: (pairIndex, valueCol) =>
      header
        ? String(
            labelValue(
              getRangeValue(accessor, range, range.startRow, valueCol),
              pairName(pairIndex),
            ),
          )
        : pairName(pairIndex),
  });
  if (dimensionCount < 3 || seriesPairs.length === 0) return null;

  return {
    orientation: 'vertical',
    pointStart,
    pointEnd: range.endRow,
    xIndex: dimensionColStart,
    seriesPairs,
  };
}

function horizontalBubbleLayout(
  accessor: CellDataAccessor,
  range: CellRange,
): BubbleRangeLayout | null {
  const firstCol = valuesDownRows(accessor, range, range.startCol);
  const header = isBubbleHeader(firstCol);
  const pointStart = header ? range.startCol + 1 : range.startCol;
  if (pointStart > range.endCol) return null;

  const dimensionRowStart = range.startRow;
  const dimensionCount = range.endRow - dimensionRowStart + 1;
  const seriesPairs = bubbleSeriesPairs({
    dimensionStart: dimensionRowStart,
    dimensionEnd: range.endRow,
    nameForPair: (pairIndex, valueRow) =>
      header
        ? String(
            labelValue(
              getRangeValue(accessor, range, valueRow, range.startCol),
              pairName(pairIndex),
            ),
          )
        : pairName(pairIndex),
  });
  if (dimensionCount < 3 || seriesPairs.length === 0) return null;

  return {
    orientation: 'horizontal',
    pointStart,
    pointEnd: range.endCol,
    xIndex: dimensionRowStart,
    seriesPairs,
  };
}

function bubbleSeriesPairs(input: {
  dimensionStart: number;
  dimensionEnd: number;
  nameForPair: (pairIndex: number, valueIndex: number) => string;
}): Array<{ valueIndex: number; sizeIndex: number; name: string }> {
  const pairs: Array<{ valueIndex: number; sizeIndex: number; name: string }> = [];
  let pairIndex = 0;
  for (
    let valueIndex = input.dimensionStart + 1;
    valueIndex + 1 <= input.dimensionEnd;
    valueIndex += 2
  ) {
    pairs.push({
      valueIndex,
      sizeIndex: valueIndex + 1,
      name: input.nameForPair(pairIndex, valueIndex),
    });
    pairIndex += 1;
  }
  return pairs;
}

function isBubbleHeader(values: ChartCellValue[]): boolean {
  return (
    values.slice(0, 3).filter((value) => hasCellValue(value) && !isNumericLike(value)).length >= 2
  );
}

function valuesAcrossColumns(
  accessor: CellDataAccessor,
  range: CellRange,
  row: number,
): ChartCellValue[] {
  const values: ChartCellValue[] = [];
  for (let col = range.startCol; col <= range.endCol; col += 1) {
    values.push(getRangeValue(accessor, range, row, col));
  }
  return values;
}

function valuesDownRows(
  accessor: CellDataAccessor,
  range: CellRange,
  col: number,
): ChartCellValue[] {
  const values: ChartCellValue[] = [];
  for (let row = range.startRow; row <= range.endRow; row += 1) {
    values.push(getRangeValue(accessor, range, row, col));
  }
  return values;
}

function pairName(pairIndex: number): string {
  return `Series ${pairIndex + 1}`;
}
