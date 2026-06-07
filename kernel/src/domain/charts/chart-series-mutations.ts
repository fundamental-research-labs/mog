/**
 * Helpers for mutating chart series collections.
 */

import type { PointFormat, SeriesConfig } from '@mog-sdk/contracts/data/charts';

/**
 * Ensure a series has a points array of at least the required length.
 */
export function ensurePointsArray(series: SeriesConfig, minLength: number): PointFormat[] {
  const points = [...(series.points ?? [])];
  while (points.length <= minLength) {
    points.push({ idx: points.length });
  }
  // Ensure every point has idx matching its position
  for (let i = 0; i < points.length; i++) {
    points[i].idx = i;
  }
  return points;
}
