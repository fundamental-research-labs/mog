import { seriesConfigForDataSeries, type ChartData, type ChartDataPoint } from '@mog/charts';
import type { ChartConfig } from '@mog-sdk/contracts/data/charts';

export {
  isNoFillNoLineSeriesConfig,
  sourceLinkedAxisNumberFormatDiagnostics,
  withSourceLinkedAxisNumberFormats,
} from './source-linked-axis-formats';
export type {
  SourceLinkedAxisNumberFormatResolution,
  SourceLinkedAxisNumberFormatResolutions,
  SourceLinkedAxisRole,
} from './source-linked-axis-formats';

export function withCategoryFormatCodes(data: ChartData, config: ChartConfig): ChartData {
  const categoryLabelFormat = config.series?.find(
    (series) => series.categoryLabelFormat,
  )?.categoryLabelFormat;
  if (!categoryLabelFormat) return data;

  const categoryFormatCodes = data.categories.map(() => categoryLabelFormat.formatCode ?? null);
  for (const point of categoryLabelFormat.points ?? []) {
    if (point.idx >= 0 && point.idx < categoryFormatCodes.length && point.formatCode) {
      categoryFormatCodes[point.idx] = point.formatCode;
    }
  }

  return categoryFormatCodes.some(Boolean) ? { ...data, categoryFormatCodes } : data;
}

function isBlankChartScalar(value: string | number | null | undefined): boolean {
  return value === null || value === undefined || value === '';
}

function isBlankChartPoint(point: ChartDataPoint | undefined): boolean {
  if (!point) return true;
  return point.valueState === 'blank';
}

type ImportedPointCache = {
  pointCount?: unknown;
  points?: unknown;
};

type ImportedPointCachePoint = {
  idx?: unknown;
  value?: unknown;
};

type ChartSeriesConfig = NonNullable<ChartConfig['series']>[number];

function importedCategoryCache(
  series: NonNullable<ChartConfig['series']>[number] | undefined,
): ImportedPointCache | undefined {
  if (!series || typeof series !== 'object') return undefined;
  const cache = (series as { categoryCache?: unknown }).categoryCache;
  return cache && typeof cache === 'object' ? (cache as ImportedPointCache) : undefined;
}

function importedCachePointCount(cache: ImportedPointCache | undefined): number | undefined {
  const pointCount = cache?.pointCount;
  return typeof pointCount === 'number' && Number.isInteger(pointCount) && pointCount >= 0
    ? pointCount
    : undefined;
}

function importedCachePoint(
  cache: ImportedPointCache | undefined,
  pointIndex: number,
): ImportedPointCachePoint | undefined {
  const points = Array.isArray(cache?.points) ? cache.points : [];
  return points.find((point): point is ImportedPointCachePoint => {
    if (!point || typeof point !== 'object') return false;
    return (point as ImportedPointCachePoint).idx === pointIndex;
  });
}

function importedCategoryCacheValue(
  cache: ImportedPointCache | undefined,
  pointIndex: number,
): string | number | undefined {
  const point = importedCachePoint(cache, pointIndex);
  if (!point) return undefined;
  const value = point.value;
  if (value === null || value === undefined || value === '') return '';
  const numeric = Number(value);
  return Number.isFinite(numeric) && String(value).trim() !== '' ? numeric : String(value);
}

function isQuantitativeXChartType(type: string | undefined): boolean {
  return type === 'scatter' || type === 'bubble' || type === 'bubble3DEffect';
}

function isQuantitativeXSeries(
  config: ChartConfig,
  series: ChartSeriesConfig | undefined,
): boolean {
  if (series?.xRole === 'quantitative') return true;
  if (series?.xRole === 'category') return false;
  return isQuantitativeXChartType(series?.type ?? config.type);
}

function isImportedCategoryCarrier(series: ChartSeriesConfig | undefined): boolean {
  return Boolean(series?.categories || importedCategoryCache(series));
}

function categoricalCategorySeriesIndex(data: ChartData, config: ChartConfig): number {
  const seriesConfigs = config.series ?? [];
  return data.series.findIndex((series, index) => {
    const seriesConfig = seriesConfigForDataSeries(series, seriesConfigs, index);
    return isImportedCategoryCarrier(seriesConfig) && !isQuantitativeXSeries(config, seriesConfig);
  });
}

