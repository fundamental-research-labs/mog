import type { ChartConfig, ChartData, ChartDataPoint } from '@mog/charts';

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

function hasVisibleChartLineStyle(line: unknown): boolean {
  if (!line || typeof line !== 'object') return false;
  const candidate = line as { color?: unknown; width?: unknown };
  return candidate.color !== undefined || candidate.width !== undefined;
}

export function isNoFillNoLineSeriesConfig(
  series: NonNullable<ChartConfig['series']>[number] | undefined,
): boolean {
  if (!series?.format) return false;
  return series.format.fill?.type === 'none' && !hasVisibleChartLineStyle(series.format.line);
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

export function normalizeImportedCategoryData(data: ChartData, config: ChartConfig): ChartData {
  const categorySeriesIndex =
    config.series?.findIndex(
      (series) => Boolean(series.categories) || importedCategoryCache(series),
    ) ?? -1;
  const seriesConfig = categorySeriesIndex >= 0 ? config.series?.[categorySeriesIndex] : undefined;
  if (!seriesConfig) return data;

  const categoryCache = importedCategoryCache(seriesConfig);
  const categoryPointCount = importedCachePointCount(categoryCache);
  if (!categoryCache && !seriesConfig.categories) return data;

  const maxLength = Math.max(
    data.categories.length,
    ...data.series.map((series) => series.data.length),
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
      data.series.every((series) => isBlankChartPoint(series.data[pointIndex]));
    const configuredSeriesCategory = data.series[categorySeriesIndex]?.data[pointIndex]?.x;
    const fallbackCategory =
      data.categories[pointIndex] ??
      data.series.find((series) => series.data[pointIndex])?.data[pointIndex]?.x ??
      '';
    const current = seriesConfig.categories
      ? (configuredSeriesCategory ?? fallbackCategory)
      : fallbackCategory;
    const next = cached ?? (isOmittedCachedPoint || isBeyondCachedDomain ? '' : current);
    categories.push(next);
    if (next !== data.categories[pointIndex]) changed = true;
  }

  const series = data.series.map((item) => ({
    ...item,
    data: item.data.map((point, pointIndex) => {
      const category = categories[pointIndex];
      if (!point || point.x === category) return point;
      changed = true;
      return { ...point, x: category, name: String(category) };
    }),
  }));

  return changed ? { ...data, categories, series } : data;
}

export function trimTrailingBlankChartData(data: ChartData): ChartData {
  let lastIndex = Math.max(
    data.categories.length,
    ...data.series.map((series) => series.data.length),
  ) - 1;

  while (
    lastIndex >= 0 &&
    isBlankChartScalar(data.categories[lastIndex]) &&
    data.series.every((series) => isBlankChartPoint(series.data[lastIndex]))
  ) {
    lastIndex -= 1;
  }

  if (lastIndex < 0) return { ...data, categories: [], series: [] };
  if (
    lastIndex === data.categories.length - 1 &&
    data.series.every((series) => lastIndex === series.data.length - 1)
  ) {
    return data;
  }

  return {
    ...data,
    categories: data.categories.slice(0, lastIndex + 1),
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
  return trimTrailingBlankChartData(
    normalizeImportedCategoryData(withCategoryFormatCodes(data, config), config),
  );
}
