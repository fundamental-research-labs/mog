/**
 * Grid-Based Spatial Index
 *
 * Grid-based spatial index for O(1) average case lookups.
 * Promoted from @mog/ink-engine to be the shared spatial index
 * for all canvas packages.
 *
 * Architecture:
 * - Grid-based: divides space into cells for O(1) candidate lookup.
 * - Items are mapped to all grid cells their bounding box overlaps.
 * - queryPoint returns candidates from the cell containing the point.
 * - query returns candidates from all overlapping cells.
 *
 * Pure computation: no DOM, no Canvas, no React, no Yjs.
 */
import type { BoundingBox, Point2D } from '@mog-sdk/contracts/geometry';
import type { SpatialEntry, SpatialIndex } from './types';

// =============================================================================
// Constants
// =============================================================================

/**
 * Default grid cell size in pixels.
 * 50px is a good balance for typical stroke sizes.
 */
const DEFAULT_CELL_SIZE = 50;

/**
 * Maximum number of grid cells an item can span before it is considered "oversized".
 * Oversized items are stored separately and checked in every query.
 */
const MAX_CELLS = 1000;

/**
 * Maximum number of grid cells a query can span before falling back to full scan.
 * Separate from MAX_CELLS to allow different thresholds for inserts vs queries.
 */
const MAX_QUERY_CELLS = 10_000;

// =============================================================================
// Helpers
// =============================================================================

/**
 * Internal stored entry with the data payload.
 */
interface StoredEntry<T> {
  data: T;
  bounds: BoundingBox;
}

/**
 * Pack two cell coordinates into a single numeric key.
 * Uses bit-packing: (cellX << 16) | (cellY & 0xFFFF).
 * Supports cell coordinates in range [-32768, 32767].
 */
function packCellKey(cellX: number, cellY: number): number {
  return ((cellX & 0xffff) << 16) | (cellY & 0xffff);
}

/**
 * Check if two axis-aligned bounding boxes overlap (inclusive bounds).
 */
function boxesOverlap(a: BoundingBox, b: BoundingBox): boolean {
  return (
    a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y
  );
}

// =============================================================================
// Grid-Based Spatial Index
// =============================================================================

/**
 * Grid-based spatial index.
 *
 * Uses a sparse grid where each cell contains a Set of item IDs
 * whose bounding boxes overlap that cell. Cell keys are bit-packed
 * integers for better Map performance.
 */
export class GridSpatialIndex<T> implements SpatialIndex<T> {
  private readonly cellSize: number;
  private grid: Map<number, Set<string>> = new Map();
  private entries: Map<string, StoredEntry<T>> = new Map();
  private oversized: Map<string, StoredEntry<T>> = new Map();

  constructor(cellSize: number = DEFAULT_CELL_SIZE) {
    this.cellSize = cellSize;
  }

  // --- Private Helpers ---

  private getCellCoords(x: number, y: number): { cellX: number; cellY: number } {
    return {
      cellX: Math.floor(x / this.cellSize),
      cellY: Math.floor(y / this.cellSize),
    };
  }

  /**
   * Count how many cells a bounding box would span.
   */
  private cellCount(bounds: BoundingBox): number {
    const minCell = this.getCellCoords(bounds.x, bounds.y);
    const maxCell = this.getCellCoords(bounds.x + bounds.width, bounds.y + bounds.height);
    const cols = maxCell.cellX - minCell.cellX + 1;
    const rows = maxCell.cellY - minCell.cellY + 1;
    return cols * rows;
  }

  /**
   * Check if a bounding box would span more cells than MAX_CELLS.
   */
  private isOversized(bounds: BoundingBox): boolean {
    return this.cellCount(bounds) > MAX_CELLS;
  }

  /**
   * Check if a query would span more cells than MAX_QUERY_CELLS.
   */
  private isQueryOversized(bounds: BoundingBox): boolean {
    return this.cellCount(bounds) > MAX_QUERY_CELLS;
  }

  /**
   * Get all cell keys that a bounding box overlaps.
   * Returns null if the bounds are oversized (too many cells).
   */
  private getCellsForBounds(bounds: BoundingBox): number[] | null {
    if (this.isOversized(bounds)) {
      return null;
    }

    const keys: number[] = [];
    const minCell = this.getCellCoords(bounds.x, bounds.y);
    const maxCell = this.getCellCoords(bounds.x + bounds.width, bounds.y + bounds.height);

    for (let cellX = minCell.cellX; cellX <= maxCell.cellX; cellX++) {
      for (let cellY = minCell.cellY; cellY <= maxCell.cellY; cellY++) {
        keys.push(packCellKey(cellX, cellY));
      }
    }

    return keys;
  }

  private boundsContainPoint(bounds: BoundingBox, point: Point2D): boolean {
    return (
      point.x >= bounds.x &&
      point.x <= bounds.x + bounds.width &&
      point.y >= bounds.y &&
      point.y <= bounds.y + bounds.height
    );
  }

  // --- Public API ---

