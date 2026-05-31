import {
  seriesConfigForDataSeries,
  seriesConfigSourceIndex,
  seriesConfigSourceKey,
  seriesSourceIndex,
  seriesSourceKey,
  type ChartConfig,
  type ChartData,
  type ChartDataPoint,
  type ChartDataSeries,
} from '@mog/charts';
import type {
  ChartSeriesProjectionAuthority,
  ChartSeriesProjectionDiagnosticReason,
  ResolvedChartSpecSnapshot,
} from '@mog-sdk/contracts/data/charts';

import type { ResolvedChartRangeReferences } from '../chart-range-references';
import { hasRenderableChartPointCache } from '../chart-point-cache';
import { isNoFillNoLineSeriesConfig } from './chart-render-data-normalizer';
import {
  dimensionRenderAuthority,
  hasRenderableCategoryLevelsCache,
} from './resolved-spec-series-authority';
import {
  effectiveSeriesXRole,
  estimatedRenderLayerCount,
} from './resolved-spec-series-render-traits';
import { hashJson, snapshotScalar } from './resolved-spec-primitives';

export { renderAuthorityDiagnostics } from './resolved-spec-series-authority';

type SeriesRangeReference = ResolvedChartRangeReferences['seriesReferences'][number];

export function hasRenderableChartExData(config: ChartConfig): boolean {
  return (
    config.series?.some(
      (series) => series.values?.trim() || hasRenderableChartPointCache(series.valueCache),
    ) ?? false
  );
}

