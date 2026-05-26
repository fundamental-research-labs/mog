/**
 * Spatial Index Implementation (Universal)
 *
 * Grid-based spatial index for O(1) average case lookups during eraser operations.
 *
 * Architecture:
 * - Grid-based approach: Divides space into cells for O(1) candidate lookup
 * - Strokes are mapped to all grid cells they overlap
 * - queryPoint returns candidates from the cell containing the point
 * - queryRect returns candidates from all overlapping cells
 *
 * @module core/spatial-index
 */

import type { InkStroke, StrokeId } from '@mog-sdk/contracts/ink';
import type { InkBoundingBox, ISpatialIndex } from './ink/ink-spatial-index';
import { computeStrokeBounds, pointIntersectsBounds } from './ink/ink-spatial-index';

// =============================================================================
// Constants
// =============================================================================

/**
 * Default grid cell size in pixels.
 * Smaller cells = more precise but more memory.
 * 50px is a good balance for typical stroke sizes.
 */
const DEFAULT_CELL_SIZE = 50;

// =============================================================================
// Grid Spatial Index Implementation
// =============================================================================

/**
 * Grid-based spatial index implementing ISpatialIndex.
 *
 * Uses a sparse grid where each cell contains a Set of stroke IDs
 * whose bounding boxes overlap that cell.
 */
export class GridSpatialIndex implements ISpatialIndex {
  /** Cell size in pixels */
  private readonly cellSize: number;

  /** Sparse grid: Map from cell key to Set of stroke IDs */
  private grid: Map<string, Set<StrokeId>> = new Map();

  /** Bounds for each stroke (for updates and removal) */
  private strokeBounds: Map<StrokeId, InkBoundingBox> = new Map();

  constructor(cellSize: number = DEFAULT_CELL_SIZE) {
    this.cellSize = cellSize;
  }

  /**
   * Convert coordinates to cell key.
   */
  private getCellKey(cellX: number, cellY: number): string {
    return `${cellX}:${cellY}`;
  }

  /**
   * Get the cell coordinates for a point.
   */
  private getCellCoords(x: number, y: number): { cellX: number; cellY: number } {
    return {
      cellX: Math.floor(x / this.cellSize),
      cellY: Math.floor(y / this.cellSize),
    };
  }

  /**
   * Get all cell keys that a bounding box overlaps.
   */
  private getCellsForBounds(bounds: InkBoundingBox): string[] {
    const keys: string[] = [];
    const minCell = this.getCellCoords(bounds.minX, bounds.minY);
    const maxCell = this.getCellCoords(bounds.maxX, bounds.maxY);

    for (let cellX = minCell.cellX; cellX <= maxCell.cellX; cellX++) {
      for (let cellY = minCell.cellY; cellY <= maxCell.cellY; cellY++) {
        keys.push(this.getCellKey(cellX, cellY));
      }
    }

    return keys;
  }

  /**
   * Insert a stroke into the spatial index.
   */
  insert(strokeId: StrokeId, bounds: InkBoundingBox): void {
    // Store bounds for later removal/update
    this.strokeBounds.set(strokeId, bounds);

    // Add to all overlapping cells
    const cellKeys = this.getCellsForBounds(bounds);
    for (const key of cellKeys) {
      let cell = this.grid.get(key);
      if (!cell) {
        cell = new Set();
        this.grid.set(key, cell);
      }
      cell.add(strokeId);
    }
  }

  /**
   * Remove a stroke from the spatial index.
   */
  remove(strokeId: StrokeId): void {
    const bounds = this.strokeBounds.get(strokeId);
    if (!bounds) return;

    // Remove from all overlapping cells
    const cellKeys = this.getCellsForBounds(bounds);
    for (const key of cellKeys) {
      const cell = this.grid.get(key);
      if (cell) {
        cell.delete(strokeId);
        // Clean up empty cells
        if (cell.size === 0) {
          this.grid.delete(key);
        }
      }
    }

    this.strokeBounds.delete(strokeId);
  }

