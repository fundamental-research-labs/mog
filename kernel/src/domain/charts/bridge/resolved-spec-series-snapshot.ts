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
  ChartSeriesDimensionRenderAuthority,
  ChartSeriesDimensionSourceKind,
  ChartSeriesProjectionAuthority,
  ChartSeriesProjectionDiagnosticReason,
  ResolvedChartSpecSnapshot,
} from '@mog-sdk/contracts/data/charts';

import type {
  ResolvedChartRangeReference,
  ResolvedChartRangeReferences,
} from '../chart-range-references';
import { hasRenderableChartPointCache, type ChartPointCacheLike } from '../chart-point-cache';
import { isNoFillNoLineSeriesConfig } from './chart-render-data-normalizer';
import { hashJson, snapshotScalar } from './resolved-spec-primitives';

type SeriesRangeReference = ResolvedChartRangeReferences['seriesReferences'][number];

export function hasRenderableChartExData(config: ChartConfig): boolean {
  return (
    config.series?.some(
      (series) => series.values?.trim() || hasRenderableChartPointCache(series.valueCache),
    ) ?? false
  );
}

export function renderAuthorityDiagnostics(
  series: ResolvedChartSpecSnapshot['resolved']['series'],
): string[] {
  return series.flatMap((item) => {
    const seriesNumber = item.index + 1;
    return [
      renderAuthorityDiagnostic({
        seriesNumber,
        dimension: 'values',
        ref: item.source.values,
        authority: item.renderAuthority.values,
      }),
      renderAuthorityDiagnostic({
        seriesNumber,
        dimension: 'categories',
        ref: item.source.categories,
        authority: item.renderAuthority.categories,
      }),
      renderAuthorityDiagnostic({
        seriesNumber,
        dimension: 'bubbleSize',
        ref: item.source.bubbleSize,
        authority: item.renderAuthority.bubbleSize,
      }),
    ].filter((message): message is string => message !== undefined);
  });
}

