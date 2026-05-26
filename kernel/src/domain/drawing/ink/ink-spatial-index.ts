/**
 * Spatial Index Types and Utilities for Ink Engine
 *
 * Types and utilities for spatial indexing and hit testing of ink strokes.
 *
 * @see contracts/src/ink/types.ts for InkStroke and InkPoint
 */

import type { InkPoint, InkStroke, StrokeId } from '@mog-sdk/contracts/ink';

// =============================================================================
// Bounding Box Types
// =============================================================================

/**
 * Axis-aligned bounding box (AABB).
 *
 * Represents the smallest rectangle containing a shape.
 * Used for fast spatial queries (O(1) intersection tests).
 */
export interface InkBoundingBox {
  /** Minimum X coordinate (left edge) */
  minX: number;
  /** Minimum Y coordinate (top edge) */
  minY: number;
  /** Maximum X coordinate (right edge) */
  maxX: number;
  /** Maximum Y coordinate (bottom edge) */
  maxY: number;
}

/**
 * An empty bounding box (for initialization).
 * Has inverted min/max so that any point expands it.
 */
export const EMPTY_BOUNDING_BOX: InkBoundingBox = {
  minX: Infinity,
  minY: Infinity,
  maxX: -Infinity,
  maxY: -Infinity,
} as const;

// =============================================================================
// Spatial Index Interface
// =============================================================================

/**
 * Spatial index for efficient stroke queries.
 */
export interface ISpatialIndex {
  insert(strokeId: StrokeId, bounds: InkBoundingBox): void;
  remove(strokeId: StrokeId): void;
  update(strokeId: StrokeId, newBounds: InkBoundingBox): void;
  query(bounds: InkBoundingBox): StrokeId[];
  queryPoint(x: number, y: number): StrokeId[];
  queryNearest(
    x: number,
    y: number,
    maxDistance?: number,
  ): { strokeId: StrokeId; distance: number } | null;
  clear(): void;
  size(): number;
  bulkInsert(entries: Array<[StrokeId, InkBoundingBox]>): void;
}

// =============================================================================
// Bounding Box Utility Functions
// =============================================================================

/**
 * Compute the bounding box of a stroke.
 */
export function computeStrokeBounds(stroke: InkStroke): InkBoundingBox {
  if (stroke.points.length === 0) {
    return { ...EMPTY_BOUNDING_BOX };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const point of stroke.points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }

  const halfWidth = stroke.width / 2;
  return {
    minX: minX - halfWidth,
    minY: minY - halfWidth,
    maxX: maxX + halfWidth,
    maxY: maxY + halfWidth,
  };
}

/**
 * Compute the bounding box of multiple points.
 */
export function computePointsBounds(points: InkPoint[]): InkBoundingBox {
  if (points.length === 0) {
    return { ...EMPTY_BOUNDING_BOX };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }

  return { minX, minY, maxX, maxY };
}

/**
 * Check if a point is inside a bounding box.
 */
export function pointIntersectsBounds(x: number, y: number, bounds: InkBoundingBox): boolean {
  return x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
}

/**
 * Check if two bounding boxes intersect.
 */
export function boundsIntersect(a: InkBoundingBox, b: InkBoundingBox): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/**
 * Check if bounding box 'a' contains bounding box 'b'.
 */
export function boundsContains(a: InkBoundingBox, b: InkBoundingBox): boolean {
  return a.minX <= b.minX && a.maxX >= b.maxX && a.minY <= b.minY && a.maxY >= b.maxY;
}

/**
 * Compute the union (smallest enclosing box) of two bounding boxes.
 */
export function unionBounds(a: InkBoundingBox, b: InkBoundingBox): InkBoundingBox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/**
 * Compute the intersection of two bounding boxes.
 */
export function intersectBounds(a: InkBoundingBox, b: InkBoundingBox): InkBoundingBox | null {
  const minX = Math.max(a.minX, b.minX);
  const minY = Math.max(a.minY, b.minY);
  const maxX = Math.min(a.maxX, b.maxX);
  const maxY = Math.min(a.maxY, b.maxY);

  if (minX > maxX || minY > maxY) {
    return null;
  }

  return { minX, minY, maxX, maxY };
}

/**
 * Expand a bounding box by a margin.
 */
export function expandBounds(bounds: InkBoundingBox, margin: number): InkBoundingBox {
  return {
    minX: bounds.minX - margin,
    minY: bounds.minY - margin,
    maxX: bounds.maxX + margin,
    maxY: bounds.maxY + margin,
  };
}

/**
 * Get the width of a bounding box.
 */
export function getBoundsWidth(bounds: InkBoundingBox): number {
  return bounds.maxX - bounds.minX;
}

/**
 * Get the height of a bounding box.
 */
export function getBoundsHeight(bounds: InkBoundingBox): number {
  return bounds.maxY - bounds.minY;
}

/**
 * Get the center point of a bounding box.
 */
export function getBoundsCenter(bounds: InkBoundingBox): { x: number; y: number } {
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
}

/**
 * Get the area of a bounding box.
 */
export function getBoundsArea(bounds: InkBoundingBox): number {
  return getBoundsWidth(bounds) * getBoundsHeight(bounds);
}

/**
 * Check if a bounding box is valid (not empty/inverted).
 */
export function isValidBounds(bounds: InkBoundingBox): boolean {
  return (
    isFinite(bounds.minX) &&
    isFinite(bounds.minY) &&
    isFinite(bounds.maxX) &&
    isFinite(bounds.maxY) &&
    bounds.minX <= bounds.maxX &&
    bounds.minY <= bounds.maxY
  );
}

// =============================================================================
// Distance Calculations
// =============================================================================

/**
 * Calculate the squared distance from a point to a line segment.
 */
export function pointToSegmentDistanceSquared(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    const dpx = px - x1;
    const dpy = py - y1;
    return dpx * dpx + dpy * dpy;
  }

  let t = ((px - x1) * dx + (py - y1) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));

  const closestX = x1 + t * dx;
  const closestY = y1 + t * dy;

  const distX = px - closestX;
  const distY = py - closestY;

  return distX * distX + distY * distY;
}

/**
 * Calculate the minimum distance from a point to a stroke.
 */
export function pointToStrokeDistance(px: number, py: number, stroke: InkStroke): number {
  if (stroke.points.length === 0) {
    return Infinity;
  }

  if (stroke.points.length === 1) {
    const p = stroke.points[0];
    return Math.sqrt((px - p.x) ** 2 + (py - p.y) ** 2);
  }

  let minDistSquared = Infinity;

  for (let i = 0; i < stroke.points.length - 1; i++) {
    const p1 = stroke.points[i];
    const p2 = stroke.points[i + 1];
    const distSquared = pointToSegmentDistanceSquared(px, py, p1.x, p1.y, p2.x, p2.y);
    if (distSquared < minDistSquared) {
      minDistSquared = distSquared;
    }
  }

  return Math.sqrt(minDistSquared);
}

/**
 * Check if a point is within the hit tolerance of a stroke.
 */
export function pointHitsStroke(
  px: number,
  py: number,
  stroke: InkStroke,
  tolerance: number = 2,
): boolean {
  const distance = pointToStrokeDistance(px, py, stroke);
  const hitThreshold = stroke.width / 2 + tolerance;
  return distance <= hitThreshold;
}
