/**
 * Grid Coordinate System
 *
 * Provides coordinate conversions for the grid renderer:
 * - Cell to document space (pixel position of a cell)
 * - Document to cell space (cell at a pixel position)
 *
 * All positions are in document space (unzoomed CSS pixels from sheet origin).
 *
 * @module grid-renderer/layout/grid-coords
 */

import type { ViewportPositionIndex } from '../coordinates/viewport-position-index';

/** Result of converting a cell position to document space */
export interface CellDocumentRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Result of converting a document position to a cell */
export interface CellAddress {
  readonly row: number;
  readonly col: number;
}

/**
 * Grid coordinate system for cell <-> document space conversions.
 *
 * Stateless utility class. All state (dimensions, scroll, etc.) is passed
 * via parameters so the coordinate system is pure and testable.
 *
 * Uses ViewportPositionIndex for O(1) position/dimension lookups.
 */
export class GridCoordinateSystem {
  /**
   * Convert a cell position to document space coordinates.
   *
   * Returns the pixel position and dimensions of the cell in document space
   * (unzoomed, from sheet origin at 0,0).
   *
   * @param row - Row index
   * @param col - Column index
   * @param positionIndex - Viewport position index for O(1) lookups
   * @returns Cell position and size in document space
   */
  cellToDocument(row: number, col: number, positionIndex: ViewportPositionIndex): CellDocumentRect {
    const pi = positionIndex;

    const x = pi.getColLeft(col);
    const y = pi.getRowTop(row);
    const width = pi.getColWidth(col);
    const height = pi.getRowHeight(row);

    return { x, y, width, height };
  }

  /**
   * Convert a document space position to a cell address.
   *
   * Uses binary search to efficiently find the row and column at the given
   * document coordinates via the ViewportPositionIndex's typed array binary search.
   *
   * @param docX - X position in document space (CSS pixels, unzoomed)
   * @param docY - Y position in document space (CSS pixels, unzoomed)
   * @param positionIndex - Viewport position index for O(1) lookups
   * @returns The cell at the given document position
   */
  documentToCell(docX: number, docY: number, positionIndex: ViewportPositionIndex): CellAddress {
    const pi = positionIndex;

    // Try position index binary search first
    let row: number | null = null;
    let col: number | null = null;

    if (pi.hasData) {
      row = pi.findRowAtY(docY);
      col = pi.findColAtX(docX);
    }

    // Fall back to default-based estimation
    if (row === null) {
      row = this.findRowAtY(docY, pi);
    }
    if (col === null) {
      col = this.findColAtX(docX, pi);
    }

    return { row, col };
  }

  /**
   * Find the row at a given Y position using binary search.
   */
  private findRowAtY(y: number, pi: ViewportPositionIndex): number {
    const totalRows = pi.totalRows;
    if (totalRows === 0 || y <= 0) return 0;

    let low = 0;
    let high = totalRows - 1;

    while (low < high) {
      const mid = (low + high) >>> 1;
      const midTop = pi.getRowTop(mid);
      const midHeight = pi.getRowHeight(mid);

      if (y < midTop) {
        high = mid - 1;
      } else if (y >= midTop + midHeight) {
        low = mid + 1;
      } else {
        return mid;
      }
    }

    return low;
  }

  /**
   * Find the column at a given X position using binary search.
   */
  private findColAtX(x: number, pi: ViewportPositionIndex): number {
    const totalCols = pi.totalCols;
    if (totalCols === 0 || x <= 0) return 0;

    let low = 0;
    let high = totalCols - 1;

    while (low < high) {
      const mid = (low + high) >>> 1;
      const midLeft = pi.getColLeft(mid);
      const midWidth = pi.getColWidth(mid);

      if (x < midLeft) {
        high = mid - 1;
      } else if (x >= midLeft + midWidth) {
        low = mid + 1;
      } else {
        return mid;
      }
    }

    return low;
  }
}
