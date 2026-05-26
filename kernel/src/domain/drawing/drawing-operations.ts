/**
 * Drawing Operations (Read-Only, Universal)
 *
 * Pure functions for reading and querying drawing objects.
 * Following the "Reads Direct, Writes Orchestrated" pattern.
 *
 * @see contracts/src/ink/types.ts for DrawingObject and InkStroke
 * @see ./spatial-index.ts for spatial index implementation
 */

import type { FloatingObject } from '@mog-sdk/contracts/floating-objects';
import type { DrawingObject, InkPoint, InkStroke, StrokeId } from '@mog-sdk/contracts/ink';
import type { InkBoundingBox, ISpatialIndex } from './ink/ink-spatial-index';
import {
  computeStrokeBounds,
  EMPTY_BOUNDING_BOX,
  isValidBounds,
  pointHitsStroke,
  unionBounds,
} from './ink/ink-spatial-index';

import { createSpatialIndex, GridSpatialIndex } from './spatial-index';

// =============================================================================
// Spatial Index Caching
// =============================================================================

/**
 * Cache for spatial indices, keyed by drawing ID.
 * Automatically invalidated when strokes change.
 */
const spatialIndexCache = new Map<string, ISpatialIndex>();

/**
 * Get or create a spatial index for a drawing.
 *
 * @param drawing - The drawing object
 * @returns The spatial index for the drawing
 */
export function getSpatialIndex(drawing: DrawingObject): ISpatialIndex {
  let index = spatialIndexCache.get(drawing.id);

  if (!index) {
    index = createSpatialIndex();
    // Initialize with existing strokes
    if (index instanceof GridSpatialIndex) {
      index.rebuild(drawing.strokes);
    } else {
      // Fallback for interface-only implementations
      for (const [strokeId, stroke] of drawing.strokes) {
        const bounds = computeStrokeBounds(stroke);
        index.insert(strokeId, bounds);
      }
    }
    spatialIndexCache.set(drawing.id, index);
  }

  return index;
}

/**
 * Invalidate the spatial index for a drawing.
 * Call this whenever strokes are added, removed, or modified.
 *
 * @param drawingId - ID of the drawing whose index should be invalidated
 */
export function invalidateSpatialIndex(drawingId: string): void {
  spatialIndexCache.delete(drawingId);
}

/**
 * Clear all cached spatial indices.
 */
export function clearSpatialIndexCache(): void {
  spatialIndexCache.clear();
}

// =============================================================================
// Drawing Query Operations
// =============================================================================

/**
 * Get a drawing by ID from a list of floating objects.
 *
 * @param objects - Array of floating objects
 * @param drawingId - ID of the drawing to find
 * @returns The drawing object or undefined
 */
export function getDrawingById(
  objects: FloatingObject[],
  drawingId: string,
): DrawingObject | undefined {
  const obj = objects.find((o) => o.id === drawingId);
  if (obj && obj.type === 'drawing') {
    return obj as DrawingObject;
  }
  return undefined;
}

/**
 * Get all drawings in a sheet.
 *
 * @param objects - Array of floating objects
 * @returns Array of drawing objects
 */
export function getDrawingsInSheet(objects: FloatingObject[]): DrawingObject[] {
  return objects.filter((obj): obj is DrawingObject => obj.type === 'drawing');
}

// =============================================================================
// Stroke Query Operations
// =============================================================================

/**
 * Find all strokes at a given point using the spatial index.
 * Uses O(1) candidate lookup, then precise hit testing.
 *
 * @param drawing - The drawing object
 * @param x - X coordinate in drawing-local space
 * @param y - Y coordinate in drawing-local space
 * @param tolerance - Additional hit tolerance in pixels (default 2)
 * @returns Array of stroke IDs that hit the point
 */
export function findStrokesAtPoint(
  drawing: DrawingObject,
  x: number,
  y: number,
  tolerance: number = 2,
): StrokeId[] {
  const index = getSpatialIndex(drawing);

  // Get candidates from spatial index (O(1) average case)
  const candidates = index.queryPoint(x, y);

  // Precise hit testing on candidates
  const hits: StrokeId[] = [];
  for (const strokeId of candidates) {
    const stroke = drawing.strokes.get(strokeId);
    if (stroke && pointHitsStroke(x, y, stroke, tolerance)) {
      hits.push(strokeId);
    }
  }

  return hits;
}

