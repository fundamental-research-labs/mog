/**
 * Data Extractor - Parse cell ranges and extract data for charts
 */
import type {
  ChartConfig,
  ChartCategoryLevelData,
  ChartData,
  ChartDataPoint,
  ChartDataPointValueState,
  ChartDataSeries,
  ChartSeriesCategoryLevelsCache,
  ChartSeriesPointCache,
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
export const HIDDEN_CHART_CELL = Symbol.for('mog.chart.hiddenCell');
export type HiddenChartCellValue = typeof HIDDEN_CHART_CELL;
export type ChartCellValue = string | number | boolean | null | undefined | HiddenChartCellValue;

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
  if (isHiddenChartCellValue(value) || value === null || value === undefined || value === '') {
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

export function isHiddenChartCellValue(value: ChartCellValue): value is HiddenChartCellValue {
  return value === HIDDEN_CHART_CELL;
}

function isBlankChartCellValue(value: ChartCellValue): boolean {
  return value === null || value === undefined || value === '';
}

function isNumericLike(value: ChartCellValue): boolean {
  return !Number.isNaN(toNumber(value));
}

function getValueState(
  rawValue: ChartCellValue,
  numericValue: number,
): ChartDataPointValueState | undefined {
  if (isHiddenChartCellValue(rawValue)) {
    return 'hidden';
  }

  if (isBlankChartCellValue(rawValue)) {
    return 'blank';
  }

  if (Number.isFinite(numericValue)) {
    return undefined;
  }

  if (
    typeof rawValue === 'number' ||
    (typeof rawValue === 'string' && rawValue.trim() !== '' && !Number.isNaN(numericValue))
  ) {
    return 'nonFinite';
  }

  return 'nonNumeric';
}

function createDataPoint(
  x: string | number,
  rawValue: ChartCellValue,
  name: string,
  options?: {
    rawSize?: ChartCellValue;
    hidden?: boolean;
  },
): ChartDataPoint {
  const pointHidden = options?.hidden || isHiddenChartCellValue(rawValue);
  const numericValue = pointHidden ? NaN : toNumber(rawValue);
  const valueState: ChartDataPointValueState | undefined = pointHidden
    ? 'hidden'
    : getValueState(rawValue, numericValue);
  const point: ChartDataPoint = {
    x,
    y: Number.isFinite(numericValue) ? numericValue : 0,
    name,
  };
  if (valueState) {
    point.valueState = valueState;
  }
  const rawSize = options?.rawSize;
  const numericSize = pointHidden || isHiddenChartCellValue(rawSize) ? NaN : toNumber(rawSize);
  if (Number.isFinite(numericSize)) {
    point.size = numericSize;
  }
  return point;
}

function importedCachePointState(
  cache: ChartSeriesPointCache | undefined,
  pointIndex: number,
): { kind: 'explicit'; value: ChartCellValue } | { kind: 'omitted' } | { kind: 'absent' } {
  if (!cache) return { kind: 'absent' };

  const point = cache.points?.find((candidate) => candidate.idx === pointIndex);
  if (point !== undefined) return { kind: 'explicit', value: point.value };

  if (
    typeof cache.pointCount === 'number' &&
    Number.isInteger(cache.pointCount) &&
    pointIndex >= 0 &&
    pointIndex < cache.pointCount
  ) {
    return { kind: 'omitted' };
  }

  return { kind: 'absent' };
}

function cachePointCardinality(cache: ChartSeriesPointCache | undefined): number {
  if (!cache) return 0;
  if (
    typeof cache.pointCount === 'number' &&
    Number.isInteger(cache.pointCount) &&
    cache.pointCount >= 0
  ) {
    return cache.pointCount;
  }
  return cache.points.reduce((max, point) => Math.max(max, point.idx + 1), 0);
}

function categoryLevelPointCardinality(cache: ChartSeriesCategoryLevelsCache | undefined): number {
  if (!cache) return 0;
  if (
    typeof cache.pointCount === 'number' &&
    Number.isInteger(cache.pointCount) &&
    cache.pointCount >= 0
  ) {
    return cache.pointCount;
  }
  return cache.levels.reduce((max, level) => {
    const levelPointCount =
      typeof level.pointCount === 'number' &&
      Number.isInteger(level.pointCount) &&
      level.pointCount >= 0
        ? level.pointCount
        : 0;
    const maxPointIndex = level.points.reduce((pointMax, point) => {
      return Math.max(pointMax, point.idx + 1);
    }, 0);
    return Math.max(max, levelPointCount, maxPointIndex);
  }, 0);
}

function orderedCategoryLevels(cache: ChartSeriesCategoryLevelsCache | undefined) {
  return [...(cache?.levels ?? [])].sort((left, right) => left.level - right.level);
}

function categoryLevelValueAt(
  cache: ChartSeriesCategoryLevelsCache | undefined,
  levelIndex: number,
  pointIndex: number,
): string | undefined {
  const levels = orderedCategoryLevels(cache);
  const level = levels.find((candidate) => candidate.level === levelIndex) ?? levels[levelIndex];
  const value = level?.points.find((point) => point.idx === pointIndex)?.value;
  return value === undefined || value === '' ? undefined : value;
}

function selectedCategoryLabelLevel(level: number | undefined): number | undefined {
  return typeof level === 'number' && Number.isInteger(level) && level >= 0 ? level : undefined;
}

function multiLevelCategoryLabelAt(
  cache: ChartSeriesCategoryLevelsCache | undefined,
  pointIndex: number,
  selectedLevel: number | undefined,
  fallback: string | number,
): string | number {
  if (selectedLevel !== undefined) {
    return categoryLevelValueAt(cache, selectedLevel, pointIndex) ?? fallback;
  }

  const labels = orderedCategoryLevels(cache)
    .map((level) => level.points.find((point) => point.idx === pointIndex)?.value)
    .filter((value): value is string => value !== undefined && value.trim() !== '');
  return labels.length > 0 ? labels.join(' / ') : fallback;
}

function categoryLevelsFromCache(
  cache: ChartSeriesCategoryLevelsCache | undefined,
): ChartCategoryLevelData[] | undefined {
  const pointCount = categoryLevelPointCardinality(cache);
  const levels = orderedCategoryLevels(cache);
  if (pointCount === 0 || levels.length === 0) return undefined;

  return levels.map((level) => ({
    level: level.level,
    labels: Array.from({ length: pointCount }, (_, pointIndex) => {
      const value = level.points.find((point) => point.idx === pointIndex)?.value;
      return value === undefined || value === '' ? null : value;
    }),
  }));
}

function hasRenderableCategoryLevels(cache: ChartSeriesCategoryLevelsCache | undefined): boolean {
  return categoryLevelPointCardinality(cache) > 0 && orderedCategoryLevels(cache).length > 0;
}

function cacheValueAt(cache: ChartSeriesPointCache | undefined, pointIndex: number): ChartCellValue {
  const cached = importedCachePointState(cache, pointIndex);
  return cached.kind === 'explicit' ? cached.value : undefined;
}

function cacheLabelAt(
  cache: ChartSeriesPointCache | undefined,
  pointIndex: number,
  fallback: string | number,
): string | number {
  const value = cacheValueAt(cache, pointIndex);
  const label = labelValue(value, fallback);
  if (typeof label === 'string' && label.trim() !== '') {
    const numeric = Number(label);
    if (Number.isFinite(numeric)) return numeric;
  }
  return label;
}

function xyValue(value: ChartCellValue): string | number {
  if (isHiddenChartCellValue(value) || isBlankChartCellValue(value)) {
    return '';
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  const text = String(value);
  const numeric = Number(text);
  return text.trim() !== '' && Number.isFinite(numeric) ? numeric : text;
}

function hasRenderableCachedDimension(cache: ChartSeriesPointCache | undefined): boolean {
  return cachePointCardinality(cache) > 0;
}

function pointFormatCodeAt(
  cache: ChartSeriesPointCache | undefined,
  pointIndex: number,
): string | undefined {
  return cache?.points.find((point) => point.idx === pointIndex)?.formatCode ?? cache?.formatCode;
}

function categoryFormatCodeAt(
  seriesConfig: SeriesConfig,
  pointIndex: number,
): string | undefined {
  return (
    seriesConfig.categoryLabelFormat?.points?.find((point) => point.idx === pointIndex)
      ?.formatCode ??
    seriesConfig.categoryLabelFormat?.formatCode ??
    pointFormatCodeAt(seriesConfig.categoryCache, pointIndex)
  );
}

function hasCellValue(value: ChartCellValue): boolean {
  return !isHiddenChartCellValue(value) && !isBlankChartCellValue(value);
}

function labelValue(value: ChartCellValue, fallback: string | number): string | number {
  if (isHiddenChartCellValue(value) || isBlankChartCellValue(value)) {
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
    if (hasCellValue(value) && !isNumericLike(value)) {
      headerLabelCount++;
    }
  }

  let categoryLabelCount = 0;
  let numericBodyCount = 0;
  for (let row = range.startRow + 1; row <= range.endRow; row++) {
    const category = getRangeValue(accessor, range, row, range.startCol);
    if (hasCellValue(category)) {
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
      const rawValue = getRangeValue(accessor, range, row, col);
      const category = categories[catIndex] ?? catIndex;
      data.push(createDataPoint(category, rawValue, String(category)));
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
  const importedSeries = config.series?.filter(hasRenderableImportedSeriesData);
  if (importedSeries?.length) {
    return extractChartDataFromSeriesRefs(
      accessor,
      importedSeries,
      config.categoryLabelLevel,
      config.type,
    );
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
        const category = categories[catIndex] ?? catIndex;
        const rawValue = getRangeValue(accessor, dataRange, row, col);
        data.push(createDataPoint(category, rawValue, String(category)));
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
        const category = categories[catIndex] ?? catIndex;
        const rawValue = getRangeValue(accessor, dataRange, row, col);
        data.push(createDataPoint(category, rawValue, String(category)));
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
      labels.push(labelValue(value, ''));
    }
  } else if (isColRange) {
    // Extract from rows in a single column
    for (let row = range.startRow; row <= range.endRow; row++) {
      const value = getRangeValue(accessor, range, row, range.startCol);
      labels.push(labelValue(value, ''));
    }
  } else {
    // For multi-row/col ranges, flatten by reading row by row
    for (let row = range.startRow; row <= range.endRow; row++) {
      for (let col = range.startCol; col <= range.endCol; col++) {
        const value = getRangeValue(accessor, range, row, col);
        labels.push(labelValue(value, ''));
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

function defaultSeriesName(seriesConfig: SeriesConfig, seriesIndex: number): string {
  if (
    typeof seriesConfig.idx === 'number' &&
    Number.isInteger(seriesConfig.idx) &&
    seriesConfig.idx > 0
  ) {
    return `Series ${seriesConfig.idx}`;
  }

  if (
    typeof seriesConfig.order === 'number' &&
    Number.isInteger(seriesConfig.order) &&
    seriesConfig.order >= 0
  ) {
    return `Series ${seriesConfig.order + 1}`;
  }

  return `Series ${seriesIndex + 1}`;
}

function hasRenderableImportedSeriesData(seriesConfig: SeriesConfig): boolean {
  return Boolean(seriesConfig.values?.trim()) || hasRenderableCachedDimension(seriesConfig.valueCache);
}

type ImportedDimension = {
  values: ChartCellValue[];
  hasLiveRange: boolean;
};

function extractImportedDimension(
  accessor: CellDataAccessor,
  ref: string | undefined,
  cache: ChartSeriesPointCache | undefined,
  sourceKind: SeriesConfig['valueSourceKind'] | undefined,
): ImportedDimension {
  const shouldUseLiveRange = sourceKind !== 'literal' && sourceKind !== 'cacheFallback';
  const range = shouldUseLiveRange ? tryParseRange(ref) : null;
  if (range) {
    return { values: extractValues(accessor, range), hasLiveRange: true };
  }

  const pointCount = cachePointCardinality(cache);
  if (pointCount === 0) {
    return { values: [], hasLiveRange: false };
  }

  return {
    values: Array.from({ length: pointCount }, (_, pointIndex) =>
      cacheValueAt(cache, pointIndex),
    ),
    hasLiveRange: false,
  };
}

function extractChartDataFromSeriesRefs(
  accessor: CellDataAccessor,
  seriesConfigs: SeriesConfig[],
  categoryLabelLevel: number | undefined,
  chartType: ChartConfig['type'],
): ChartData {
  const series: ChartDataSeries[] = [];
  let categories: (string | number)[] = [];
  let categoryLevels: ChartCategoryLevelData[] | undefined;
  const categoryFormatCodes: Array<string | null | undefined> = [];
  const selectedLevel = selectedCategoryLabelLevel(categoryLabelLevel);
  const isXYChart = chartType === 'scatter' || chartType === 'bubble';

  for (let seriesIndex = 0; seriesIndex < seriesConfigs.length; seriesIndex++) {
    const seriesConfig = seriesConfigs[seriesIndex];
    const valueDimension = extractImportedDimension(
      accessor,
      seriesConfig.values,
      seriesConfig.valueCache,
      seriesConfig.valueSourceKind,
    );
    if (valueDimension.values.length === 0) continue;

    const categoryLevelsCache = seriesConfig.categoryLevels;
    const hasCategoryLevels = hasRenderableCategoryLevels(categoryLevelsCache);
    const categoryDimension = hasCategoryLevels
      ? {
          values: Array.from({ length: categoryLevelPointCardinality(categoryLevelsCache) }, (_, i) =>
            multiLevelCategoryLabelAt(categoryLevelsCache, i, selectedLevel, categories[i] ?? i + 1),
          ),
          hasLiveRange: false,
        }
      : extractImportedDimension(
          accessor,
          seriesConfig.categories,
          seriesConfig.categoryCache,
          seriesConfig.categorySourceKind,
        );
    categoryLevels ??= categoryLevelsFromCache(categoryLevelsCache);
    const bubbleSizeDimension = extractImportedDimension(
      accessor,
      seriesConfig.bubbleSize,
      seriesConfig.bubbleSizeCache,
      seriesConfig.bubbleSizeSourceKind,
    );

    const data: ChartDataPoint[] = [];
    for (let pointIndex = 0; pointIndex < valueDimension.values.length; pointIndex += 1) {
      const rawValue = valueDimension.values[pointIndex];
      const rawCategory = categoryDimension.values[pointIndex];
      const categoryFallback = categories[pointIndex] ?? pointIndex + 1;
      const category =
        isXYChart && !hasCategoryLevels
          ? categoryDimension.values.length > pointIndex
            ? xyValue(rawCategory)
            : xyValue(cacheValueAt(seriesConfig.categoryCache, pointIndex))
          : hasCategoryLevels && categoryDimension.values.length > pointIndex
          ? labelValue(rawCategory, categoryFallback)
          : categoryDimension.values.length > pointIndex
            ? categoryDimension.hasLiveRange
              ? labelValue(rawCategory, categoryFallback)
              : cacheLabelAt(seriesConfig.categoryCache, pointIndex, categoryFallback)
            : cacheLabelAt(seriesConfig.categoryCache, pointIndex, categoryFallback);
      const rawSize =
        bubbleSizeDimension.values.length > pointIndex
          ? bubbleSizeDimension.values[pointIndex]
          : undefined;
      const pointHidden =
        isHiddenChartCellValue(rawValue) ||
        isHiddenChartCellValue(rawCategory) ||
        isHiddenChartCellValue(rawSize);
      const point = createDataPoint(category, rawValue, String(category), {
        rawSize,
        hidden: pointHidden,
      });
      data.push(point);

      if (categories[pointIndex] === undefined) {
        categories[pointIndex] = point.x;
      }
      if (categoryFormatCodes[pointIndex] === undefined) {
        categoryFormatCodes[pointIndex] = categoryFormatCodeAt(seriesConfig, pointIndex);
      }
    }

    series.push({
      name: seriesConfig.name ?? defaultSeriesName(seriesConfig, seriesIndex),
      data,
      ...(seriesConfig.type ? { type: seriesConfig.type as ChartDataSeries['type'] } : {}),
      ...(seriesConfig.color ? { color: seriesConfig.color } : {}),
      ...(seriesConfig.yAxisIndex === 0 || seriesConfig.yAxisIndex === 1
        ? { yAxisIndex: seriesConfig.yAxisIndex }
        : {}),
    });
  }

  return {
    categories,
    ...(categoryLevels ? { categoryLevels } : {}),
    ...(categoryFormatCodes.some(Boolean) ? { categoryFormatCodes } : {}),
    series,
  };
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
