/**
 * Extraction for imported chart series references and caches.
 */
import type {
  ChartCategoryLevelData,
  ChartConfig,
  ChartData,
  ChartDataPoint,
  ChartDataSeries,
  SeriesConfig,
} from '../types';
import {
  cacheLabelAt,
  cachePointCardinality,
  cacheValueAt,
  categoryFormatCodeAt,
  categoryLevelPointCardinality,
  categoryLevelsFromCache,
  hasRenderableCachedDimension,
  hasRenderableCategoryLevels,
  multiLevelCategoryLabelAt,
  orderedCategoryLevels,
  selectedCategoryLabelLevel,
} from './data-extractor-cache';
import {
  HIDDEN_CHART_CELL,
  type CellDataAccessor,
  type ChartCellValue,
  createDataPoint,
  extractValues,
  getRangeValue,
  isBlankChartCellValue,
  isHiddenChartCellValue,
  labelValue,
  toNumber,
  tryParseRange,
  xyValue,
} from './data-extractor-primitives';
import { chartDataSeriesIdentity } from './series-identity';

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

export function hasRenderableImportedSeriesData(seriesConfig: SeriesConfig): boolean {
  return (
    Boolean(seriesConfig.values?.trim()) || hasRenderableCachedDimension(seriesConfig.valueCache)
  );
}

type StockRole = 'volume' | 'open' | 'high' | 'low' | 'close';
type StockRolePlan = Partial<Record<StockRole, number>> & {
  high: number;
  low: number;
  close: number;
};

function isStockVolumeSeriesType(chartType: string | undefined): boolean {
  return (
    chartType === 'bar' ||
    chartType === 'column' ||
    chartType === 'bar3D' ||
    chartType === 'bar3d' ||
    chartType === 'column3D' ||
    chartType === 'column3d'
  );
}

function stockRolePlan(seriesConfigs: SeriesConfig[]): StockRolePlan | null {
  const stockIndices: number[] = [];
  const volumeIndices: number[] = [];

  seriesConfigs.forEach((seriesConfig, index) => {
    if (seriesConfig.type === 'stock') stockIndices.push(index);
    if (isStockVolumeSeriesType(seriesConfig.type)) volumeIndices.push(index);
  });

  if (
    volumeIndices.length === 1 &&
    (stockIndices.length === 3 || stockIndices.length === 4) &&
    stockIndices.length + volumeIndices.length === seriesConfigs.length
  ) {
    return stockIndices.length === 4
      ? {
          volume: volumeIndices[0],
          open: stockIndices[0],
          high: stockIndices[1],
          low: stockIndices[2],
          close: stockIndices[3],
        }
      : {
          volume: volumeIndices[0],
          high: stockIndices[0],
          low: stockIndices[1],
          close: stockIndices[2],
        };
  }

  if (
    volumeIndices.length === 0 &&
    (stockIndices.length === 3 || stockIndices.length === 4) &&
    stockIndices.length === seriesConfigs.length
  ) {
    return stockIndices.length === 4
      ? {
          open: stockIndices[0],
          high: stockIndices[1],
          low: stockIndices[2],
          close: stockIndices[3],
        }
      : { high: stockIndices[0], low: stockIndices[1], close: stockIndices[2] };
  }

  if (seriesConfigs.length >= 5) {
    return { volume: 0, open: 1, high: 2, low: 3, close: 4 };
  }
  if (seriesConfigs.length >= 4) {
    return { open: 0, high: 1, low: 2, close: 3 };
  }
  if (seriesConfigs.length >= 3) {
    return { high: 0, low: 1, close: 2 };
  }
  return null;
}

function hasCategoryDimensionConfig(seriesConfig: SeriesConfig): boolean {
  return Boolean(
    seriesConfig.categories?.trim() ||
    seriesConfig.categoryCache ||
    hasRenderableCategoryLevels(seriesConfig.categoryLevels),
  );
}

function isQuantitativeXSeries(
  seriesConfig: SeriesConfig,
  chartType: ChartConfig['type'],
): boolean {
  if (seriesConfig.xRole === 'quantitative') return true;
  if (seriesConfig.xRole === 'category') return false;
  return (
    chartType === 'scatter' ||
    chartType === 'bubble' ||
    seriesConfig.type === 'scatter' ||
    seriesConfig.type === 'bubble'
  );
}

type ImportedDimension = {
  values: ChartCellValue[];
  hasLiveRange: boolean;
};

type CategoryDimension = ImportedDimension & {
  categoryLevels?: ChartCategoryLevelData[];
};

function extractImportedDimension(
  accessor: CellDataAccessor,
  ref: string | undefined,
  cache: SeriesConfig['valueCache'],
  sourceKind:
    | SeriesConfig['valueSourceKind']
    | SeriesConfig['categorySourceKind']
    | SeriesConfig['bubbleSizeSourceKind']
    | undefined,
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
    values: Array.from({ length: pointCount }, (_, pointIndex) => cacheValueAt(cache, pointIndex)),
    hasLiveRange: false,
  };
}

