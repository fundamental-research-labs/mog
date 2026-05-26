/**
 * Spatial Index Types for Ink Engine
 *
 * Types and utilities for spatial indexing and hit testing of ink strokes.
 * Spatial indexing enables efficient queries like:
 * - Which strokes are under the cursor? (hit testing)
 * - Which strokes are within a selection region? (lasso/rectangle select)
 * - Which strokes intersect a given bounding box? (viewport culling)
 *
 * ARCHITECTURE NOTES:
 * - InkBoundingBox is the fundamental unit for spatial queries
 * - ISpatialIndex interface enables different implementations (R-tree, grid, etc.)
 * - Utility functions are pure and can be used without a spatial index
 *
 * @see contracts/src/ink/types.ts for InkStroke and InkPoint
 */

import type { StrokeId } from './types';

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

// =============================================================================
// Spatial Index Interface
// =============================================================================

/**
 * Spatial index for efficient stroke queries.
 *
 * Implementations can use different algorithms:
 * - R-tree: Good for dynamic datasets, O(log n) queries
 * - Grid: Good for uniform distributions, O(1) average queries
 * - Quadtree: Good for non-uniform distributions
 *
 * The interface is implementation-agnostic for flexibility.
 */
export interface ISpatialIndex {
  /**
   * Insert a stroke into the spatial index.
   *
   * @param strokeId - ID of the stroke
   * @param bounds - Bounding box of the stroke
   */
  insert(strokeId: StrokeId, bounds: InkBoundingBox): void;

  /**
   * Remove a stroke from the spatial index.
   *
   * @param strokeId - ID of the stroke to remove
   */
  remove(strokeId: StrokeId): void;

  /**
   * Update a stroke's bounds in the spatial index.
   *
   * Equivalent to remove + insert but may be more efficient.
   *
   * @param strokeId - ID of the stroke to update
   * @param newBounds - New bounding box
   */
  update(strokeId: StrokeId, newBounds: InkBoundingBox): void;

  /**
   * Find all strokes that intersect a bounding box.
   *
   * @param bounds - Query bounding box
   * @returns Array of stroke IDs whose bounds intersect the query box
   */
  query(bounds: InkBoundingBox): StrokeId[];

  /**
   * Find all strokes that contain a point.
   *
   * This performs bounds-based filtering first, then may need
   * additional checks for precise point-in-stroke testing.
   *
   * @param x - X coordinate
   * @param y - Y coordinate
   * @returns Array of stroke IDs whose bounds contain the point
   */
  queryPoint(x: number, y: number): StrokeId[];

  /**
   * Find the nearest stroke to a point.
   *
   * @param x - X coordinate
   * @param y - Y coordinate
   * @param maxDistance - Maximum search distance (optional)
   * @returns Nearest stroke ID and distance, or null if none found
   */
  queryNearest(
    x: number,
    y: number,
    maxDistance?: number,
  ): { strokeId: StrokeId; distance: number } | null;

  /**
   * Clear all strokes from the index.
   */
  clear(): void;

  /**
   * Get the number of strokes in the index.
   */
  size(): number;

  /**
   * Bulk insert multiple strokes.
   * May be more efficient than individual inserts.
   *
   * @param entries - Array of [strokeId, bounds] tuples
   */
  bulkInsert(entries: Array<[StrokeId, InkBoundingBox]>): void;
}