export function snapshotSeries(
  series: ChartDataSeries,
  index: number,
  categories: Array<string | number | null>,
  config: ChartConfig,
  hasExplicitSeriesReferences: boolean,
  rangeReference: SeriesRangeReference | undefined,
): ResolvedChartSpecSnapshot['resolved']['series'][number] {
  const configured = seriesConfigForDataSeries(series, config.series ?? [], index);
  const sourceSeriesIndex = seriesSourceIndex(series, index);
  const sourceSeriesKey = seriesSourceKey(series, index);
  const values: Array<number | null> = [];
  const xValues: Array<string | number | null> = [];
  const bubbleSizes: Array<number | null> = [];
  const stockValues = {
    open: [] as Array<number | null>,
    high: [] as Array<number | null>,
    low: [] as Array<number | null>,
    close: [] as Array<number | null>,
    volume: [] as Array<number | null>,
  };
  const blankMask: boolean[] = [];
  const seriesCategories = snapshotCategoriesForSeries(
    series,
    configured,
    categories,
    hasExplicitSeriesReferences,
  );
  const length = Math.max(seriesCategories.length, series.data.length);
  for (let pointIndex = 0; pointIndex < length; pointIndex += 1) {
    const point = series.data[pointIndex];
    const value = numericPointValue(point);
    xValues.push(snapshotScalar(point?.x));
    values.push(value);
    bubbleSizes.push(numericPointField(point, 'size'));
    stockValues.open.push(numericPointField(point, 'open'));
    stockValues.high.push(numericPointField(point, 'high'));
    stockValues.low.push(numericPointField(point, 'low'));
    stockValues.close.push(numericPointField(point, 'close'));
    stockValues.volume.push(numericPointField(point, 'volume'));
    blankMask.push(value === null);
  }
  const source = {
    values: configured?.values,
    categories: configured?.categories,
    bubbleSize: configured?.bubbleSize,
    stockRole: configured?.stockRole,
    valueSourceKind: configured?.valueSourceKind,
    categorySourceKind: configured?.categorySourceKind,
    bubbleSizeSourceKind: configured?.bubbleSizeSourceKind,
  };
  const renderAuthority = {
    values: dimensionRenderAuthority({
      cache: configured?.valueCache,
      sourceKind: configured?.valueSourceKind,
      resolvedRange: rangeReference?.values,
    }),
    categories: dimensionRenderAuthority({
      cache: configured?.categoryCache,
      cacheRenderable:
        hasRenderableChartPointCache(configured?.categoryCache) ||
        hasRenderableCategoryLevelsCache(configured?.categoryLevels),
      sourceKind: configured?.categorySourceKind,
      resolvedRange: rangeReference?.categories,
    }),
    bubbleSize: dimensionRenderAuthority({
      cache: configured?.bubbleSizeCache,
      sourceKind: configured?.bubbleSizeSourceKind,
      resolvedRange: rangeReference?.bubbleSizes ?? null,
    }),
  };
  const name = snapshotSeriesName(series, configured, sourceSeriesIndex);
  const renderedPointCount = values.filter((value) => value !== null).length;
  const effectiveType = series.type ?? configured?.type;
  const xRole = effectiveSeriesXRole(config, configured, effectiveType);
  const includeStockValues = shouldSnapshotStockValues(
    config,
    effectiveType,
    configured,
    stockValues,
  );

  return {
    index,
    order: configured?.order ?? configured?.idx ?? index,
    sourceSeriesIndex,
    sourceSeriesKey,
    visibleOrder: configured?.visibleOrder ?? series.visibleOrder ?? index,
    pivotSeriesKey: configured?.pivotSeriesKey ?? series.pivotSeriesKey,
    pivotDataFieldIndex: configured?.pivotDataFieldIndex ?? series.pivotDataFieldIndex,
    projectionAuthority:
      series.projectionAuthority ??
      configured?.projectionAuthority ??
      seriesProjectionAuthority(config, configured, hasExplicitSeriesReferences),
    projectionDiagnostics: [
      ...(configured?.projectionDiagnostics ?? []),
      ...(series.projectionDiagnostics ?? []),
    ],
    name,
    type: effectiveType,
    axisGroup: series.yAxisIndex === 1 || configured?.yAxisIndex === 1 ? 'secondary' : 'primary',
    xRole,
    stockRole: configured?.stockRole,
    showLines: configured?.showLines,
    smooth: configured?.smooth,
    showMarkers: configured?.showMarkers,
    markerStyle: configured?.markerStyle,
    renderLayerCount: estimatedRenderLayerCount(config, configured, effectiveType, index),
    color:
      series.color ??
      configured?.color ??
      config.colors?.[sourceSeriesIndex] ??
      config.colors?.[index],
    source,
    renderAuthority,
    xValues,
    categories: seriesCategories,
    values,
    bubbleSizes,
    ...(includeStockValues ? { stockValues } : {}),
    blankMask,
    pointCount: length,
    renderedPointCount,
    dataHash: hashJson({
      name,
      sourceSeriesIndex,
      sourceSeriesKey,
      type: effectiveType,
      xRole,
      showLines: configured?.showLines,
      smooth: configured?.smooth,
      showMarkers: configured?.showMarkers,
      markerStyle: configured?.markerStyle,
      renderLayerCount: estimatedRenderLayerCount(config, configured, effectiveType, index),
      source,
      renderAuthority,
      xValues,
      categories: seriesCategories,
      categoryFormatCodes: configured?.categoryLabelFormat,
      values,
      bubbleSizes,
      stockValues: includeStockValues ? stockValues : undefined,
      blankMask,
    }),
  };
}

function seriesProjectionAuthority(
  config: ChartConfig,
  configured: NonNullable<ChartConfig['series']>[number] | undefined,
  hasExplicitSeriesReferences: boolean,
): ChartSeriesProjectionAuthority {
  if (configured?.projectionAuthority) return configured.projectionAuthority;
  if (config.pivotProjection?.authority) return config.pivotProjection.authority;
  if (hasExplicitSeriesReferences) return 'explicitSeries';
  return config.dataRange ? 'liveRange' : 'unavailable';
}