function importedDimensionForSeries(
  accessor: CellDataAccessor,
  seriesConfig: SeriesConfig,
): ImportedDimension {
  return extractImportedDimension(
    accessor,
    seriesConfig.values,
    seriesConfig.valueCache,
    seriesConfig.valueSourceKind,
  );
}

function liveCategoryLevelsFromRange(
  accessor: CellDataAccessor,
  ref: string | undefined,
  sourceKind: SeriesConfig['categorySourceKind'] | undefined,
  cache: SeriesConfig['categoryLevels'],
  selectedLevel: number | undefined,
  fallbackAt: (pointIndex: number) => string | number,
): CategoryDimension | null {
  if (sourceKind === 'literal' || sourceKind === 'cacheFallback') return null;
  const range = tryParseRange(ref);
  if (!range) return null;

  const levels = orderedCategoryLevels(cache);
  if (levels.length === 0) return null;

  const rowCount = range.endRow - range.startRow + 1;
  const colCount = range.endCol - range.startCol + 1;
  let pointCount = 0;
  let cellFor: (levelIndex: number, pointIndex: number) => ChartCellValue;

  if (colCount === levels.length) {
    pointCount = rowCount;
    cellFor = (levelIndex, pointIndex) =>
      getRangeValue(accessor, range, range.startRow + pointIndex, range.startCol + levelIndex);
  } else if (rowCount === levels.length) {
    pointCount = colCount;
    cellFor = (levelIndex, pointIndex) =>
      getRangeValue(accessor, range, range.startRow + levelIndex, range.startCol + pointIndex);
  } else {
    return null;
  }

  const values = Array.from({ length: pointCount }, (_, pointIndex): ChartCellValue => {
    const rawValues = levels.map((_, levelIndex) => cellFor(levelIndex, pointIndex));
    if (rawValues.some(isHiddenChartCellValue)) return HIDDEN_CHART_CELL;

    if (selectedLevel !== undefined) {
      const selectedIndex = levels.findIndex((level) => level.level === selectedLevel);
      return labelValue(
        rawValues[selectedIndex >= 0 ? selectedIndex : selectedLevel],
        fallbackAt(pointIndex),
      );
    }

    const labels = rawValues
      .filter((value) => !isBlankChartCellValue(value))
      .map((value) => String(value));
    return labels.length > 0 ? labels.join(' / ') : fallbackAt(pointIndex);
  });

  const categoryLevels = levels.map((level, levelIndex) => ({
    level: level.level,
    labels: Array.from({ length: pointCount }, (_, pointIndex) => {
      const value = cellFor(levelIndex, pointIndex);
      return isHiddenChartCellValue(value) || isBlankChartCellValue(value) ? null : String(value);
    }),
  }));

  return { values, hasLiveRange: true, categoryLevels };
}

function extractImportedCategoryDimension(
  accessor: CellDataAccessor,
  seriesConfig: SeriesConfig,
  selectedLevel: number | undefined,
  fallbackAt: (pointIndex: number) => string | number,
): CategoryDimension {
  const categoryLevelsCache = seriesConfig.categoryLevels;
  if (hasRenderableCategoryLevels(categoryLevelsCache)) {
    const liveLevels = liveCategoryLevelsFromRange(
      accessor,
      seriesConfig.categories,
      seriesConfig.categorySourceKind,
      categoryLevelsCache,
      selectedLevel,
      fallbackAt,
    );
    if (liveLevels) return liveLevels;

    return {
      values: Array.from({ length: categoryLevelPointCardinality(categoryLevelsCache) }, (_, i) =>
        multiLevelCategoryLabelAt(categoryLevelsCache, i, selectedLevel, fallbackAt(i)),
      ),
      hasLiveRange: false,
      categoryLevels: categoryLevelsFromCache(categoryLevelsCache),
    };
  }

  return extractImportedDimension(
    accessor,
    seriesConfig.categories,
    seriesConfig.categoryCache,
    seriesConfig.categorySourceKind,
  );
}

