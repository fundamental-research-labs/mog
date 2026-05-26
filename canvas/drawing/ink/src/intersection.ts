/**
 * Intersection tests for strokes.
 *
 * Stroke-stroke, stroke-rect, stroke-line, and point-near-stroke tests.
 * Pure computation: no DOM, no Canvas, no React.
 */
import type { BoundingBox, Point2D } from '@mog-sdk/contracts/geometry';
import type { Stroke } from './types';

// =============================================================================
// Constants
// =============================================================================

/** Relative epsilon factor for parallelism check in segment intersection. */
const PARALLEL_RELATIVE_EPSILON = 1e-10;

/** Absolute epsilon for degenerate (zero-length) segment detection. */
const DEGENERATE_SEGMENT_EPSILON = 1e-12;

// =============================================================================
// Helpers
// =============================================================================

/**
 * Squared distance from a point to a line segment.
 */
export function pointToSegmentDistSq(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;

  if (lenSq < DEGENERATE_SEGMENT_EPSILON) {
    const ex = px - x1;
    const ey = py - y1;
    return ex * ex + ey * ey;
  }

  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const closestX = x1 + t * dx;
  const closestY = y1 + t * dy;
  const ex = px - closestX;
  const ey = py - closestY;
  return ex * ex + ey * ey;
}

/**
 * Check if two line segments intersect.
 * Returns the intersection point or null.
 *
 * Handles collinear overlapping segments by returning the overlap
 * boundary point nearest to the start of segment A.
 * Uses relative epsilon for parallelism check (scales with segment lengths).
 */
export function segmentsIntersect(
  ax1: number,
  ay1: number,
  ax2: number,
  ay2: number,
  bx1: number,
  by1: number,
  bx2: number,
  by2: number,
): Point2D | null {
  const dax = ax2 - ax1;
  const day = ay2 - ay1;
  const dbx = bx2 - bx1;
  const dby = by2 - by1;

  const denom = dax * dby - day * dbx;

  // Compute segment lengths for relative epsilon
  const lenA = Math.sqrt(dax * dax + day * day);
  const lenB = Math.sqrt(dbx * dbx + dby * dby);
  const threshold = PARALLEL_RELATIVE_EPSILON * lenA * lenB;

  if (Math.abs(denom) < Math.max(threshold, DEGENERATE_SEGMENT_EPSILON)) {
    // Parallel or collinear — check for overlap
    // Check if segments are collinear (not just parallel)
    const crossOrigin = (bx1 - ax1) * day - (by1 - ay1) * dax;
    if (
      Math.abs(crossOrigin) >
      Math.max(PARALLEL_RELATIVE_EPSILON * lenA * lenA, DEGENERATE_SEGMENT_EPSILON)
    ) {
      // Truly parallel but not collinear — no intersection
      return null;
    }

    // Collinear: project onto the dominant axis and check overlap
    // Use whichever axis has the larger range to avoid numerical issues
    const useX = Math.abs(dax) >= Math.abs(day);

    let aMin: number, aMax: number, bMin: number, bMax: number;
    if (useX) {
      aMin = Math.min(ax1, ax2);
      aMax = Math.max(ax1, ax2);
      bMin = Math.min(bx1, bx2);
      bMax = Math.max(bx1, bx2);
    } else {
      aMin = Math.min(ay1, ay2);
      aMax = Math.max(ay1, ay2);
      bMin = Math.min(by1, by2);
      bMax = Math.max(by1, by2);
    }

    // Check if ranges overlap
    const overlapStart = Math.max(aMin, bMin);
    const overlapEnd = Math.min(aMax, bMax);

    if (overlapStart > overlapEnd) {
      return null; // No overlap
    }

    // Return the overlap boundary nearest to the start of segment A
    if (useX) {
      // Find the t parameter on segment A for overlapStart
      const t =
        lenA > DEGENERATE_SEGMENT_EPSILON
          ? (overlapStart - Math.min(ax1, ax2)) / (Math.max(ax1, ax2) - Math.min(ax1, ax2))
          : 0;
      // Map t back to the actual segment A direction
      const tA = ax1 <= ax2 ? t : 1 - t;
      return {
        x: ax1 + tA * dax,
        y: ay1 + tA * day,
      };
    } else {
      const t =
        lenA > DEGENERATE_SEGMENT_EPSILON
          ? (overlapStart - Math.min(ay1, ay2)) / (Math.max(ay1, ay2) - Math.min(ay1, ay2))
          : 0;
      const tA = ay1 <= ay2 ? t : 1 - t;
      return {
        x: ax1 + tA * dax,
        y: ay1 + tA * day,
      };
    }
  }

  const t = ((bx1 - ax1) * dby - (by1 - ay1) * dbx) / denom;
  const u = ((bx1 - ax1) * day - (by1 - ay1) * dax) / denom;

  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return {
      x: ax1 + t * dax,
      y: ay1 + t * day,
    };
  }

  return null;
}

