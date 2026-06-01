import type { ChartConfig } from '@mog/charts';
import type {
  ChartSeriesDimensionRenderAuthority,
  ChartSeriesDimensionSourceKind,
  ResolvedChartSpecSnapshot,
} from '@mog-sdk/contracts/data/charts';

import type { ResolvedChartRangeReference } from '../chart-range-references';
import { hasRenderableChartPointCache, type ChartPointCacheLike } from '../chart-point-cache';

type SeriesCategoryLevelsCache = NonNullable<
  NonNullable<ChartConfig['series']>[number]['categoryLevels']
>;

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

export function dimensionRenderAuthority(input: {
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

export function hasRenderableCategoryLevelsCache(
  cache: SeriesCategoryLevelsCache | undefined,
): boolean {
  return categoryLevelPointCardinality(cache) > 0 && (cache?.levels.length ?? 0) > 0;
}

function categoryLevelPointCardinality(cache: SeriesCategoryLevelsCache | undefined): number {
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
