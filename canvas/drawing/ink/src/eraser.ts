/**
 * Eraser operations for strokes.
 *
 * Supports three eraser modes:
 * - eraseFromStroke: Split a stroke at eraser rect boundaries with segment clipping.
 * - pointErase: Remove points within a radius with segment clipping at circle boundaries.
 * - strokeErase: Remove entire strokes that touch an eraser rect.
 *
 * Pure computation: no DOM, no Canvas, no React.
 */
import type { BoundingBox, Point2D } from '@mog-sdk/contracts/geometry';
import type { StrokeId } from '@mog-sdk/contracts/ink';
import {
  boxesOverlap,
  clipSegmentToRect,
  segmentCircleIntersection,
  strokeIntersectsRect,
} from './intersection';
import { createStroke } from './stroke';
import type { Stroke, StrokePoint } from './types';

// =============================================================================
// Helpers
// =============================================================================

/**
 * Check if a point is inside a bounding box (geometry format).
 */
function pointInBox(px: number, py: number, box: BoundingBox): boolean {
  return px >= box.x && px <= box.x + box.width && py >= box.y && py <= box.y + box.height;
}

/**
 * Check if a point is inside a circle.
 */
function pointInCircle(px: number, py: number, cx: number, cy: number, radiusSq: number): boolean {
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= radiusSq;
}

/**
 * Interpolate between two stroke points at parameter t in [0, 1].
 */
function interpolatePoint(a: StrokePoint, b: StrokePoint, t: number): StrokePoint {
  return {
    x: a.x + t * (b.x - a.x),
    y: a.y + t * (b.y - a.y),
    pressure: a.pressure + t * (b.pressure - a.pressure),
    timestamp: a.timestamp + t * (b.timestamp - a.timestamp),
  };
}

/**
 * Build a new stroke from a subset of points, preserving properties from the original.
 * Assigns a new unique ID based on the parent stroke ID and an index.
 */
function buildSubStroke(points: StrokePoint[], original: Stroke, subIndex: number): Stroke {
  return createStroke(points, {
    color: original.color,
    width: original.width,
    opacity: original.opacity,
    id: `${original.id}-sub${subIndex}` as StrokeId,
  });
}

// =============================================================================
// Erase from Stroke (split at eraser rect boundaries with segment clipping)
// =============================================================================

/**
 * Erase part of a stroke by splitting it at the eraser rectangle boundaries.
 *
 * Tests each stroke SEGMENT (not just points) for intersection with the eraser
 * rectangle. Interpolates split points at rectangle boundaries for clean cuts.
 *
 * @param stroke The stroke to erase from.
 * @param eraserRect The eraser rectangle.
 * @returns Array of remaining sub-strokes (may be 0, 1, or more).
 */
export function eraseFromStroke(stroke: Stroke, eraserRect: BoundingBox): Stroke[] {
  // Quick check: if bounds don't overlap, stroke is untouched
  if (!boxesOverlap(stroke.bounds, eraserRect)) {
    return [stroke];
  }

  const { points } = stroke;
  if (points.length === 0) return [];

  // For single-point strokes, check if the point is inside the eraser
  if (points.length === 1) {
    if (pointInBox(points[0].x, points[0].y, eraserRect)) {
      return [];
    }
    return [stroke];
  }

  // Build runs of surviving points, inserting interpolated points at rect boundaries
  const runs: StrokePoint[][] = [];
  let currentRun: StrokePoint[] = [];

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const pInside = pointInBox(p.x, p.y, eraserRect);

    if (i > 0) {
      const prev = points[i - 1];
      const prevInside = pointInBox(prev.x, prev.y, eraserRect);

      if (!prevInside && pInside) {
        // Segment crosses from outside to inside — clip at entry
        const clip = clipSegmentToRect(prev.x, prev.y, p.x, p.y, eraserRect);
        if (clip && clip.tEnter > 0) {
          currentRun.push(interpolatePoint(prev, p, clip.tEnter));
        }
        // End the current run
        if (currentRun.length > 0) {
          runs.push(currentRun);
          currentRun = [];
        }
      } else if (prevInside && !pInside) {
        // Segment crosses from inside to outside — clip at exit
        const clip = clipSegmentToRect(prev.x, prev.y, p.x, p.y, eraserRect);
        if (clip && clip.tExit < 1) {
          currentRun.push(interpolatePoint(prev, p, clip.tExit));
        }
      } else if (!prevInside && !pInside) {
        // Both outside — check if the segment passes through the rect
        const clip = clipSegmentToRect(prev.x, prev.y, p.x, p.y, eraserRect);
        if (clip && clip.tEnter < clip.tExit) {
          // Segment passes through: end run at entry, start new run at exit
          currentRun.push(interpolatePoint(prev, p, clip.tEnter));
          if (currentRun.length > 0) {
            runs.push(currentRun);
            currentRun = [];
          }
          currentRun.push(interpolatePoint(prev, p, clip.tExit));
        }
      }
      // If both inside, skip — we're in erased territory
    }

    if (!pInside) {
      currentRun.push({ ...p });
    }
  }

  // Don't forget the last run
  if (currentRun.length > 0) {
    runs.push(currentRun);
  }

  // Filter out single-point runs and build sub-strokes
  return runs.filter((run) => run.length >= 2).map((run, i) => buildSubStroke(run, stroke, i));
}