/**
 * Check if a bounding box overlaps another (geometry BoundingBox format).
 * Shared utility used by intersection.ts, spatial-index.ts, and eraser.ts.
 */
export function boxesOverlap(a: BoundingBox, b: BoundingBox): boolean {
  return (
    a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y
  );
}

/**
 * Check if a line segment intersects an axis-aligned bounding box.
 * Uses Cohen-Sutherland-style outcode clipping.
 */
function segmentIntersectsBox(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  box: BoundingBox,
): boolean {
  const left = box.x;
  const right = box.x + box.width;
  const top = box.y;
  const bottom = box.y + box.height;

  // Outcode computation
  function outcode(x: number, y: number): number {
    let code = 0;
    if (x < left) code |= 1;
    else if (x > right) code |= 2;
    if (y < top) code |= 4;
    else if (y > bottom) code |= 8;
    return code;
  }

  let oc1 = outcode(x1, y1);
  let oc2 = outcode(x2, y2);

  let sx1 = x1,
    sy1 = y1,
    sx2 = x2,
    sy2 = y2;

  for (let iter = 0; iter < 20; iter++) {
    if ((oc1 | oc2) === 0) return true; // Both inside
    if ((oc1 & oc2) !== 0) return false; // Both outside same side

    const ocOut = oc1 !== 0 ? oc1 : oc2;
    let x = 0,
      y = 0;

    if (ocOut & 8) {
      x = sx1 + ((sx2 - sx1) * (bottom - sy1)) / (sy2 - sy1);
      y = bottom;
    } else if (ocOut & 4) {
      x = sx1 + ((sx2 - sx1) * (top - sy1)) / (sy2 - sy1);
      y = top;
    } else if (ocOut & 2) {
      y = sy1 + ((sy2 - sy1) * (right - sx1)) / (sx2 - sx1);
      x = right;
    } else if (ocOut & 1) {
      y = sy1 + ((sy2 - sy1) * (left - sx1)) / (sx2 - sx1);
      x = left;
    }

    if (ocOut === oc1) {
      sx1 = x;
      sy1 = y;
      oc1 = outcode(sx1, sy1);
    } else {
      sx2 = x;
      sy2 = y;
      oc2 = outcode(sx2, sy2);
    }
  }

  return false;
}

// =============================================================================
// Segment-Rect Clipping
// =============================================================================

/**
 * Clip a line segment against an AABB. Returns the entry and exit t-parameters
 * on the segment [0, 1] where it intersects the rect boundaries.
 * Returns null if the segment does not intersect the rect.
 */
export function clipSegmentToRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rect: BoundingBox,
): { tEnter: number; tExit: number } | null {
  const dx = x2 - x1;
  const dy = y2 - y1;

  let tMin = 0;
  let tMax = 1;

  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;

  // Check x-slab
  if (Math.abs(dx) < 1e-15) {
    // Parallel to y-axis
    if (x1 < left || x1 > right) return null;
  } else {
    let t0 = (left - x1) / dx;
    let t1 = (right - x1) / dx;
    if (t0 > t1) {
      const tmp = t0;
      t0 = t1;
      t1 = tmp;
    }
    tMin = Math.max(tMin, t0);
    tMax = Math.min(tMax, t1);
    if (tMin > tMax) return null;
  }

  // Check y-slab
  if (Math.abs(dy) < 1e-15) {
    if (y1 < top || y1 > bottom) return null;
  } else {
    let t0 = (top - y1) / dy;
    let t1 = (bottom - y1) / dy;
    if (t0 > t1) {
      const tmp = t0;
      t0 = t1;
      t1 = tmp;
    }
    tMin = Math.max(tMin, t0);
    tMax = Math.min(tMax, t1);
    if (tMin > tMax) return null;
  }

  return { tEnter: tMin, tExit: tMax };
}