export function normalizeImportedCategoryData(data: ChartData, config: ChartConfig): ChartData {
  const seriesConfigs = config.series ?? [];
  const categorySeriesIndex = categoricalCategorySeriesIndex(data, config);
  const categoryDataSeries =
    categorySeriesIndex >= 0 ? data.series[categorySeriesIndex] : undefined;
  const seriesConfig =
    categoryDataSeries && categorySeriesIndex >= 0
      ? seriesConfigForDataSeries(categoryDataSeries, seriesConfigs, categorySeriesIndex)
      : undefined;
  if (!seriesConfig) return data;

  const categoryCache = importedCategoryCache(seriesConfig);
  const categoryPointCount = importedCachePointCount(categoryCache);
  if (!categoryCache && !seriesConfig.categories) return data;

  const categoricalSeriesIndexes = data.series.flatMap((series, index) => {
    const itemConfig = seriesConfigForDataSeries(series, seriesConfigs, index);
    return isQuantitativeXSeries(config, itemConfig) ? [] : [index];
  });
  const hasQuantitativeSeries = categoricalSeriesIndexes.length < data.series.length;
  const maxLength = Math.max(
    hasQuantitativeSeries ? 0 : data.categories.length,
    categoryPointCount ?? 0,
    ...categoricalSeriesIndexes.map((index) => data.series[index].data.length),
  );
  if (maxLength <= 0) return data;

  let changed = false;
  const categories: Array<string | number> = [];
  for (let pointIndex = 0; pointIndex < maxLength; pointIndex += 1) {
    const cached = importedCategoryCacheValue(categoryCache, pointIndex);
    const isOmittedCachedPoint =
      cached === undefined &&
      categoryPointCount !== undefined &&
      pointIndex >= 0 &&
      pointIndex < categoryPointCount;
    const isBeyondCachedDomain =
      categoryPointCount !== undefined &&
      pointIndex >= categoryPointCount &&
      categoricalSeriesIndexes.every((index) =>
        isBlankChartPoint(data.series[index].data[pointIndex]),
      );
    const configuredSeriesCategory = data.series[categorySeriesIndex]?.data[pointIndex]?.x;
    const fallbackCategory =
      (hasQuantitativeSeries ? undefined : data.categories[pointIndex]) ??
      categoricalSeriesIndexes
        .map((index) => data.series[index])
        .find((series) => series.data[pointIndex])?.data[pointIndex]?.x ??
      '';
    const current = seriesConfig.categories
      ? (configuredSeriesCategory ?? fallbackCategory)
      : fallbackCategory;
    const next = seriesConfig.categories
      ? current
      : (cached ?? (isOmittedCachedPoint || isBeyondCachedDomain ? '' : current));
    categories.push(next);
    if (next !== data.categories[pointIndex]) changed = true;
  }

  const series = data.series.map((item, seriesIndex) => {
    const itemConfig = seriesConfigForDataSeries(item, seriesConfigs, seriesIndex);
    if (isQuantitativeXSeries(config, itemConfig)) return item;

    return {
      ...item,
      data: item.data.map((point, pointIndex) => {
        const category = categories[pointIndex];
        if (!point || point.x === category) return point;
        changed = true;
        return { ...point, x: category, name: String(category) };
      }),
    };
  });

  return changed ? { ...data, categories, series } : data;
}

export function trimTrailingBlankChartData(data: ChartData): ChartData {
  let lastIndex =
    Math.max(data.categories.length, ...data.series.map((series) => series.data.length)) - 1;

  while (
    lastIndex >= 0 &&
    isBlankChartScalar(data.categories[lastIndex]) &&
    data.series.every((series) => isBlankChartPoint(series.data[lastIndex]))
  ) {
    lastIndex -= 1;
  }

  if (lastIndex < 0) {
    return {
      ...data,
      categories: [],
      ...(data.categoryLevels
        ? {
            categoryLevels: data.categoryLevels.map((level) => ({
              ...level,
              labels: [],
            })),
          }
        : {}),
      ...(data.categoryFormatCodes ? { categoryFormatCodes: [] } : {}),
      series: [],
    };
  }
  if (
    lastIndex === data.categories.length - 1 &&
    data.series.every((series) => lastIndex === series.data.length - 1)
  ) {
    return data;
  }

  return {
    ...data,
    categories: data.categories.slice(0, lastIndex + 1),
    ...(data.categoryLevels
      ? {
          categoryLevels: data.categoryLevels.map((level) => ({
            ...level,
            labels: level.labels.slice(0, lastIndex + 1),
          })),
        }
      : {}),
    ...(data.categoryFormatCodes
      ? { categoryFormatCodes: data.categoryFormatCodes.slice(0, lastIndex + 1) }
      : {}),
    series: data.series.map((series) => ({
      ...series,
      data: series.data.slice(0, lastIndex + 1),
    })),
  };
}

export function normalizeChartDataForRendering(data: ChartData, config: ChartConfig): ChartData {
  const normalized = normalizeImportedCategoryData(withCategoryFormatCodes(data, config), config);
  return preservesBlankCategoryDomain(config) ? normalized : trimTrailingBlankChartData(normalized);
}

function preservesBlankCategoryDomain(config: ChartConfig): boolean {
  return config.displayBlanksAs === 'gap' || config.displayBlanksAs === 'span';
}
