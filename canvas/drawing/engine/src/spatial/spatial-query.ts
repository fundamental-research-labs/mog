/**
 * Spatial Query Operations
 *
 * Pure functions for spatial queries on floating objects:
 * hit testing, rectangle selection, proximity search, overlap detection.
 *
 * Delegates to @mog/geometry for all geometric primitives.
 */

import type { DrawingObject } from '@mog-sdk/contracts/drawing';
import type { BoundingBox, Point2D } from '@mog-sdk/contracts/geometry';

import { distanceToRect, pointInRect, rectContains, Rect } from '@mog/geometry';

import { isPointInDrawingObject } from '../renderer/hit-test';

// =============================================================================
// TYPES
// =============================================================================

/**
 * A spatial object with position and z-order information.
 */
export interface SpatialObject {
  id: string;
  bounds: BoundingBox;
  zIndex: number;
}

/**
 * Options for narrow-phase hit testing.
 *
 * When provided, hitTest() applies pixel-accurate geometry testing
 * (via Canvas2D isPointInPath) after the broad-phase bounding-box check.
 * If the narrow-phase rejects a candidate, the next object by z-order is tested.
 */
export interface HitTestNarrowPhaseOptions {
  /** Canvas 2D rendering context for isPointInPath/isPointInStroke checks. */
  ctx: CanvasRenderingContext2D;
  /** Map from spatial object ID to DrawingObject for geometry lookup. */
  drawingObjects: Map<string, DrawingObject>;
}

// =============================================================================
// HIT TESTING
// =============================================================================

/**
 * Find the topmost object at a given point.
 * Objects with higher z-index are checked first.
 *
 * When `narrowPhase` options are provided, each broad-phase candidate is
 * additionally tested against its DrawingObject geometry using
 * `isPointInDrawingObject()`. If the narrow-phase test fails, the search
 * continues to the next object by z-order. This enables pixel-accurate
 * hit testing for non-rectangular shapes (ovals, triangles, etc.).
 *
 * @param objects - Array of spatial objects
 * @param point - Point to test
 * @param narrowPhase - Optional narrow-phase options for pixel-accurate testing
 * @returns The topmost object at the point, or null if none
 */
export function hitTest(
  objects: SpatialObject[],
  point: Point2D,
  narrowPhase?: HitTestNarrowPhaseOptions,
): SpatialObject | null {
  // Sort by z-index descending (topmost first)
  const sorted = [...objects].sort((a, b) => b.zIndex - a.zIndex);

  for (const obj of sorted) {
    if (pointInRect(point, obj.bounds)) {
      // If narrow-phase available, use it for pixel-accurate testing
      if (narrowPhase) {
        const drawingObj = narrowPhase.drawingObjects.get(obj.id);
        if (drawingObj && isPointInDrawingObject(drawingObj, point.x, point.y, narrowPhase.ctx)) {
          return obj;
        }
        // Broad-phase hit but narrow-phase miss — continue to next candidate
        continue;
      }
      return obj; // No narrow-phase, broad-phase only
    }
  }

  return null;
}

// =============================================================================
// RECTANGLE SELECTION
// =============================================================================

/**
 * Find all objects within a rectangle selection (rubber band).
 *
 * @param objects - Array of spatial objects
 * @param rect - Selection rectangle
 * @param mode - 'intersects' returns objects that overlap the rect,
 *               'contains' returns only objects fully inside the rect
 * @returns Array of objects matching the mode
 */
export function selectInRect(
  objects: SpatialObject[],
  rect: BoundingBox,
  mode: 'intersects' | 'contains',
): SpatialObject[] {
  return objects.filter((obj) => {
    if (mode === 'contains') {
      return rectContains(rect, obj.bounds);
    }
    return Rect.overlaps(rect, obj.bounds);
  });
}

// =============================================================================
// PROXIMITY SEARCH
// =============================================================================

/**
 * Find all objects within a given radius of a point.
 * Uses the closest point on the object bounds for distance calculation.
 *
 * @param objects - Array of spatial objects
 * @param point - Center point
 * @param radius - Search radius in pixels
 * @returns Array of objects within the radius, sorted by distance (nearest first)
 */
export function findNearby(
  objects: SpatialObject[],
  point: Point2D,
  radius: number,
): SpatialObject[] {
  const results: { obj: SpatialObject; dist: number }[] = [];

  for (const obj of objects) {
    const dist = distanceToRect(point, obj.bounds);
    if (dist <= radius) {
      results.push({ obj, dist });
    }
  }

  // Sort by distance (nearest first)
  results.sort((a, b) => a.dist - b.dist);
  return results.map((r) => r.obj);
}

// =============================================================================
// OVERLAP DETECTION
// =============================================================================

/**
 * Find all objects overlapping a given target object.
 *
 * @param objects - Array of all spatial objects
 * @param targetId - ID of the target object
 * @returns Array of objects that overlap the target (excluding the target itself)
 */
export function findOverlapping(objects: SpatialObject[], targetId: string): SpatialObject[] {
  const target = objects.find((obj) => obj.id === targetId);
  if (!target) return [];

  return objects.filter((obj) => {
    if (obj.id === targetId) return false;
    return Rect.overlaps(target.bounds, obj.bounds);
  });
}
