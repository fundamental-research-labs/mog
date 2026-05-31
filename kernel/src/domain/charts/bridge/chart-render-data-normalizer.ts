import type { ChartData, ChartDataPoint } from '@mog/charts';
import type {
  ChartConfig,
  ChartSeriesPointCache,
  SeriesConfig,
  SingleAxisConfig,
} from '@mog-sdk/contracts/data/charts';

type AxisRole = 'category' | 'secondary category' | 'value' | 'secondary value';

type AxisSourceFormatResolution = {
  formatCode?: string;
  missingSource: boolean;
  conflictingFormats: boolean;
};

const GENERAL_FORMAT = 'General';

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

function normalizeFormatCode(formatCode: string | null | undefined): string | undefined {
  const normalized = formatCode?.trim();
  return normalized ? normalized : undefined;
}

function cacheFormatCode(cache: ChartSeriesPointCache | undefined): string | undefined {
  return (
    normalizeFormatCode(cache?.formatCode) ??
    cache?.points.map((point) => normalizeFormatCode(point.formatCode)).find(Boolean)
  );
}

function firstCategorySourceFormat(config: ChartConfig): AxisSourceFormatResolution {
  const formatCode = config.series
    ?.map((series) => {
      const categoryLabelFormat = series.categoryLabelFormat;
      return (
        normalizeFormatCode(categoryLabelFormat?.formatCode) ??
        categoryLabelFormat?.points
          ?.map((point) => normalizeFormatCode(point.formatCode))
          .find(Boolean) ??
        cacheFormatCode(series.categoryCache)
      );
    })
    .find(Boolean);

  return { formatCode, missingSource: !formatCode, conflictingFormats: false };
}

function valueAxisGroup(role: AxisRole): 0 | 1 | undefined {
  if (role === 'value') return 0;
  if (role === 'secondary value') return 1;
  return undefined;
}

function isSeriesBoundToAxis(series: SeriesConfig, axisGroup: 0 | 1): boolean {
  return axisGroup === 1 ? series.yAxisIndex === 1 : series.yAxisIndex !== 1;
}

function firstValueSourceFormat(
  config: ChartConfig,
  axisGroup: 0 | 1,
): AxisSourceFormatResolution {
  const sourceFormats =
    config.series
      ?.filter((series) => isSeriesBoundToAxis(series, axisGroup))
      .filter((series) => !isNoFillNoLineSeriesConfig(series))
      .map((series) => cacheFormatCode(series.valueCache))
      .filter((formatCode): formatCode is string => Boolean(formatCode)) ?? [];
  const formatCode = sourceFormats[0];
  const conflictingFormats = sourceFormats.some((candidate) => candidate !== formatCode);
  return { formatCode, missingSource: !formatCode, conflictingFormats };
}

function sourceLinkedAxisFormat(
  config: ChartConfig,
  role: AxisRole,
): AxisSourceFormatResolution {
  const axisGroup = valueAxisGroup(role);
  if (axisGroup !== undefined) return firstValueSourceFormat(config, axisGroup);
  return firstCategorySourceFormat(config);
}

function axisWithResolvedNumberFormat(
  axis: SingleAxisConfig | undefined,
  config: ChartConfig,
  role: AxisRole,
): SingleAxisConfig | undefined {
  if (!axis?.linkNumberFormat) return axis;
  const resolution = sourceLinkedAxisFormat(config, role);
  const numberFormat = resolution.formatCode ?? normalizeFormatCode(axis.numberFormat);
  if (!numberFormat || numberFormat === axis.numberFormat) return axis;
  return { ...axis, numberFormat };
}

function axisSourceFormatDiagnostic(
  axis: SingleAxisConfig | undefined,
  config: ChartConfig,
  role: AxisRole,
): string | undefined {
  if (!axis?.linkNumberFormat) return undefined;
  const resolution = sourceLinkedAxisFormat(config, role);
  if (resolution.missingSource) {
    return `${role} axis source-linked number format has no source format; using ${
      normalizeFormatCode(axis.numberFormat) ?? GENERAL_FORMAT
    }`;
  }
  if (resolution.conflictingFormats) {
    return `${role} axis source-linked number format uses first bound series format due to conflicting source formats`;
  }
  return undefined;
}

/**
 * Resolve Excel source-linked axis formats before rendering.
 *
 * Category axes inherit imported category label/cache formats. Value axes inherit
 * the first visible bound series' value cache format for their axis group; this
 * keeps primary and secondary value axes independent while preserving the
 * original linkNumberFormat contract for export.
 */
export function withSourceLinkedAxisNumberFormats(config: ChartConfig): ChartConfig {
  const axis = config.axis;
  if (!axis) return config;

  const categoryAxis = axisWithResolvedNumberFormat(
    axis.categoryAxis ?? axis.xAxis,
    config,
    'category',
  );
  const secondaryCategoryAxis = axisWithResolvedNumberFormat(
    axis.secondaryCategoryAxis,
    config,
    'secondary category',
  );
  const valueAxis = axisWithResolvedNumberFormat(axis.valueAxis ?? axis.yAxis, config, 'value');
  const secondaryValueAxis = axisWithResolvedNumberFormat(
    axis.secondaryValueAxis ?? axis.secondaryYAxis,
    config,
    'secondary value',
  );

  if (
    categoryAxis === (axis.categoryAxis ?? axis.xAxis) &&
    secondaryCategoryAxis === axis.secondaryCategoryAxis &&
    valueAxis === (axis.valueAxis ?? axis.yAxis) &&
    secondaryValueAxis === (axis.secondaryValueAxis ?? axis.secondaryYAxis)
  ) {
    return config;
  }

  return {
    ...config,
    axis: {
      ...axis,
      ...(categoryAxis ? { categoryAxis, xAxis: categoryAxis } : {}),
      ...(secondaryCategoryAxis ? { secondaryCategoryAxis } : {}),
      ...(valueAxis ? { valueAxis, yAxis: valueAxis } : {}),
      ...(secondaryValueAxis
        ? { secondaryValueAxis, secondaryYAxis: secondaryValueAxis }
        : {}),
    },
  };
}

export function sourceLinkedAxisNumberFormatDiagnostics(config: ChartConfig): string[] {
  const axis = config.axis;
  if (!axis) return [];
  return [
    axisSourceFormatDiagnostic(axis.categoryAxis ?? axis.xAxis, config, 'category'),
    axisSourceFormatDiagnostic(axis.secondaryCategoryAxis, config, 'secondary category'),
    axisSourceFormatDiagnostic(axis.valueAxis ?? axis.yAxis, config, 'value'),
    axisSourceFormatDiagnostic(
      axis.secondaryValueAxis ?? axis.secondaryYAxis,
      config,
      'secondary value',
    ),
  ].filter((diagnostic): diagnostic is string => Boolean(diagnostic));
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
    const next = seriesConfig.categories
      ? current
      : (cached ?? (isOmittedCachedPoint || isBeyondCachedDomain ? '' : current));
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
