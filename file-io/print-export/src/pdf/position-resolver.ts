/**
 * Position Resolver — converts sheet coordinates to page coordinates.
 *
 * Floating objects (charts, drawings, images) are anchored to a sheet
 * row/col with optional pixel offsets. This module resolves those anchors
 * to absolute (pageIndex, x, y) positions within the paginated output.
 *
 * Used by chart-renderer, drawing-pdf-renderer, and image-renderer.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Floating object anchor — position in sheet coordinates.
 *
 * Maps to Excel's TwoCellAnchor / OneCellAnchor concept:
 * the object is pinned to the top-left corner of a cell (row, col)
 * with sub-cell offsets in points.
 */
export interface FloatingObjectAnchor {
  /** The sheet row where the top-left corner is anchored. */
  row: number;
  /** The sheet column where the top-left corner is anchored. */
  col: number;
  /** X offset from column start in points. */
  xOffset: number;
  /** Y offset from row start in points. */
  yOffset: number;
}

/**
 * Resolved page position — the output of anchor resolution.
 */
export interface ResolvedPosition {
  /** Which page this object lands on (0-indexed). */
  pageIndex: number;
  /** X coordinate within the page in points. */
  x: number;
  /** Y coordinate within the page in points. */
  y: number;
}

/**
 * Position resolver interface — converts sheet coordinates to page coordinates.
 *
 * Implementations must handle:
 * - Single-page documents (trivial case)
 * - Multi-page documents with horizontal and/or vertical splits
 * - Objects anchored outside any page slice (return null)
 */
export interface PositionResolver {
  /**
   * Resolve a sheet anchor to a page position.
   *
   * @param row      Sheet row of the anchor
   * @param col      Sheet column of the anchor
   * @param xOffset  Sub-cell X offset in points
   * @param yOffset  Sub-cell Y offset in points
   * @returns Resolved position, or null if the anchor is outside all pages
   */
  resolvePosition(
    row: number,
    col: number,
    xOffset: number,
    yOffset: number,
  ): ResolvedPosition | null;
}

// ============================================================================
// Page Slice
// ============================================================================

/**
 * A rectangular slice of the sheet that maps to one page.
 *
 * The pagination engine produces an array of these — one per page.
 * Rows are in [startRow, endRow) half-open range, columns likewise.
 */
export interface PageSlice {
  /** First row included in this page (inclusive). */
  startRow: number;
  /** First row NOT included (exclusive). */
  endRow: number;
  /** First column included (inclusive). */
  startCol: number;
  /** First column NOT included (exclusive). */
  endCol: number;
  /** X offset of this slice's origin on the page, in points. */
  offsetX: number;
  /** Y offset of this slice's origin on the page, in points. */
  offsetY: number;
  /** 0-indexed page number this slice belongs to. */
  pageIndex: number;
}

// ============================================================================
// Default Implementation
// ============================================================================

/**
 * Default position resolver that uses row heights, column widths,
 * and a set of page slices produced by the pagination engine.
 *
 * Algorithm:
 * 1. Find the first PageSlice whose row/col range contains the anchor.
 * 2. Sum column widths from the slice's startCol to the anchor col.
 * 3. Sum row heights from the slice's startRow to the anchor row.
 * 4. Add the sub-cell offsets and the slice's page offset.
 */
export class DefaultPositionResolver implements PositionResolver {
  /** Default row height when not specified (points). */
  private static readonly DEFAULT_ROW_HEIGHT = 20;
  /** Default column width when not specified (points). */
  private static readonly DEFAULT_COL_WIDTH = 64;

  /** Precomputed cumulative row heights: cumulativeRowHeights[i] = sum of heights for rows 0..i-1 */
  private cumulativeRowHeights: number[];
  /** Precomputed cumulative column widths: cumulativeColWidths[i] = sum of widths for cols 0..i-1 */
  private cumulativeColWidths: number[];

  constructor(
    /** Array of row heights in points, indexed by row number. */
    rowHeights: number[],
    /** Array of column widths in points, indexed by column number. */
    colWidths: number[],
    /** Page slices from the pagination engine. */
    private pageSlices: PageSlice[],
  ) {
    // Determine the extent we need to cover
    let maxRow = rowHeights.length;
    let maxCol = colWidths.length;
    for (const slice of pageSlices) {
      if (slice.endRow > maxRow) maxRow = slice.endRow;
      if (slice.endCol > maxCol) maxCol = slice.endCol;
    }

    // Precompute cumulative sums for O(1) range queries
    this.cumulativeRowHeights = new Array(maxRow + 1).fill(0);
    for (let i = 0; i < maxRow; i++) {
      this.cumulativeRowHeights[i + 1] =
        this.cumulativeRowHeights[i] +
        (rowHeights[i] ?? DefaultPositionResolver.DEFAULT_ROW_HEIGHT);
    }

    this.cumulativeColWidths = new Array(maxCol + 1).fill(0);
    for (let i = 0; i < maxCol; i++) {
      this.cumulativeColWidths[i + 1] =
        this.cumulativeColWidths[i] + (colWidths[i] ?? DefaultPositionResolver.DEFAULT_COL_WIDTH);
    }
  }

  resolvePosition(
    row: number,
    col: number,
    xOffset: number,
    yOffset: number,
  ): ResolvedPosition | null {
    // Find the first page slice that contains this row/col
    for (const slice of this.pageSlices) {
      if (
        row >= slice.startRow &&
        row < slice.endRow &&
        col >= slice.startCol &&
        col < slice.endCol
      ) {
        // O(1) lookup using precomputed cumulative sums
        const x =
          slice.offsetX +
          xOffset +
          (this.cumulativeColWidths[col] - this.cumulativeColWidths[slice.startCol]);
        const y =
          slice.offsetY +
          yOffset +
          (this.cumulativeRowHeights[row] - this.cumulativeRowHeights[slice.startRow]);

        return { pageIndex: slice.pageIndex, x, y };
      }
    }

    // Anchor is outside all page slices
    return null;
  }
}
