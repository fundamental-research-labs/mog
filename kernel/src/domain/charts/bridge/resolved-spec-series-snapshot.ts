import {
  seriesConfigForDataSeries,
  seriesConfigSourceIndex,
  seriesConfigSourceKey,
  seriesSourceIndex,
  seriesSourceKey,
  renderedPointValueForRows,
  shouldProjectStockSeries,
  resolveSeriesColorAuthority,
  stockRenderedPointProjection,
  stockRenderedPointProjectionFromRoleValues,
  stockRoleOrder,
  stockRolePlan,
  stockSubTypeFromConfig,
  stockSubTypeFromRolePresence,
  type ChartConfig,
  type ChartData,
  type ChartDataPoint,
  type ChartDataSeries,
} from '@mog/charts';
import type {
  ChartSeriesProjectionAuthority,
  ChartSeriesProjectionDiagnosticReason,
  ChartSeriesStockRole,
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
type ResolvedSeriesSnapshot = ResolvedChartSpecSnapshot['resolved']['series'][number];
type SourceSeriesSnapshot = NonNullable<
  ResolvedChartSpecSnapshot['resolved']['seriesProjection']['sourceSeries']
>[number];
type ProjectedRoleMappingSnapshot = NonNullable<
  ResolvedChartSpecSnapshot['resolved']['seriesProjection']['projectedRoleMappings']
>[number];
type StockRenderProjectionSnapshot =
  ResolvedChartSpecSnapshot['resolved']['seriesProjection']['stockRenderProjection'];
type ChartSeriesConfig = NonNullable<ChartConfig['series']>[number];

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
  const renderedValues: Array<number | null> = [];
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
    renderedValues.push(numericRenderedPointValue(point, config, configured));
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
  const effectiveType = series.type ?? configured?.type;
  const xRole = effectiveSeriesXRole(config, configured, effectiveType);
  const colorAuthority = resolveSeriesColorAuthority({
    config,
    series: configured,
    sourceSeriesIndex,
    renderedSeriesIndex: index,
    fallbackType: (effectiveType ?? config.type) as ChartConfig['type'],
  });
  const includeStockValues = shouldSnapshotStockValues(
    config,
    effectiveType,
    configured,
    stockValues,
  );
  const stockPointProjection = shouldUseStockRenderedPointProjection(
    config,
    effectiveType,
    configured,
    stockValues,
  )
    ? stockRenderedPointProjection(
        Array.from({ length }, (_, pointIndex) => series.data[pointIndex]),
        stockSubTypeFromConfig(config, { categories: [], series: [series] }),
      )
    : undefined;
  const includeRenderedValues = shouldSnapshotRenderedValues(config, effectiveType, configured);
  const renderedPointCount =
    stockPointProjection?.renderedPointCount ??
    (includeRenderedValues ? renderedValues : values).filter((value) => value !== null).length;

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
    ...(colorAuthority ? { colorAuthority } : {}),
    source,
    renderAuthority,
    xValues,
    categories: seriesCategories,
    values,
    ...(includeRenderedValues ? { renderedValues } : {}),
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
      renderedValues: includeRenderedValues ? renderedValues : undefined,
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
  seriesReferencesByIndex?: ReadonlyMap<number, SeriesRangeReference>,
): ResolvedChartSpecSnapshot['resolved']['seriesProjection'] {
  const renderedPointCountBySourceSeriesKey: Record<string, number> = {};
  for (const item of series) {
    renderedPointCountBySourceSeriesKey[item.sourceSeriesKey] = item.renderedPointCount;
  }

  const projectedKeys = new Set(series.map((item) => item.sourceSeriesKey));
  const stockProjection = stockProjectionContext(config, series);
  const sourceSeries = snapshotSourceSeriesInventory(
    config,
    series,
    stockProjection.stockRoleBySourceKey,
    projectedKeys,
    seriesReferencesByIndex,
    stockProjection.renderedSeries,
  );
  const droppedSeries =
    config.series
      ?.map((configured, index) => {
        const sourceSeriesIndex = seriesConfigSourceIndex(configured, index);
        const sourceSeriesKey = seriesConfigSourceKey(configured, sourceSeriesIndex);
        if (projectedKeys.has(sourceSeriesKey)) return undefined;
        const stockRole = stockProjection.stockRoleBySourceKey.get(sourceSeriesKey);
        const diagnostic = configured.projectionDiagnostics?.[0];
        const projectedIntoSeries = stockProjection.renderedSeries;
        const stockProjectionReason = stockRole !== undefined && projectedIntoSeries !== undefined;
        return {
          sourceSeriesIndex,
          sourceSeriesKey,
          name: configured.name,
          reason: stockProjectionReason
            ? 'projectedIntoStockGlyph'
            : diagnostic?.reason ?? droppedSeriesReason(configured),
          message: diagnostic?.message,
          ...(stockProjectionReason
            ? {
                projectedIntoSeriesIndex: projectedIntoSeries.index,
                projectedIntoSourceSeriesKey: projectedIntoSeries.sourceSeriesKey,
                projectedIntoRole: stockRole,
              }
            : {}),
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
    sourceSeries,
    sourceSeriesCount: sourceSeries.length,
    sourceRoleSeriesCount: sourceSeries.filter((item) => item.stockRole !== undefined).length,
    projectedRoleMappings: stockProjection.projectedRoleMappings,
    stockRenderProjection: stockProjection.stockRenderProjection,
  };
}

function snapshotSourceSeriesInventory(
  config: ChartConfig,
  series: ResolvedChartSpecSnapshot['resolved']['series'],
  stockRoleBySourceKey: ReadonlyMap<string, ChartSeriesStockRole>,
  projectedKeys: ReadonlySet<string>,
  seriesReferencesByIndex: ReadonlyMap<number, SeriesRangeReference> | undefined,
  renderedStockSeries: ResolvedSeriesSnapshot | undefined,
): SourceSeriesSnapshot[] {
  if (!config.series?.length) {
    return series.map((item) => ({
      index: item.index,
      order: item.order,
      sourceSeriesIndex: item.sourceSeriesIndex,
      sourceSeriesKey: item.sourceSeriesKey,
      name: item.name,
      type: item.type,
      visibleOrder: item.visibleOrder,
      axisGroup: item.axisGroup,
      xRole: item.xRole,
      stockRole: item.stockRole,
      source: item.source,
      renderAuthority: item.renderAuthority,
      projectionDiagnostics: item.projectionDiagnostics,
    }));
  }

  return config.series.map((configured, index) => {
    const sourceSeriesIndex = seriesConfigSourceIndex(configured, index);
    const sourceSeriesKey = seriesConfigSourceKey(configured, sourceSeriesIndex);
    const rangeReference = seriesReferencesByIndex?.get(sourceSeriesIndex);
    const stockRole = configured.stockRole ?? stockRoleBySourceKey.get(sourceSeriesKey);
    const projectionDiagnostics = [...(configured.projectionDiagnostics ?? [])];
    if (
      stockRole !== undefined &&
      renderedStockSeries !== undefined &&
      !projectedKeys.has(sourceSeriesKey) &&
      !projectionDiagnostics.some((diagnostic) => diagnostic.reason === 'projectedIntoStockGlyph')
    ) {
      projectionDiagnostics.push({
        reason: 'projectedIntoStockGlyph',
        severity: 'info',
        sourceSeriesIndex,
        sourceSeriesKey,
        message: 'source stock role is represented by the rendered stock glyph series',
      });
    }

    return {
      index,
      order: configured.order ?? configured.idx ?? index,
      sourceSeriesIndex,
      sourceSeriesKey,
      name: configured.name ?? defaultSourceSeriesName(configured, sourceSeriesIndex),
      type: configured.type,
      visibleOrder: configured.visibleOrder,
      axisGroup: configured.yAxisIndex === 1 ? 'secondary' : 'primary',
      xRole: effectiveSeriesXRole(config, configured, configured.type),
      stockRole,
      source: {
        values: configured.values,
        categories: configured.categories,
        bubbleSize: configured.bubbleSize,
        stockRole,
        valueSourceKind: configured.valueSourceKind,
        categorySourceKind: configured.categorySourceKind,
        bubbleSizeSourceKind: configured.bubbleSizeSourceKind,
      },
      renderAuthority: {
        values: dimensionRenderAuthority({
          cache: configured.valueCache,
          sourceKind: configured.valueSourceKind,
          resolvedRange: rangeReference?.values,
        }),
        categories: dimensionRenderAuthority({
          cache: configured.categoryCache,
          cacheRenderable:
            hasRenderableChartPointCache(configured.categoryCache) ||
            hasRenderableCategoryLevelsCache(configured.categoryLevels),
          sourceKind: configured.categorySourceKind,
          resolvedRange: rangeReference?.categories,
        }),
        bubbleSize: dimensionRenderAuthority({
          cache: configured.bubbleSizeCache,
          sourceKind: configured.bubbleSizeSourceKind,
          resolvedRange: rangeReference?.bubbleSizes ?? null,
        }),
      },
      ...(projectionDiagnostics.length > 0 ? { projectionDiagnostics } : {}),
    };
  });
}

function stockProjectionContext(
  config: ChartConfig,
  series: ResolvedChartSpecSnapshot['resolved']['series'],
): {
  stockRoleBySourceKey: Map<string, ChartSeriesStockRole>;
  renderedSeries?: ResolvedSeriesSnapshot;
  projectedRoleMappings?: ProjectedRoleMappingSnapshot[];
  stockRenderProjection?: StockRenderProjectionSnapshot;
} {
  const stockRoleBySourceKey = new Map<string, ChartSeriesStockRole>();
  const seriesConfigs = config.series ?? [];
  const roles =
    shouldProjectStockSeries(config) && seriesConfigs.length > 0
      ? stockRolePlan(seriesConfigs)
      : null;
  if (!roles) return { stockRoleBySourceKey };
  const stockSubType = stockSubTypeFromRolePresence(roles);

  const renderedSeries = series.find(isRenderedStockSeries) ?? series[0];
  const projectedRoleMappings: ProjectedRoleMappingSnapshot[] = [];
  for (const role of stockRoleOrder()) {
    const configIndex = roles[role];
    if (configIndex === undefined) continue;
    const configured = seriesConfigs[configIndex];
    if (!configured) continue;
    const sourceSeriesIndex = seriesConfigSourceIndex(configured, configIndex);
    const sourceSeriesKey = seriesConfigSourceKey(configured, sourceSeriesIndex);
    stockRoleBySourceKey.set(sourceSeriesKey, role);
    if (renderedSeries) {
      projectedRoleMappings.push({
        sourceSeriesIndex,
        sourceSeriesKey,
        stockRole: role,
        projectedSeriesIndex: renderedSeries.index,
        projectedSourceSeriesKey: renderedSeries.sourceSeriesKey,
      });
    }
  }

  const stockRenderProjection: StockRenderProjectionSnapshot | undefined =
    renderedSeries && projectedRoleMappings.length > 0
      ? {
          projectionType: 'stockGlyph',
          renderedSeriesIndex: renderedSeries.index,
          renderedSourceSeriesKey: renderedSeries.sourceSeriesKey,
          roles: projectedRoleMappings,
          ...stockRenderedPointProjectionFromRoleValues(
            renderedSeries.stockValues ?? {},
            stockSubType,
            renderedSeries.pointCount,
          ),
          categorySourceSeriesKey: renderedSeries.sourceSeriesKey,
        }
      : undefined;

  return {
    stockRoleBySourceKey,
    renderedSeries,
    ...(projectedRoleMappings.length > 0 ? { projectedRoleMappings } : {}),
    ...(stockRenderProjection ? { stockRenderProjection } : {}),
  };
}

function isRenderedStockSeries(series: ResolvedSeriesSnapshot): boolean {
  const stockValues = series.stockValues;
  return (
    series.type === 'stock' ||
    series.stockRole !== undefined ||
    stockValues !== undefined
  );
}

function defaultSourceSeriesName(series: ChartSeriesConfig, sourceSeriesIndex: number): string {
  if (typeof series.idx === 'number' && Number.isInteger(series.idx) && series.idx >= 0) {
    return `Series ${series.idx + 1}`;
  }

  if (typeof series.order === 'number' && Number.isInteger(series.order) && series.order >= 0) {
    return `Series ${series.order + 1}`;
  }

  return `Series ${sourceSeriesIndex + 1}`;
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

function numericRenderedPointValue(
  point: ChartDataPoint | undefined,
  config: ChartConfig,
  configured: NonNullable<ChartConfig['series']>[number] | undefined,
): number | null {
  const value = renderedPointValueForRows(point, config, configured);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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

function shouldUseStockRenderedPointProjection(
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
  if (configured?.stockRole !== undefined) return false;
  return (
    config.type === 'stock' ||
    effectiveType === 'stock' ||
    Object.values(stockValues).some((values) => values.some((value) => value !== null))
  );
}

function shouldSnapshotRenderedValues(
  config: ChartConfig,
  effectiveType: string | undefined,
  configured: NonNullable<ChartConfig['series']>[number] | undefined,
): boolean {
  if (config.type === 'radar' || effectiveType === 'radar') return false;
  if (configured?.stockRole !== undefined) return false;
  return config.type !== 'stock' && effectiveType !== 'stock';
}