  insert(id: string, bounds: BoundingBox, data: T): void {
    // Clean up old grid cells if this ID already exists
    if (this.entries.has(id)) {
      this.remove(id);
    }

    const entry: StoredEntry<T> = { data, bounds };
    this.entries.set(id, entry);

    const cellKeys = this.getCellsForBounds(bounds);
    if (cellKeys === null) {
      // Oversized item - store separately
      this.oversized.set(id, entry);
      return;
    }

    for (const key of cellKeys) {
      let cell = this.grid.get(key);
      if (!cell) {
        cell = new Set();
        this.grid.set(key, cell);
      }
      cell.add(id);
    }
  }

  remove(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;

    if (this.oversized.has(id)) {
      this.oversized.delete(id);
    } else {
      const cellKeys = this.getCellsForBounds(entry.bounds);
      if (cellKeys) {
        for (const key of cellKeys) {
          const cell = this.grid.get(key);
          if (cell) {
            cell.delete(id);
            if (cell.size === 0) {
              this.grid.delete(key);
            }
          }
        }
      }
    }

    this.entries.delete(id);
  }

  updateBounds(id: string, bounds: BoundingBox): void {
    const entry = this.entries.get(id);
    if (!entry) return;

    // Remove from old location
    const wasOversized = this.oversized.has(id);
    if (wasOversized) {
      this.oversized.delete(id);
    } else {
      const oldKeys = this.getCellsForBounds(entry.bounds);
      if (oldKeys) {
        for (const key of oldKeys) {
          const cell = this.grid.get(key);
          if (cell) {
            cell.delete(id);
            if (cell.size === 0) {
              this.grid.delete(key);
            }
          }
        }
      }
    }

    // Update bounds
    entry.bounds = bounds;

    // Insert into new location
    const newKeys = this.getCellsForBounds(bounds);
    if (newKeys === null) {
      // Now oversized
      this.oversized.set(id, entry);
    } else {
      for (const key of newKeys) {
        let cell = this.grid.get(key);
        if (!cell) {
          cell = new Set();
          this.grid.set(key, cell);
        }
        cell.add(id);
      }
    }
  }

  query(bounds: BoundingBox): SpatialEntry<T>[] {
    const candidateIds = new Set<string>();

    if (!this.isQueryOversized(bounds)) {
      const cellKeys = this.getCellsForBounds(bounds);
      if (cellKeys) {
        for (const key of cellKeys) {
          const cell = this.grid.get(key);
          if (cell) {
            for (const id of cell) {
              candidateIds.add(id);
            }
          }
        }
      } else {
        // Item bounds itself is oversized - check all grid-indexed entries
        for (const id of this.entries.keys()) {
          if (!this.oversized.has(id)) {
            candidateIds.add(id);
          }
        }
      }
    } else {
      // Query bounds is too large - check all grid-indexed entries
      for (const id of this.entries.keys()) {
        if (!this.oversized.has(id)) {
          candidateIds.add(id);
        }
      }
    }

    const results: SpatialEntry<T>[] = [];
    for (const id of candidateIds) {
      const entry = this.entries.get(id);
      if (entry && boxesOverlap(bounds, entry.bounds)) {
        results.push({ id, data: entry.data, bounds: entry.bounds });
      }
    }

    // Always check oversized items
    for (const [id, entry] of this.oversized) {
      if (boxesOverlap(bounds, entry.bounds)) {
        results.push({ id, data: entry.data, bounds: entry.bounds });
      }
    }

    return results;
  }

  queryPoint(point: Point2D): SpatialEntry<T>[] {
    const results: SpatialEntry<T>[] = [];

    const cell = this.getCellCoords(point.x, point.y);
    const key = packCellKey(cell.cellX, cell.cellY);
    const cellContents = this.grid.get(key);

    if (cellContents) {
      for (const id of cellContents) {
        const entry = this.entries.get(id);
        if (entry && this.boundsContainPoint(entry.bounds, point)) {
          results.push({ id, data: entry.data, bounds: entry.bounds });
        }
      }
    }

    // Always check oversized items
    for (const [id, entry] of this.oversized) {
      if (this.boundsContainPoint(entry.bounds, point)) {
        results.push({ id, data: entry.data, bounds: entry.bounds });
      }
    }

    return results;
  }

  all(): SpatialEntry<T>[] {
    const results: SpatialEntry<T>[] = [];
    for (const [id, entry] of this.entries) {
      results.push({ id, data: entry.data, bounds: entry.bounds });
    }
    return results;
  }

  clear(): void {
    this.grid.clear();
    this.entries.clear();
    this.oversized.clear();
  }

  size(): number {
    return this.entries.size;
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a new grid-based spatial index.
 *
 * @param cellSize Grid cell size in pixels (default 50).
 * @returns A new SpatialIndex instance.
 */
export function createSpatialIndex<T>(cellSize: number = DEFAULT_CELL_SIZE): SpatialIndex<T> {
  return new GridSpatialIndex<T>(cellSize);
}
