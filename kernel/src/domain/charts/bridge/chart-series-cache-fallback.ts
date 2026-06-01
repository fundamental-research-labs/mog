import type { ChartConfig } from '@mog-sdk/contracts/data/charts';

import type { ResolvedChartRangeReferences } from '../chart-range-references';
import { hasRenderableChartPointCache } from '../chart-point-cache';

export function hasRenderableSeries(series: NonNullable<ChartConfig['series']>[number]): boolean {
  return Boolean(series.values?.trim()) || hasRenderablePointCache(series.valueCache);
}

export function withUnresolvedCacheFallback(
  config: ChartConfig,
  resolvedRanges: ResolvedChartRangeReferences,
): ChartConfig {
  if (!config.series?.length) return config;

  const seriesReferencesBySourceIndex = new Map(
    resolvedRanges.seriesReferences.map((reference) => [reference.index, reference]),
  );
  let changed = false;
  const series = config.series.map((item, index) => {
    const sourceSeriesIndex = sourceSeriesIndexForConfig(item, index);
    const reference =
      seriesReferencesBySourceIndex.get(sourceSeriesIndex) ??
      resolvedRanges.seriesReferences[index];
    const next = { ...item };

    next.valueSourceKind = cacheFallbackSourceKind({
      sourceKind: item.valueSourceKind,
      ref: item.values,
      cacheRenderable: hasRenderablePointCache(item.valueCache),
      resolved: Boolean(reference?.values),
    });
    next.categorySourceKind = cacheFallbackSourceKind({
      sourceKind: item.categorySourceKind,
      ref: item.categories,
      cacheRenderable:
        hasRenderablePointCache(item.categoryCache) ||
        hasRenderableCategoryLevelsCache(item.categoryLevels),
      resolved: Boolean(reference?.categories),
    });
    next.bubbleSizeSourceKind = cacheFallbackSourceKind({
      sourceKind: item.bubbleSizeSourceKind,
      ref: item.bubbleSize,
      cacheRenderable: hasRenderablePointCache(item.bubbleSizeCache),
      resolved: Boolean(reference?.bubbleSizes),
    });

    if (
      next.valueSourceKind !== item.valueSourceKind ||
      next.categorySourceKind !== item.categorySourceKind ||
      next.bubbleSizeSourceKind !== item.bubbleSizeSourceKind
    ) {
      changed = true;
      return next;
    }
    return item;
  });

  return changed ? { ...config, series } : config;
}

function cacheFallbackSourceKind(input: {
  sourceKind: NonNullable<ChartConfig['series']>[number]['valueSourceKind'];
  ref: string | undefined;
  cacheRenderable: boolean;
  resolved: boolean;
}): NonNullable<ChartConfig['series']>[number]['valueSourceKind'] {
  if (input.sourceKind === 'literal' || input.sourceKind === 'cacheFallback') {
    return input.sourceKind;
  }
  if (!input.ref?.trim() || input.resolved || !input.cacheRenderable) {
    return input.sourceKind;
  }
  return 'cacheFallback';
}

function sourceSeriesIndexForConfig(
  series: NonNullable<ChartConfig['series']>[number],
  fallbackIndex: number,
): number {
  return typeof series.sourceSeriesIndex === 'number' &&
    Number.isInteger(series.sourceSeriesIndex) &&
    series.sourceSeriesIndex >= 0
    ? series.sourceSeriesIndex
    : fallbackIndex;
}

function hasRenderableCategoryLevelsCache(
  cache: NonNullable<ChartConfig['series']>[number]['categoryLevels'],
): boolean {
  if (!cache) return false;
  if (
    typeof cache.pointCount === 'number' &&
    Number.isInteger(cache.pointCount) &&
    cache.pointCount > 0
  ) {
    return true;
  }
  return cache.levels.some((level) => {
    if (
      typeof level.pointCount === 'number' &&
      Number.isInteger(level.pointCount) &&
      level.pointCount > 0
    ) {
      return true;
    }
    return level.points.some(
      (point) => typeof point.idx === 'number' && Number.isInteger(point.idx) && point.idx >= 0,
    );
  });
}

export function hasRenderablePointCache(
  cache: NonNullable<ChartConfig['series']>[number]['valueCache'],
): boolean {
  return hasRenderableChartPointCache(cache);
}