function finiteStockValue(value: ChartCellValue): number | undefined {
  const numeric = toNumber(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function extractStockChartDataFromSeriesRefs(
  accessor: CellDataAccessor,
  seriesConfigs: SeriesConfig[],
  categoryLabelLevel: number | undefined,
): ChartData | null {
  const roles = stockRolePlan(seriesConfigs);
  if (!roles) return null;

  const roleDimensions = {
    open:
      roles.open === undefined
        ? undefined
        : importedDimensionForSeries(accessor, seriesConfigs[roles.open]),
    high: importedDimensionForSeries(accessor, seriesConfigs[roles.high]),
    low: importedDimensionForSeries(accessor, seriesConfigs[roles.low]),
    close: importedDimensionForSeries(accessor, seriesConfigs[roles.close]),
    volume:
      roles.volume === undefined
        ? undefined
        : importedDimensionForSeries(accessor, seriesConfigs[roles.volume]),
  };
  if (
    roleDimensions.high.values.length === 0 ||
    roleDimensions.low.values.length === 0 ||
    roleDimensions.close.values.length === 0 ||
    (roles.open !== undefined && roleDimensions.open?.values.length === 0)
  ) {
    return null;
  }

  const categoryCarrier =
    [roles.open, roles.high, roles.low, roles.close, roles.volume]
      .filter((index): index is number => index !== undefined)
      .map((index) => seriesConfigs[index])
      .find(hasCategoryDimensionConfig) ?? seriesConfigs[roles.close];
  const selectedLevel = selectedCategoryLabelLevel(categoryLabelLevel);
  const categoryDimension = extractImportedCategoryDimension(
    accessor,
    categoryCarrier,
    selectedLevel,
    (pointIndex) => pointIndex + 1,
  );
  const pointCount = Math.max(
    roleDimensions.open?.values.length ?? 0,
    roleDimensions.high.values.length,
    roleDimensions.low.values.length,
    roleDimensions.close.values.length,
    roleDimensions.volume?.values.length ?? 0,
    categoryDimension.values.length,
  );
  if (pointCount === 0) return null;
  const categoryLevels = categoryDimension.categoryLevels;

  const categories: (string | number)[] = [];
  const categoryFormatCodes: Array<string | null | undefined> = [];
  const data: ChartDataPoint[] = [];
  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    const categoryFallback = pointIndex + 1;
    const rawCategory = categoryDimension.values[pointIndex];
    const category =
      categoryDimension.categoryLevels && categoryDimension.values.length > pointIndex
        ? labelValue(rawCategory, categoryFallback)
        : categoryDimension.values.length > pointIndex
          ? categoryDimension.hasLiveRange
            ? labelValue(rawCategory, categoryFallback)
            : cacheLabelAt(categoryCarrier.categoryCache, pointIndex, categoryFallback)
          : cacheLabelAt(categoryCarrier.categoryCache, pointIndex, categoryFallback);
    const rawHigh = roleDimensions.high.values[pointIndex];
    const rawLow = roleDimensions.low.values[pointIndex];
    const rawClose = roleDimensions.close.values[pointIndex];
    const rawOpen = roleDimensions.open?.values[pointIndex];
    const rawVolume = roleDimensions.volume?.values[pointIndex];
    const pointHidden =
      isHiddenChartCellValue(rawCategory) ||
      isHiddenChartCellValue(rawHigh) ||
      isHiddenChartCellValue(rawLow) ||
      isHiddenChartCellValue(rawClose) ||
      isHiddenChartCellValue(rawOpen) ||
      isHiddenChartCellValue(rawVolume);
    const point = createDataPoint(category, rawClose, String(category), { hidden: pointHidden });
    const high = finiteStockValue(rawHigh);
    const low = finiteStockValue(rawLow);
    const close = finiteStockValue(rawClose);
    const open = finiteStockValue(rawOpen);
    const volume = finiteStockValue(rawVolume);
    if (open !== undefined) point.open = open;
    if (high !== undefined) point.high = high;
    if (low !== undefined) point.low = low;
    if (close !== undefined) point.close = close;
    if (volume !== undefined) point.volume = volume;
    data.push(point);
    categories[pointIndex] = point.x;
    categoryFormatCodes[pointIndex] = categoryFormatCodeAt(categoryCarrier, pointIndex);
  }

  const closeSeries = seriesConfigs[roles.close];
  return {
    categories,
    ...(categoryLevels ? { categoryLevels } : {}),
    ...(categoryFormatCodes.some(Boolean) ? { categoryFormatCodes } : {}),
    series: [
      {
        name: closeSeries.name ?? defaultSeriesName(closeSeries, roles.close),
        data,
        type: 'stock',
        ...chartDataSeriesIdentity(closeSeries, roles.close, 0),
      },
    ],
  };
}

export function extractChartDataFromSeriesRefs(
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
  if (chartType === 'stock') {
    const stockData = extractStockChartDataFromSeriesRefs(
      accessor,
      seriesConfigs,
      categoryLabelLevel,
    );
    if (stockData) return stockData;
  }

  for (let seriesIndex = 0; seriesIndex < seriesConfigs.length; seriesIndex++) {
    const seriesConfig = seriesConfigs[seriesIndex];
    const isXYSeries = isQuantitativeXSeries(seriesConfig, chartType);
    const valueDimension = extractImportedDimension(
      accessor,
      seriesConfig.values,
      seriesConfig.valueCache,
      seriesConfig.valueSourceKind,
    );
    if (valueDimension.values.length === 0) continue;

    const categoryDimension = extractImportedCategoryDimension(
      accessor,
      seriesConfig,
      selectedLevel,
      (pointIndex) => categories[pointIndex] ?? pointIndex + 1,
    );
    categoryLevels ??= categoryDimension.categoryLevels;
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
        isXYSeries && !categoryDimension.categoryLevels
          ? categoryDimension.values.length > pointIndex
            ? xyValue(rawCategory)
            : xyValue(cacheValueAt(seriesConfig.categoryCache, pointIndex))
          : categoryDimension.categoryLevels && categoryDimension.values.length > pointIndex
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
      ...chartDataSeriesIdentity(seriesConfig, seriesIndex, series.length),
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
