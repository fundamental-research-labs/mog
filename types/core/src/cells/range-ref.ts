/**
 * Range Reference Types
 *
 * Structured representations of cell and range references.
 * Used for parsing, manipulating, and adjusting ranges for:
 * - RangeSchema.ranges (cells the schema applies to)
 * - enumSource (dynamic dropdown source)
 * - Row/column insert/delete operations
 * - Copy/paste operations
 */

// ============================================================================
// Cell Reference Types
// ============================================================================

/**
 * Structured representation of a cell reference (e.g., $A$1, B2)
 */
export interface CellRef {
  /** Row index (0-based) */
  row: number;
  /** Column index (0-based) */
  col: number;
  /** True for absolute row reference ($1) - doesn't shift on insert/delete */
  rowAbsolute: boolean;
  /** True for absolute column reference ($A) - doesn't shift on insert/delete */
  colAbsolute: boolean;
}

/**
 * Structured representation of a range reference (e.g., $A$1:$B$10)
 */
export interface RangeRef {
  /** Start cell (top-left) */
  start: CellRef;
  /** End cell (bottom-right) */
  end: CellRef;
  /** Sheet name for cross-sheet refs like Sheet2!A1:B10 */
  sheetName?: string;
}

// ============================================================================
// Query Result Types
// ============================================================================

/**
 * Result of checking if a cell is contained in a range
 */
export interface RangeContainsResult {
  /** Whether the cell is within the range */
  contains: boolean;
  /** Position within range, relative to start (for relative refs) */
  relativeRow?: number;
  /** Position within range, relative to start (for relative refs) */
  relativeCol?: number;
}

/**
 * Bounds for viewport queries
 */
export interface ViewportBounds {
  /** Minimum row index (inclusive) */
  minRow: number;
  /** Maximum row index (inclusive) */
  maxRow: number;
  /** Minimum column index (inclusive) */
  minCol: number;
  /** Maximum column index (inclusive) */
  maxCol: number;
}

// ============================================================================
// Spatial Index Interface
// ============================================================================

/**
 * Spatial index for efficient range lookups.
 * Avoids O(n) scan of all schemas for every cell query.
 */
export interface IRangeSpatialIndex<T> {
  /**
   * Get all items whose ranges contain the given cell
   */
  getItemsForCell(row: number, col: number): Promise<T[]>;

  /**
   * Get all items whose ranges intersect the given viewport
   */
  getItemsInViewport(bounds: ViewportBounds): Promise<Map<string, T>>;

  /**
   * Rebuild the index (call when ranges change)
   */
  rebuild(items: T[]): void;
}
