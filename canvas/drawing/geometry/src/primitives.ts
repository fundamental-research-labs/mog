/**
 * Geometry Primitives
 *
 * Pure math functions for common hit testing and spatial queries.
 * Consolidates duplicate implementations from charts/pick, spatial-query, ink, etc.
 *
 * All functions are pure — no Canvas2D, no DOM, no side effects.
 */
import type { BoundingBox, Point2D } from '@mog-sdk/contracts/geometry';

// ─── Point-in-Shape ─────────────────────────────────────────────────────────

/**
 * Point-in-axis-aligned-bounding-box test.
 * Consolidates 8+ duplicate implementations across the codebase.
 */
export function pointInRect(point: Point2D, rect: BoundingBox): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

/**
 * Point-in-circle test.
 * Consolidates from charts/pick pointInSymbol (circle case).
 */
export function pointInCircle(point: Point2D, center: Point2D, radius: number): boolean {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * Point-in-arc (pie/donut slice) test.
 * Consolidates from charts/pick pointInArc.
 *
 * Angle convention: 0 at 12 o'clock (top), increasing clockwise.
 * This matches the charts convention where atan2 is offset by +PI/2.
 * Angles are in radians.
 */
export function pointInArc(
  point: Point2D,
  center: Point2D,
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number,
): boolean {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const distSq = dx * dx + dy * dy;

  // Radial check
  if (distSq < innerRadius * innerRadius || distSq > outerRadius * outerRadius) {
    return false;
  }

  // Full circle: if the arc spans 2π or more, skip angular check
  const TWO_PI = Math.PI * 2;
  if (Math.abs(endAngle - startAngle) >= TWO_PI) {
    return true;
  }

  // Angular check — atan2 gives angle from positive x-axis (3 o'clock),
  // add PI/2 to convert to 0-at-top clockwise convention.
  let angle = Math.atan2(dy, dx) + Math.PI / 2;

  // Normalize angle to [0, 2π)
  angle = ((angle % TWO_PI) + TWO_PI) % TWO_PI;

  // Normalize start and end to [0, 2π)
  const start = ((startAngle % TWO_PI) + TWO_PI) % TWO_PI;
  const end = ((endAngle % TWO_PI) + TWO_PI) % TWO_PI;

  if (start <= end) {
    return angle >= start && angle <= end;
  } else {
    // Arc wraps around 0
    return angle >= start || angle <= end;
  }
}

/**
 * Point-in-diamond test.
 * Consolidates from charts/pick pointInSymbol (diamond case).
 *
 * Uses the Manhattan distance: |dx|/halfSize + |dy|/halfSize <= 1
 */
export function pointInDiamond(point: Point2D, center: Point2D, size: number): boolean {
  const halfSize = size / 2;
  if (halfSize <= 0) return false;
  const dx = Math.abs(point.x - center.x);
  const dy = Math.abs(point.y - center.y);
  return dx / halfSize + dy / halfSize <= 1;
}

// ─── Rect-to-Rect ───────────────────────────────────────────────────────────

/**
 * Test if outer rect fully contains inner rect.
 * Consolidates from spatial-query boxContains.
 */
export function rectContains(outer: BoundingBox, inner: BoundingBox): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/**
 * Test if two rects intersect (share any area, including edges).
 * Consolidates from spatial-query boxIntersects, ink boxesOverlap.
 */
export function rectIntersects(a: BoundingBox, b: BoundingBox): boolean {
  return (
    a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y
  );
}

// ─── Distance Functions ─────────────────────────────────────────────────────

/**
 * Distance from point to nearest edge of a rect. Returns 0 if point is inside.
 * Consolidates from spatial-query distanceToBounds.
 */
export function distanceToRect(point: Point2D, rect: BoundingBox): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Distance from point to nearest edge of a circle. Negative if inside.
 */
export function distanceToCircle(point: Point2D, center: Point2D, radius: number): number {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return Math.sqrt(dx * dx + dy * dy) - radius;
}