export function snapshotSeriesProjection(
  config: ChartConfig,
  data: ChartData,
  series: ResolvedChartSpecSnapshot['resolved']['series'],
): ResolvedChartSpecSnapshot['resolved']['seriesProjection'] {
  const renderedPointCountBySourceSeriesKey: Record<string, number> = {};
  for (const item of series) {
    renderedPointCountBySourceSeriesKey[item.sourceSeriesKey] = item.renderedPointCount;
  }

  const projectedKeys = new Set(series.map((item) => item.sourceSeriesKey));
  const droppedSeries =
    config.series
      ?.map((configured, index) => {
        const sourceSeriesIndex = seriesConfigSourceIndex(configured, index);
        const sourceSeriesKey = seriesConfigSourceKey(configured, sourceSeriesIndex);
        if (projectedKeys.has(sourceSeriesKey)) return undefined;
        const diagnostic = configured.projectionDiagnostics?.[0];
        return {
          sourceSeriesIndex,
          sourceSeriesKey,
          name: configured.name,
          reason: diagnostic?.reason ?? droppedSeriesReason(configured),
          message: diagnostic?.message,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== undefined) ?? [];

  const renderedSeriesCount = series.filter((item) => item.renderedPointCount > 0).length;
  const hasExplicitSeries = config.series?.some((item) =>
    Boolean(item.values || item.valueCache || item.categories || item.categoryCache),
  );
  return {
    authority:
      config.pivotProjection?.authority ??
      (hasExplicitSeries ? 'explicitSeries' : config.dataRange ? 'liveRange' : 'unavailable'),
    expectedImportedSeriesCount:
      config.pivotProjection?.expectedImportedSeriesCount ??
      config.series?.length ??
      data.series.length,
    projectedSeriesCount: config.pivotProjection?.projectedSeriesCount ?? data.series.length,
    renderedSeriesCount: config.pivotProjection?.renderedSeriesCount ?? renderedSeriesCount,
    renderedPointCountBySourceSeriesKey,
    droppedSeries,
  };
}

function droppedSeriesReason(
  series: NonNullable<ChartConfig['series']>[number],
): ChartSeriesProjectionDiagnosticReason {
  if (series.filtered) return 'allItemsFiltered';
  if (isNoFillNoLineSeriesConfig(series)) return 'styleResolvedNoFillOrLine';
  if (series.projectionAuthority === 'unavailable') return 'unresolvedPivotSource';
  return 'noValueData';
}

function snapshotSeriesName(
  series: ChartDataSeries,
  configured: NonNullable<ChartConfig['series']>[number] | undefined,
  index: number,
): string {
  if (series.name) return series.name;
  if (configured?.name) return configured.name;

  if (
    typeof configured?.idx === 'number' &&
    Number.isInteger(configured.idx) &&
    configured.idx > 0
  ) {
    return `Series ${configured.idx}`;
  }

  if (
    typeof configured?.order === 'number' &&
    Number.isInteger(configured.order) &&
    configured.order >= 0
  ) {
    return `Series ${configured.order + 1}`;
  }

  return `Series ${index + 1}`;
}

function snapshotCategoriesForSeries(
  series: ChartDataSeries,
  configured: NonNullable<ChartConfig['series']>[number] | undefined,
  categories: Array<string | number | null>,
  hasExplicitSeriesReferences: boolean,
): Array<string | number | null> {
  if (configured?.categories) {
    return series.data.map((point) => snapshotScalar(point?.x));
  }
  return !hasExplicitSeriesReferences ? categories : [];
}

function numericPointValue(point: ChartDataPoint | undefined): number | null {
  if (point?.valueState && point.valueState !== 'value') return null;
  if (!point || typeof point.y !== 'number' || !Number.isFinite(point.y)) return null;
  return point.y;
}

function numericPointField(
  point: ChartDataPoint | undefined,
  field: 'size' | 'open' | 'high' | 'low' | 'close' | 'volume',
): number | null {
  if (point?.valueState && point.valueState !== 'value') return null;
  const value = point?.[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function shouldSnapshotStockValues(
  config: ChartConfig,
  effectiveType: string | undefined,
  configured: NonNullable<ChartConfig['series']>[number] | undefined,
  stockValues: {
    open: Array<number | null>;
    high: Array<number | null>;
    low: Array<number | null>;
    close: Array<number | null>;
    volume: Array<number | null>;
  },
): boolean {
  return (
    config.type === 'stock' ||
    effectiveType === 'stock' ||
    configured?.stockRole !== undefined ||
    Object.values(stockValues).some((values) => values.some((value) => value !== null))
  );
}