// =============================================================================
// Segment-Circle Intersection
// =============================================================================

/**
 * Find the t-parameters where a line segment intersects a circle.
 * Returns 0, 1, or 2 t-values in [0, 1].
 */
export function segmentCircleIntersection(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  cx: number,
  cy: number,
  radius: number,
): number[] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const fx = x1 - cx;
  const fy = y1 - cy;

  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - radius * radius;

  if (a < 1e-15) {
    // Degenerate segment (point)
    return c <= 0 ? [0] : [];
  }

  let discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return [];

  const results: number[] = [];
  if (discriminant < 1e-12) {
    // Single tangent point
    const t = -b / (2 * a);
    if (t >= 0 && t <= 1) results.push(t);
  } else {
    discriminant = Math.sqrt(discriminant);
    const t1 = (-b - discriminant) / (2 * a);
    const t2 = (-b + discriminant) / (2 * a);
    if (t1 >= 0 && t1 <= 1) results.push(t1);
    if (t2 >= 0 && t2 <= 1) results.push(t2);
  }

  return results;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Check if two strokes intersect.
 *
 * Tests every segment pair between the two strokes.
 * Performs a bounding box precheck for efficiency.
 */
export function strokesIntersect(a: Stroke, b: Stroke): boolean {
  // Quick bounding box rejection
  if (!boxesOverlap(a.bounds, b.bounds)) return false;

  if (a.points.length < 2 || b.points.length < 2) return false;

  for (let i = 0; i < a.points.length - 1; i++) {
    const ap1 = a.points[i];
    const ap2 = a.points[i + 1];

    for (let j = 0; j < b.points.length - 1; j++) {
      const bp1 = b.points[j];
      const bp2 = b.points[j + 1];

      if (segmentsIntersect(ap1.x, ap1.y, ap2.x, ap2.y, bp1.x, bp1.y, bp2.x, bp2.y)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if a stroke intersects an axis-aligned rectangle.
 *
 * Returns true if any segment of the stroke crosses or is inside the rect.
 */
export function strokeIntersectsRect(stroke: Stroke, rect: BoundingBox): boolean {
  if (!boxesOverlap(stroke.bounds, rect)) return false;

  const { points } = stroke;
  if (points.length === 0) return false;

  // Check if any point is inside the rect
  for (const p of points) {
    if (
      p.x >= rect.x &&
      p.x <= rect.x + rect.width &&
      p.y >= rect.y &&
      p.y <= rect.y + rect.height
    ) {
      return true;
    }
  }

  // Check if any segment intersects the rect edges
  for (let i = 0; i < points.length - 1; i++) {
    if (segmentIntersectsBox(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y, rect)) {
      return true;
    }
  }

  return false;
}

/**
 * Find intersection points between a stroke and a line segment.
 *
 * @returns Array of intersection points.
 */
export function strokeLineIntersections(stroke: Stroke, p1: Point2D, p2: Point2D): Point2D[] {
  const results: Point2D[] = [];
  const { points } = stroke;

  if (points.length < 2) return results;

  for (let i = 0; i < points.length - 1; i++) {
    const sp1 = points[i];
    const sp2 = points[i + 1];
    const hit = segmentsIntersect(sp1.x, sp1.y, sp2.x, sp2.y, p1.x, p1.y, p2.x, p2.y);
    if (hit) {
      results.push(hit);
    }
  }

  return results;
}

/**
 * Check if a point is near a stroke (within tolerance distance).
 *
 * Tolerance is measured from the stroke center line (not including stroke width).
 */
export function pointNearStroke(point: Point2D, stroke: Stroke, tolerance: number): boolean {
  const { points } = stroke;
  if (points.length === 0) return false;

  const tolSq = tolerance * tolerance;

  if (points.length === 1) {
    const dx = point.x - points[0].x;
    const dy = point.y - points[0].y;
    return dx * dx + dy * dy <= tolSq;
  }

  for (let i = 0; i < points.length - 1; i++) {
    const distSq = pointToSegmentDistSq(
      point.x,
      point.y,
      points[i].x,
      points[i].y,
      points[i + 1].x,
      points[i + 1].y,
    );
    if (distSq <= tolSq) return true;
  }

  return false;
}
