/**
 * Imported chart series cache helpers.
 */
import type {
  ChartCategoryLevelData,
  ChartSeriesCategoryLevelsCache,
  ChartSeriesPointCache,
  SeriesConfig,
} from '../types';
import type { ChartCellValue } from './data-extractor-primitives';
import { labelValue } from './data-extractor-primitives';

export function importedCachePointState(
  cache: ChartSeriesPointCache | undefined,
  pointIndex: number,
): { kind: 'explicit'; value: ChartCellValue } | { kind: 'omitted' } | { kind: 'absent' } {
  if (!cache) return { kind: 'absent' };

  const point = cache.points?.find((candidate) => candidate.idx === pointIndex);
  if (point !== undefined) return { kind: 'explicit', value: point.value };

  if (
    typeof cache.pointCount === 'number' &&
    Number.isInteger(cache.pointCount) &&
    pointIndex >= 0 &&
    pointIndex < cache.pointCount
  ) {
    return { kind: 'omitted' };
  }

  return { kind: 'absent' };
}

export function cachePointCardinality(cache: ChartSeriesPointCache | undefined): number {
  if (!cache) return 0;
  if (
    typeof cache.pointCount === 'number' &&
    Number.isInteger(cache.pointCount) &&
    cache.pointCount >= 0
  ) {
    return cache.pointCount;
  }
  return cache.points.reduce((max, point) => Math.max(max, point.idx + 1), 0);
}

export function categoryLevelPointCardinality(
  cache: ChartSeriesCategoryLevelsCache | undefined,
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

export function orderedCategoryLevels(cache: ChartSeriesCategoryLevelsCache | undefined) {
  return [...(cache?.levels ?? [])].sort((left, right) => left.level - right.level);
}

export function categoryLevelValueAt(
  cache: ChartSeriesCategoryLevelsCache | undefined,
  levelIndex: number,
  pointIndex: number,
): string | undefined {
  const levels = orderedCategoryLevels(cache);
  const level = levels.find((candidate) => candidate.level === levelIndex) ?? levels[levelIndex];
  const value = level?.points.find((point) => point.idx === pointIndex)?.value;
  return value === undefined || value === '' ? undefined : value;
}

export function selectedCategoryLabelLevel(level: number | undefined): number | undefined {
  return typeof level === 'number' && Number.isInteger(level) && level >= 0 ? level : undefined;
}

export function multiLevelCategoryLabelAt(
  cache: ChartSeriesCategoryLevelsCache | undefined,
  pointIndex: number,
  selectedLevel: number | undefined,
  fallback: string | number,
): string | number {
  if (selectedLevel !== undefined) {
    return categoryLevelValueAt(cache, selectedLevel, pointIndex) ?? fallback;
  }

  const labels = orderedCategoryLevels(cache)
    .map((level) => level.points.find((point) => point.idx === pointIndex)?.value)
    .filter((value): value is string => value !== undefined && value.trim() !== '');
  return labels.length > 0 ? labels.join(' / ') : fallback;
}

export function categoryLevelsFromCache(
  cache: ChartSeriesCategoryLevelsCache | undefined,
): ChartCategoryLevelData[] | undefined {
  const pointCount = categoryLevelPointCardinality(cache);
  const levels = orderedCategoryLevels(cache);
  if (pointCount === 0 || levels.length === 0) return undefined;

  return levels.map((level) => ({
    level: level.level,
    labels: Array.from({ length: pointCount }, (_, pointIndex) => {
      const value = level.points.find((point) => point.idx === pointIndex)?.value;
      return value === undefined || value === '' ? null : value;
    }),
  }));
}

export function hasRenderableCategoryLevels(
  cache: ChartSeriesCategoryLevelsCache | undefined,
): boolean {
  return categoryLevelPointCardinality(cache) > 0 && orderedCategoryLevels(cache).length > 0;
}

export function cacheValueAt(
  cache: ChartSeriesPointCache | undefined,
  pointIndex: number,
): ChartCellValue {
  const cached = importedCachePointState(cache, pointIndex);
  return cached.kind === 'explicit' ? cached.value : undefined;
}

export function cacheLabelAt(
  cache: ChartSeriesPointCache | undefined,
  pointIndex: number,
  fallback: string | number,
): string | number {
  const value = cacheValueAt(cache, pointIndex);
  const label = labelValue(value, fallback);
  if (typeof label === 'string' && label.trim() !== '') {
    const numeric = Number(label);
    if (Number.isFinite(numeric)) return numeric;
  }
  return label;
}

export function hasRenderableCachedDimension(cache: ChartSeriesPointCache | undefined): boolean {
  return cachePointCardinality(cache) > 0;
}

export function pointFormatCodeAt(
  cache: ChartSeriesPointCache | undefined,
  pointIndex: number,
): string | undefined {
  return cache?.points.find((point) => point.idx === pointIndex)?.formatCode ?? cache?.formatCode;
}

export function categoryFormatCodeAt(
  seriesConfig: SeriesConfig,
  pointIndex: number,
): string | undefined {
  return (
    seriesConfig.categoryLabelFormat?.points?.find((point) => point.idx === pointIndex)
      ?.formatCode ??
    seriesConfig.categoryLabelFormat?.formatCode ??
    pointFormatCodeAt(seriesConfig.categoryCache, pointIndex)
  );
}
