import type { BoundingBox, Point2D } from '@mog-sdk/contracts/geometry';
import type { SpatialIndex, SpatialEntry, NarrowPhaseTest } from './types';

/**
 * Combined broad+narrow hit test with z-order priority.
 * Broad phase: spatial index queryPoint.
 * Narrow phase: optional per-object geometry test.
 * Z-order: candidates sorted descending, first narrow-phase hit wins.
 */
export function hitTestPipeline<T>(
  index: SpatialIndex<T>,
  point: Point2D,
  getZIndex: (entry: SpatialEntry<T>) => number,
  narrowPhase?: NarrowPhaseTest<T>,
): SpatialEntry<T> | null {
  const candidates = index.queryPoint(point);
  if (candidates.length === 0) return null;

  // Sort by z-index descending (topmost first)
  candidates.sort((a, b) => getZIndex(b) - getZIndex(a));

  if (!narrowPhase) {
    return candidates[0];
  }

  for (const candidate of candidates) {
    if (narrowPhase.test(candidate, point)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Rectangle selection with spatial index acceleration.
 */
export function selectInRect<T>(
  index: SpatialIndex<T>,
  rect: BoundingBox,
  mode: 'intersects' | 'contains',
): SpatialEntry<T>[] {
  const candidates = index.query(rect);

  if (mode === 'intersects') {
    return candidates; // query() already filters by intersection
  }

  // 'contains' mode: filter to only items fully inside rect
  return candidates.filter((entry) => {
    const b = entry.bounds;
    return (
      b.x >= rect.x &&
      b.y >= rect.y &&
      b.x + b.width <= rect.x + rect.width &&
      b.y + b.height <= rect.y + rect.height
    );
  });
}

/**
 * Proximity search: all items within radius, sorted by distance.
 */
export function findNearby<T>(
  index: SpatialIndex<T>,
  point: Point2D,
  radius: number,
): Array<{ entry: SpatialEntry<T>; distance: number }> {
  // Query a bounding box around the point
  const queryBounds: BoundingBox = {
    x: point.x - radius,
    y: point.y - radius,
    width: radius * 2,
    height: radius * 2,
  };

  const candidates = index.query(queryBounds);
  const results: Array<{ entry: SpatialEntry<T>; distance: number }> = [];

  for (const entry of candidates) {
    const b = entry.bounds;
    // Distance from point to nearest edge of bounding box
    const dx = Math.max(b.x - point.x, 0, point.x - (b.x + b.width));
    const dy = Math.max(b.y - point.y, 0, point.y - (b.y + b.height));
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance <= radius) {
      results.push({ entry, distance });
    }
  }

  results.sort((a, b) => a.distance - b.distance);
  return results;
}