// =============================================================================
// Point Erase (remove points within radius, with segment clipping)
// =============================================================================

/**
 * Remove points from a stroke that fall within a given radius of a center point.
 *
 * Tests each segment against the eraser circle and interpolates at circle
 * boundaries for clean cuts.
 *
 * @param stroke The stroke to erase from.
 * @param center The center of the eraser circle.
 * @param radius The eraser radius.
 * @returns Array of remaining sub-strokes.
 */
export function pointErase(stroke: Stroke, center: Point2D, radius: number): Stroke[] {
  // Radius validation: <= 0 is a no-op
  if (radius <= 0) {
    return [stroke];
  }

  const { points } = stroke;
  if (points.length === 0) return [];

  const radiusSq = radius * radius;

  // Quick bounding box check
  const eraserBounds: BoundingBox = {
    x: center.x - radius,
    y: center.y - radius,
    width: radius * 2,
    height: radius * 2,
  };

  if (!boxesOverlap(stroke.bounds, eraserBounds)) {
    return [stroke];
  }

  // For single-point strokes, check if the point is inside the circle
  if (points.length === 1) {
    if (pointInCircle(points[0].x, points[0].y, center.x, center.y, radiusSq)) {
      return [];
    }
    return [stroke];
  }

  // Build runs of surviving points, inserting interpolated points at circle boundaries
  const runs: StrokePoint[][] = [];
  let currentRun: StrokePoint[] = [];

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const pInside = pointInCircle(p.x, p.y, center.x, center.y, radiusSq);

    if (i > 0) {
      const prev = points[i - 1];
      const prevInside = pointInCircle(prev.x, prev.y, center.x, center.y, radiusSq);

      const tValues = segmentCircleIntersection(
        prev.x,
        prev.y,
        p.x,
        p.y,
        center.x,
        center.y,
        radius,
      );
      tValues.sort((a, b) => a - b);

      if (!prevInside && pInside) {
        // Outside to inside — clip at first intersection
        if (tValues.length > 0) {
          currentRun.push(interpolatePoint(prev, p, tValues[0]));
        }
        if (currentRun.length > 0) {
          runs.push(currentRun);
          currentRun = [];
        }
      } else if (prevInside && !pInside) {
        // Inside to outside — start new run at last intersection
        if (tValues.length > 0) {
          currentRun.push(interpolatePoint(prev, p, tValues[tValues.length - 1]));
        }
      } else if (!prevInside && !pInside && tValues.length >= 2) {
        // Both outside but segment passes through circle
        currentRun.push(interpolatePoint(prev, p, tValues[0]));
        if (currentRun.length > 0) {
          runs.push(currentRun);
          currentRun = [];
        }
        currentRun.push(interpolatePoint(prev, p, tValues[tValues.length - 1]));
      }
      // If both inside and no crossings, skip
    }

    if (!pInside) {
      currentRun.push({ ...p });
    }
  }

  if (currentRun.length > 0) {
    runs.push(currentRun);
  }

  return runs.filter((run) => run.length >= 2).map((run, i) => buildSubStroke(run, stroke, i));
}

// =============================================================================
// Stroke Erase (remove entire strokes)
// =============================================================================

/**
 * Remove entire strokes that intersect the eraser rectangle.
 * Checks both point containment and segment-rect intersection.
 *
 * @param strokes Array of strokes to test.
 * @param eraserRect The eraser rectangle.
 * @returns Object with remaining strokes and IDs of removed strokes.
 */
export function strokeErase(
  strokes: readonly Stroke[],
  eraserRect: BoundingBox,
): { remaining: Stroke[]; removed: StrokeId[] } {
  const remaining: Stroke[] = [];
  const removed: StrokeId[] = [];

  for (const stroke of strokes) {
    if (strokeIntersectsRect(stroke, eraserRect)) {
      removed.push(stroke.id);
    } else {
      remaining.push(stroke);
    }
  }

  return { remaining, removed };
}
