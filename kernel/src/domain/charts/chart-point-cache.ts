export type ChartPointCacheLike = {
  pointCount?: unknown;
  points?: readonly { idx?: unknown; value?: unknown; formatCode?: unknown }[];
};

function explicitPointCount(cache: ChartPointCacheLike | null | undefined): number | undefined {
  const pointCount = cache?.pointCount;
  return typeof pointCount === 'number' && Number.isInteger(pointCount) && pointCount >= 0
    ? pointCount
    : undefined;
}

export function chartPointCacheCardinality(cache: ChartPointCacheLike | null | undefined): number {
  if (!cache) return 0;
  const pointCount = explicitPointCount(cache);
  if (pointCount !== undefined) return pointCount;

  return (cache.points ?? []).reduce((max, point) => {
    const idx = point.idx;
    return typeof idx === 'number' && Number.isInteger(idx) && idx >= 0
      ? Math.max(max, idx + 1)
      : max;
  }, 0);
}

export function chartPointCachePointsInsideCardinality<
  T extends { idx?: unknown; value?: unknown; formatCode?: unknown },
>(cache: { pointCount?: unknown; points?: readonly T[] } | null | undefined): T[] {
  const points: readonly T[] = cache?.points ?? [];
  const pointCount = explicitPointCount(cache);
  return points.filter((point) => {
    const idx = point.idx;
    return (
      typeof idx === 'number' &&
      Number.isInteger(idx) &&
      idx >= 0 &&
      (pointCount === undefined || idx < pointCount)
    );
  });
}

export function hasRenderableChartPointCache(
  cache: ChartPointCacheLike | null | undefined,
): boolean {
  return chartPointCacheCardinality(cache) > 0;
}