  /**
   * Update a stroke's bounds in the spatial index.
   */
  update(strokeId: StrokeId, newBounds: InkBoundingBox): void {
    this.remove(strokeId);
    this.insert(strokeId, newBounds);
  }

  /**
   * Query all strokes whose bounds intersect the given bounds.
   */
  query(bounds: InkBoundingBox): StrokeId[] {
    const candidates = new Set<StrokeId>();
    const cellKeys = this.getCellsForBounds(bounds);

    for (const key of cellKeys) {
      const cell = this.grid.get(key);
      if (cell) {
        for (const strokeId of cell) {
          candidates.add(strokeId);
        }
      }
    }

    // Filter to only strokes that actually intersect (not just in same cell)
    const results: StrokeId[] = [];
    for (const strokeId of candidates) {
      const strokeBounds = this.strokeBounds.get(strokeId);
      if (strokeBounds && this.boundsIntersect(bounds, strokeBounds)) {
        results.push(strokeId);
      }
    }

    return results;
  }

  /**
   * Query all strokes whose bounds contain the point.
   */
  queryPoint(x: number, y: number): StrokeId[] {
    const cell = this.getCellCoords(x, y);
    const key = this.getCellKey(cell.cellX, cell.cellY);
    const cellContents = this.grid.get(key);

    if (!cellContents) return [];

    // Filter to strokes whose bounds actually contain the point
    const results: StrokeId[] = [];
    for (const strokeId of cellContents) {
      const bounds = this.strokeBounds.get(strokeId);
      if (bounds && pointIntersectsBounds(x, y, bounds)) {
        results.push(strokeId);
      }
    }

    return results;
  }

  /**
   * Query the nearest stroke to a point.
   */
  queryNearest(
    x: number,
    y: number,
    maxDistance?: number,
  ): { strokeId: StrokeId; distance: number } | null {
    // For simplicity, use an expanding search
    const searchRadius = maxDistance ?? this.cellSize * 3;
    const bounds: InkBoundingBox = {
      minX: x - searchRadius,
      minY: y - searchRadius,
      maxX: x + searchRadius,
      maxY: y + searchRadius,
    };

    const candidates = this.query(bounds);
    if (candidates.length === 0) return null;

    let nearest: { strokeId: StrokeId; distance: number } | null = null;

    for (const strokeId of candidates) {
      const strokeBounds = this.strokeBounds.get(strokeId);
      if (!strokeBounds) continue;

      // Compute distance to bounds center (approximation)
      const cx = (strokeBounds.minX + strokeBounds.maxX) / 2;
      const cy = (strokeBounds.minY + strokeBounds.maxY) / 2;
      const distance = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);

      if (maxDistance !== undefined && distance > maxDistance) continue;

      if (nearest === null || distance < nearest.distance) {
        nearest = { strokeId, distance };
      }
    }

    return nearest;
  }

  /**
   * Clear all strokes from the index.
   */
  clear(): void {
    this.grid.clear();
    this.strokeBounds.clear();
  }

  /**
   * Get the number of strokes in the index.
   */
  size(): number {
    return this.strokeBounds.size;
  }

  /**
   * Bulk insert multiple strokes.
   */
  bulkInsert(entries: Array<[StrokeId, InkBoundingBox]>): void {
    for (const [strokeId, bounds] of entries) {
      this.insert(strokeId, bounds);
    }
  }

  /**
   * Check if two bounding boxes intersect.
   */
  private boundsIntersect(a: InkBoundingBox, b: InkBoundingBox): boolean {
    return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
  }

  /**
   * Rebuild the index from a map of strokes.
   * Used after bulk operations or initialization.
   */
  rebuild(strokes: Map<StrokeId, InkStroke>): void {
    this.clear();
    for (const [strokeId, stroke] of strokes) {
      const bounds = computeStrokeBounds(stroke);
      this.insert(strokeId, bounds);
    }
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a new spatial index.
 *
 * @param cellSize - Optional cell size in pixels (default 50)
 * @returns A new GridSpatialIndex instance
 */
export function createSpatialIndex(cellSize?: number): ISpatialIndex {
  return new GridSpatialIndex(cellSize);
}