/**
 * Find all strokes within a lasso selection (polygon).
 *
 * @param drawing - The drawing object
 * @param lassoPoints - Points defining the lasso polygon
 * @returns Array of stroke IDs inside the lasso
 */
export function findStrokesInLasso(drawing: DrawingObject, lassoPoints: InkPoint[]): StrokeId[] {
  if (lassoPoints.length < 3) return [];

  // Compute lasso bounding box for fast rejection
  const lassoBounds = computePolygonBounds(lassoPoints);
  const index = getSpatialIndex(drawing);

  // Get candidates from spatial index
  const candidates = index.query(lassoBounds);

  // Check each candidate
  const results: StrokeId[] = [];
  for (const strokeId of candidates) {
    const stroke = drawing.strokes.get(strokeId);
    if (stroke && isStrokeInPolygon(stroke, lassoPoints)) {
      results.push(strokeId);
    }
  }

  return results;
}

/**
 * Find strokes within a rectangular selection.
 *
 * @param drawing - The drawing object
 * @param bounds - Selection rectangle
 * @returns Array of stroke IDs within the rectangle
 */
export function findStrokesInRect(drawing: DrawingObject, bounds: InkBoundingBox): StrokeId[] {
  const index = getSpatialIndex(drawing);
  return index.query(bounds);
}

// =============================================================================
// Bounds Computation
// =============================================================================

/**
 * Compute the bounding box of multiple strokes (Map-based).
 *
 * @param strokes - Map of stroke IDs to strokes
 * @returns Combined bounding box or empty bounds if no strokes
 */
export function computeStrokesBounds(strokes: Map<StrokeId, InkStroke>): InkBoundingBox {
  if (strokes.size === 0) {
    return { ...EMPTY_BOUNDING_BOX };
  }

  let result: InkBoundingBox | null = null;

  for (const stroke of strokes.values()) {
    const bounds = computeStrokeBounds(stroke);
    if (!isValidBounds(bounds)) continue;

    if (result === null) {
      result = bounds;
    } else {
      result = unionBounds(result, bounds);
    }
  }

  return result ?? { ...EMPTY_BOUNDING_BOX };
}

/**
 * Compute the bounding box of a polygon.
 */
function computePolygonBounds(points: InkPoint[]): InkBoundingBox {
  if (points.length === 0) {
    return { ...EMPTY_BOUNDING_BOX };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  return { minX, minY, maxX, maxY };
}

// =============================================================================
// Polygon Hit Testing (Ray Casting Algorithm)
// =============================================================================

/**
 * Check if a point is inside a polygon using ray casting algorithm.
 *
 * @param x - Point X coordinate
 * @param y - Point Y coordinate
 * @param polygon - Array of points defining the polygon
 * @returns True if the point is inside the polygon
 */
export function isPointInPolygon(x: number, y: number, polygon: InkPoint[]): boolean {
  if (polygon.length < 3) return false;

  let inside = false;
  const n = polygon.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

    if (intersect) {
      inside = !inside;
    }
  }

  return inside;
}

/**
 * Check if any point of a stroke is inside a polygon.
 *
 * @param stroke - The stroke to test
 * @param polygon - Array of points defining the polygon
 * @returns True if any stroke point is inside the polygon
 */
function isStrokeInPolygon(stroke: InkStroke, polygon: InkPoint[]): boolean {
  // Check if any point of the stroke is inside the polygon
  for (const point of stroke.points) {
    if (isPointInPolygon(point.x, point.y, polygon)) {
      return true;
    }
  }
  return false;
}

// =============================================================================
// Bezier Control Point Computation
// =============================================================================

/**
 * Catmull-Rom tension parameter.
 * 0.5 gives standard Catmull-Rom splines.
 */
const CATMULL_ROM_TENSION = 0.5;