function renderAuthorityDiagnostic(input: {
  seriesNumber: number;
  dimension: 'values' | 'categories' | 'bubbleSize';
  ref: string | undefined;
  authority: ChartSeriesDimensionRenderAuthority;
}): string | undefined {
  if (input.authority === 'literal') {
    return `Series ${input.seriesNumber} ${input.dimension} rendered from literal chart data.`;
  }
  if (input.authority === 'fallbackCache') {
    return input.ref?.trim()
      ? `Series ${input.seriesNumber} ${input.dimension} rendered from fallback cache because live source "${input.ref}" is unavailable.`
      : `Series ${input.seriesNumber} ${input.dimension} rendered from fallback cache without a live source.`;
  }
  return undefined;
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
  const blankMask: boolean[] = [];
  const seriesCategories = snapshotCategoriesForSeries(
    series,
    configured,
    categories,
    hasExplicitSeriesReferences,
  );
  const length = Math.max(seriesCategories.length, series.data.length);
  for (let pointIndex = 0; pointIndex < length; pointIndex += 1) {
    const value = numericPointValue(series.data[pointIndex]);
    values.push(value);
    blankMask.push(value === null);
  }
  const source = {
    values: configured?.values,
    categories: configured?.categories,
    bubbleSize: configured?.bubbleSize,
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
    categories: seriesCategories,
    values,
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
      categories: seriesCategories,
      categoryFormatCodes: configured?.categoryLabelFormat,
      values,
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

function dimensionRenderAuthority(input: {
  cache: ChartPointCacheLike | null | undefined;
  cacheRenderable?: boolean;
  sourceKind: ChartSeriesDimensionSourceKind | undefined;
  resolvedRange: ResolvedChartRangeReference | null | undefined;
}): ChartSeriesDimensionRenderAuthority {
  const cacheRenderable = input.cacheRenderable ?? hasRenderableChartPointCache(input.cache);
  if (input.sourceKind === 'literal') {
    return cacheRenderable ? 'literal' : 'unavailable';
  }
  if (input.sourceKind === 'cacheFallback') {
    return cacheRenderable ? 'fallbackCache' : 'unavailable';
  }
  if (input.resolvedRange) {
    return 'live';
  }
  if (cacheRenderable) {
    return 'fallbackCache';
  }
  return 'unavailable';
}

function hasRenderableCategoryLevelsCache(
  cache: NonNullable<NonNullable<ChartConfig['series']>[number]['categoryLevels']> | undefined,
): boolean {
  return categoryLevelPointCardinality(cache) > 0 && (cache?.levels.length ?? 0) > 0;
}

function categoryLevelPointCardinality(
  cache: NonNullable<NonNullable<ChartConfig['series']>[number]['categoryLevels']> | undefined,
): number {
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

function effectiveSeriesXRole(
  config: ChartConfig,
  series: NonNullable<ChartConfig['series']>[number] | undefined,
  seriesType: string | undefined,
): 'category' | 'quantitative' | undefined {
  if (series?.xRole) return series.xRole;
  if (
    config.type === 'scatter' ||
    config.type === 'bubble' ||
    seriesType === 'scatter' ||
    seriesType === 'bubble'
  ) {
    return 'quantitative';
  }
  return series?.categories ? 'category' : undefined;
}

function estimatedRenderLayerCount(
  config: ChartConfig,
  series: NonNullable<ChartConfig['series']>[number] | undefined,
  seriesType: string | undefined,
  index: number,
): number {
  const type =
    seriesType ?? (config.type === 'combo' ? (index === 0 ? 'column' : 'line') : config.type);
  if (!isKnownRenderableSeriesType(type)) return 0;
  const markFamily = seriesMarkFamily(type);
  const showLines = effectiveSeriesShowLines(config, series, type);
  const showMarkers = effectiveSeriesShowMarkers(series, type, config.type, !showLines);
  if (markFamily === 'point') return (showLines ? 1 : 0) + (showMarkers ? 1 : 0);
  if (markFamily === 'line' || markFamily === 'area') {
    return (showLines ? 1 : 0) + (showMarkers ? 1 : 0);
  }
  return 1;
}

function effectiveSeriesShowLines(
  config: ChartConfig,
  series: NonNullable<ChartConfig['series']>[number] | undefined,
  seriesType: string,
): boolean {
  if (series?.showLines !== undefined) return series.showLines;
  if (seriesType === 'scatter' || seriesType === 'bubble') return config.showLines === true;
  const markFamily = seriesMarkFamily(seriesType);
  return markFamily === 'line' || markFamily === 'area';
}

function effectiveSeriesShowMarkers(
  series: NonNullable<ChartConfig['series']>[number] | undefined,
  seriesType: string | undefined,
  chartType: ChartConfig['type'],
  defaultValue = false,
): boolean {
  if (series?.markerStyle === 'none') return false;
  if (series?.showMarkers !== undefined) return series.showMarkers;
  if (series?.markerStyle !== undefined || series?.markerSize !== undefined) return true;
  if (
    series?.points?.some(
      (point) =>
        point.markerStyle !== undefined ||
        point.markerSize !== undefined ||
        point.markerBackgroundColor !== undefined ||
        point.markerForegroundColor !== undefined,
    )
  ) {
    return true;
  }
  return (
    chartType === 'lineMarkers' ||
    seriesType === 'lineMarkers' ||
    seriesType === 'lineMarkersStacked' ||
    seriesType === 'lineMarkersStacked100' ||
    defaultValue
  );
}

function seriesMarkFamily(
  seriesType: string | undefined,
): 'bar' | 'line' | 'area' | 'point' | 'other' {
  switch (seriesType) {
    case 'bar':
    case 'column':
    case 'bar3d':
    case 'column3d':
    case 'bar3D':
    case 'column3D':
    case 'cylinderColClustered':
    case 'cylinderColStacked':
    case 'cylinderColStacked100':
    case 'cylinderBarClustered':
    case 'cylinderBarStacked':
    case 'cylinderBarStacked100':
    case 'cylinderCol':
    case 'coneColClustered':
    case 'coneColStacked':
    case 'coneColStacked100':
    case 'coneBarClustered':
    case 'coneBarStacked':
    case 'coneBarStacked100':
    case 'coneCol':
    case 'pyramidColClustered':
    case 'pyramidColStacked':
    case 'pyramidColStacked100':
    case 'pyramidBarClustered':
    case 'pyramidBarStacked':
    case 'pyramidBarStacked100':
    case 'pyramidCol':
      return 'bar';
    case 'line':
    case 'line3d':
    case 'line3D':
    case 'lineMarkers':
    case 'lineMarkersStacked':
    case 'lineMarkersStacked100':
      return 'line';
    case 'area':
    case 'area3d':
    case 'area3D':
      return 'area';
    case 'scatter':
    case 'bubble':
    case 'bubble3DEffect':
      return 'point';
    default:
      return 'other';
  }
}

function isKnownRenderableSeriesType(seriesType: string | undefined): boolean {
  return seriesMarkFamily(seriesType) !== 'other';
}
