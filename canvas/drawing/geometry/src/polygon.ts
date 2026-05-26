/**
 * Polygon operations.
 *
 * Convex hull, area, centroid, winding, and convexity testing.
 */
import type { Point2D } from '@mog-sdk/contracts/geometry';

// ─── Convex Hull ─────────────────────────────────────────────────────────────

/**
 * Compute the convex hull of a set of points using Andrew's monotone chain algorithm.
 * Returns vertices in counter-clockwise order.
 *
 * Time: O(n log n). Space: O(n).
 */
export function convexHull(points: Point2D[]): Point2D[] {
  if (points.length <= 1) return [...points];
  if (points.length === 2) return [...points];

  // Sort by x, then by y
  const sorted = [...points].sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y));

  // Cross product of vectors OA and OB (O = origin point)
  function cross2(o: Point2D, a: Point2D, b: Point2D): number {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  }

  // Build lower hull
  const lower: Point2D[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross2(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  // Build upper hull
  const upper: Point2D[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross2(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  // Remove last point from each half (it's the first point of the other)
  lower.pop();
  upper.pop();

  const hull = [...lower, ...upper];

  // If all points are identical (or collinear and eliminated), the monotone chain
  // may produce an empty hull. Return a single representative point in that case.
  if (hull.length === 0 && sorted.length > 0) {
    return [sorted[0]];
  }

  return hull;
}

// ─── Area ────────────────────────────────────────────────────────────────────

/**
 * Compute the signed area of a polygon using the Shoelace formula.
 * Positive = counter-clockwise, negative = clockwise.
 */
export function polygonArea(vertices: Point2D[]): number {
  if (vertices.length < 3) return 0;

  let area = 0;
  const n = vertices.length;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += vertices[i].x * vertices[j].y;
    area -= vertices[j].x * vertices[i].y;
  }

  return area / 2;
}

// ─── Centroid ────────────────────────────────────────────────────────────────

/**
 * Compute the centroid of a polygon.
 * For a non-self-intersecting polygon, this is the "center of mass".
 */
export function polygonCentroid(vertices: Point2D[]): Point2D {
  if (vertices.length === 0) return { x: 0, y: 0 };
  if (vertices.length === 1) return { x: vertices[0].x, y: vertices[0].y };
  if (vertices.length === 2) {
    return { x: (vertices[0].x + vertices[1].x) / 2, y: (vertices[0].y + vertices[1].y) / 2 };
  }

  let cx = 0;
  let cy = 0;
  const n = vertices.length;
  let signedArea = 0;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const cross = vertices[i].x * vertices[j].y - vertices[j].x * vertices[i].y;
    signedArea += cross;
    cx += (vertices[i].x + vertices[j].x) * cross;
    cy += (vertices[i].y + vertices[j].y) * cross;
  }

  signedArea /= 2;

  if (Math.abs(signedArea) < 1e-12) {
    // Degenerate polygon - use simple average
    let avgX = 0;
    let avgY = 0;
    for (const v of vertices) {
      avgX += v.x;
      avgY += v.y;
    }
    return { x: avgX / n, y: avgY / n };
  }

  cx /= 6 * signedArea;
  cy /= 6 * signedArea;

  return { x: cx, y: cy };
}

// ─── Convexity ───────────────────────────────────────────────────────────────

/** Check if a polygon is convex. */
export function isConvex(vertices: Point2D[]): boolean {
  if (vertices.length < 3) return true;

  const n = vertices.length;
  let sign = 0;

  for (let i = 0; i < n; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % n];
    const c = vertices[(i + 2) % n];

    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);

    if (Math.abs(cross) > 1e-10) {
      if (sign === 0) {
        sign = cross > 0 ? 1 : -1;
      } else if ((cross > 0 ? 1 : -1) !== sign) {
        return false;
      }
    }
  }

  return true;
}

// ─── Winding ─────────────────────────────────────────────────────────────────

/** Check if polygon vertices are ordered clockwise (negative signed area). */
export function isClockwise(vertices: Point2D[]): boolean {
  return polygonArea(vertices) < 0;
}

// ─── Polygon Perimeter ───────────────────────────────────────────────────────

/** Compute the perimeter of a polygon. */
export function polygonPerimeter(vertices: Point2D[]): number {
  if (vertices.length < 2) return 0;

  let perimeter = 0;
  const n = vertices.length;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = vertices[j].x - vertices[i].x;
    const dy = vertices[j].y - vertices[i].y;
    perimeter += Math.sqrt(dx * dx + dy * dy);
  }

  return perimeter;
}

// ─── Point on Polygon Edge ───────────────────────────────────────────────────

/** Check if a point lies on any edge of the polygon within a tolerance. */
export function pointOnPolygonEdge(
  point: Point2D,
  polygon: Point2D[],
  tolerance: number = 1e-8,
): boolean {
  const n = polygon.length;
  if (n < 2) return false;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = polygon[i];
    const b = polygon[j];

    // Check if point is within the bounding box of the segment (with tolerance)
    const minX = Math.min(a.x, b.x) - tolerance;
    const maxX = Math.max(a.x, b.x) + tolerance;
    const minY = Math.min(a.y, b.y) - tolerance;
    const maxY = Math.max(a.y, b.y) + tolerance;

    if (point.x < minX || point.x > maxX || point.y < minY || point.y > maxY) {
      continue;
    }

    // Distance from point to segment
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;

    if (lenSq < 1e-12) {
      // Degenerate segment
      if (Math.sqrt((point.x - a.x) ** 2 + (point.y - a.y) ** 2) <= tolerance) {
        return true;
      }
      continue;
    }

    let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));

    const projX = a.x + t * dx;
    const projY = a.y + t * dy;
    const dist = Math.sqrt((point.x - projX) ** 2 + (point.y - projY) ** 2);

    if (dist <= tolerance) {
      return true;
    }
  }

  return false;
}
