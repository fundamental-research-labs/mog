/**
 * Hit testing operations.
 *
 * Point-in-polygon, point-on-path, distance computations.
 */
import type { Path, Point2D } from '@mog-sdk/contracts/geometry';
import { evaluateCubic, evaluateQuadratic } from './bezier';

// ─── Point-in-Polygon ────────────────────────────────────────────────────────

/**
 * Test if a point is inside a polygon (ray casting algorithm).
 * Works for both convex and concave polygons.
 *
 * @param point The point to test.
 * @param polygon The polygon vertices (closed loop assumed).
 * @returns true if the point is inside the polygon.
 */
export function pointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
  if (polygon.length < 3) return false;

  let inside = false;
  const n = polygon.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    // Check if the ray from point going right crosses this edge
    if (yi > point.y !== yj > point.y) {
      const intersectX = ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
      if (point.x < intersectX) {
        inside = !inside;
      }
    }
  }

  return inside;
}

// ─── Distance to Line Segment ────────────────────────────────────────────────

/**
 * Distance from a point to a line segment (p1 to p2).
 */
export function distanceToSegment(point: Point2D, p1: Point2D, p2: Point2D): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq < 1e-12) {
    // Degenerate segment (point)
    return Math.sqrt((point.x - p1.x) ** 2 + (point.y - p1.y) ** 2);
  }

  // Project point onto the line, clamped to [0, 1]
  let t = ((point.x - p1.x) * dx + (point.y - p1.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = p1.x + t * dx;
  const projY = p1.y + t * dy;

  return Math.sqrt((point.x - projX) ** 2 + (point.y - projY) ** 2);
}

/**
 * Distance from a point to an infinite line defined by two points.
 */
export function distanceToLine(point: Point2D, lineStart: Point2D, lineEnd: Point2D): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq < 1e-12) {
    return Math.sqrt((point.x - lineStart.x) ** 2 + (point.y - lineStart.y) ** 2);
  }

  // Signed distance formula: |cross product| / |line direction|
  const crossProduct = Math.abs(
    (lineEnd.x - lineStart.x) * (lineStart.y - point.y) -
      (lineStart.x - point.x) * (lineEnd.y - lineStart.y),
  );
  return crossProduct / Math.sqrt(lenSq);
}

// ─── Point on Path ───────────────────────────────────────────────────────────

/**
 * Check if a point is within a given tolerance of a path.
 *
 * @param point The point to test.
 * @param path The path to test against.
 * @param tolerance Maximum distance from the path to be considered "on" it.
 */
export function pointOnPath(point: Point2D, path: Path, tolerance: number): boolean {
  return distanceToPath(point, path) <= tolerance;
}

/**
 * Compute the minimum distance from a point to a path.
 */
export function distanceToPath(point: Point2D, path: Path): number {
  if (path.segments.length === 0) return Infinity;

  let minDist = Infinity;
  let currentX = 0;
  let currentY = 0;
  let startX = 0;
  let startY = 0;

  for (const seg of path.segments) {
    switch (seg.type) {
      case 'M':
        currentX = seg.x;
        currentY = seg.y;
        startX = seg.x;
        startY = seg.y;
        break;
      case 'L': {
        const dist = distanceToSegment(point, { x: currentX, y: currentY }, { x: seg.x, y: seg.y });
        if (dist < minDist) minDist = dist;
        currentX = seg.x;
        currentY = seg.y;
        break;
      }
      case 'C': {
        // Sample the cubic Bezier curve
        const p0 = { x: currentX, y: currentY };
        const p1 = { x: seg.x1, y: seg.y1 };
        const p2 = { x: seg.x2, y: seg.y2 };
        const p3 = { x: seg.x, y: seg.y };
        const samples = 30;
        for (let i = 0; i < samples; i++) {
          const t1 = i / samples;
          const t2 = (i + 1) / samples;
          const a = evaluateCubic(t1, p0, p1, p2, p3);
          const b = evaluateCubic(t2, p0, p1, p2, p3);
          const dist = distanceToSegment(point, a, b);
          if (dist < minDist) minDist = dist;
        }
        currentX = seg.x;
        currentY = seg.y;
        break;
      }
      case 'Q': {
        const p0 = { x: currentX, y: currentY };
        const p1 = { x: seg.x1, y: seg.y1 };
        const p2 = { x: seg.x, y: seg.y };
        const samples = 20;
        for (let i = 0; i < samples; i++) {
          const t1 = i / samples;
          const t2 = (i + 1) / samples;
          const a = evaluateQuadratic(t1, p0, p1, p2);
          const b = evaluateQuadratic(t2, p0, p1, p2);
          const dist = distanceToSegment(point, a, b);
          if (dist < minDist) minDist = dist;
        }
        currentX = seg.x;
        currentY = seg.y;
        break;
      }
      case 'Z': {
        const dist = distanceToSegment(
          point,
          { x: currentX, y: currentY },
          { x: startX, y: startY },
        );
        if (dist < minDist) minDist = dist;
        currentX = startX;
        currentY = startY;
        break;
      }
    }
  }

  return minDist;
}