/**
 * Compute Bezier control points from Catmull-Rom spline.
 *
 * @param points - Array of points to interpolate
 * @param tension - Catmull-Rom tension (default 0.5)
 * @returns Array of control points for each segment
 */
export function computeBezierControlPoints(
  points: InkPoint[],
  tension: number = CATMULL_ROM_TENSION,
): Array<{ cp1: InkPoint; cp2: InkPoint }> {
  if (points.length < 2) return [];

  const controlPoints: Array<{ cp1: InkPoint; cp2: InkPoint }> = [];

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    // Catmull-Rom to Bezier conversion
    const cp1: InkPoint = {
      x: p1.x + ((p2.x - p0.x) * tension) / 3,
      y: p1.y + ((p2.y - p0.y) * tension) / 3,
      // Interpolate pressure if available
      pressure:
        p1.pressure !== undefined && p2.pressure !== undefined
          ? p1.pressure + (p2.pressure - p1.pressure) / 3
          : undefined,
    };

    const cp2: InkPoint = {
      x: p2.x - ((p3.x - p1.x) * tension) / 3,
      y: p2.y - ((p3.y - p1.y) * tension) / 3,
      pressure:
        p1.pressure !== undefined && p2.pressure !== undefined
          ? p2.pressure - (p2.pressure - p1.pressure) / 3
          : undefined,
    };

    controlPoints.push({ cp1, cp2 });
  }

  return controlPoints;
}

// =============================================================================
// Pressure Data Detection
// =============================================================================

/**
 * Check if a stroke has pressure data.
 *
 * @param stroke - The stroke to check
 * @returns True if any point has pressure data
 */
export function hasPressureData(stroke: InkStroke): boolean {
  return stroke.points.some((p) => p.pressure !== undefined && p.pressure > 0);
}

/**
 * Check if a drawing has any strokes with pressure data.
 *
 * @param drawing - The drawing to check
 * @returns True if any stroke has pressure data
 */
export function drawingHasPressureData(drawing: DrawingObject): boolean {
  for (const stroke of drawing.strokes.values()) {
    if (hasPressureData(stroke)) {
      return true;
    }
  }
  return false;
}

// =============================================================================
// Hit Testing for Drawing Objects
// =============================================================================

/**
 * Get a drawing at a given point (for hit testing).
 *
 * @param drawings - Array of drawings to test
 * @param x - X coordinate in sheet space
 * @param y - Y coordinate in sheet space
 * @param drawingBoundsGetter - Function to get bounds for a drawing in sheet space
 * @returns The topmost drawing at the point, or undefined
 */
export function getDrawingAtPoint(
  drawings: DrawingObject[],
  x: number,
  y: number,
  drawingBoundsGetter?: (drawing: DrawingObject) => InkBoundingBox | null,
): DrawingObject | undefined {
  // Check in reverse order (highest z-index first)
  for (let i = drawings.length - 1; i >= 0; i--) {
    const drawing = drawings[i];

    if (drawingBoundsGetter) {
      const bounds = drawingBoundsGetter(drawing);
      if (bounds && isPointInBounds(x, y, bounds)) {
        return drawing;
      }
    } else {
      // Fallback: check if point is within any stroke bounds
      const strokeBounds = computeStrokesBounds(drawing.strokes);
      if (isValidBounds(strokeBounds) && isPointInBounds(x, y, strokeBounds)) {
        return drawing;
      }
    }
  }

  return undefined;
}

/**
 * Check if a point is inside bounds.
 */
function isPointInBounds(x: number, y: number, bounds: InkBoundingBox): boolean {
  return x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
}

// =============================================================================
// Ordered Stroke Iteration
// =============================================================================

/**
 * Get strokes ordered by creation time for rendering.
 *
 * @param drawing - The drawing object
 * @returns Array of strokes ordered by createdAt timestamp
 */
export function getOrderedStrokes(drawing: DrawingObject): InkStroke[] {
  const strokes = Array.from(drawing.strokes.values());
  return strokes.sort((a, b) => a.createdAt - b.createdAt);
}
