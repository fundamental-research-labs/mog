/**
 * WorksheetLayout — Sub-API for row/column dimension and visibility operations.
 *
 * Provides methods to read and modify row heights, column widths,
 * row/column visibility (hide/unhide), and pixel position queries.
 */

import type { CellRange } from '../types';

/** Pixel bounds of a range (top/left offset from worksheet origin, height, width). */
export interface RangePixelPosition {
  /** Pixel offset of the range's top edge from the worksheet origin */
  top: number;
  /** Pixel offset of the range's left edge from the worksheet origin */
  left: number;
  /** Height of the range in pixels */
  height: number;
  /** Width of the range in pixels */
  width: number;
}

/** Sub-API for row/column layout operations on a worksheet. */
export interface WorksheetLayout {
  /**
   * Get the height of a row in pixels.
   *
   * @param row - Row index (0-based)
   * @returns Row height in pixels
   */
  getRowHeight(row: number): Promise<number>;

  /**
   * Set the height of a row.
   *
   * @param row - Row index (0-based)
   * @param height - Height in pixels (must be > 0)
   */
  setRowHeight(row: number, height: number): Promise<void>;

  /**
   * Get the width of a column in pixels.
   *
   * @param col - Column index (0-based)
   * @returns Column width in pixels
   */
  getColumnWidth(col: number): Promise<number>;

  /**
   * Set the width of a column in pixels.
   *
   * @param col - Column index (0-based)
   * @param widthPx - Width in pixels (must be > 0)
   */
  setColumnWidth(col: number, widthPx: number): Promise<void>;

  /**
   * Get the width of a column in character-width units
   * (relative to the Normal style font's maximum digit width, matching OOXML/Excel convention).
   *
   * @param col - Column index (0-based)
   * @returns Column width in character-width units
   */
  getColumnWidthChars(col: number): Promise<number>;

  /**
   * Set the width of a column in character-width units
   * (relative to the Normal style font's maximum digit width, matching OOXML/Excel convention).
   *
   * @param col - Column index (0-based)
   * @param widthChars - Width in character-width units (must be > 0)
   */
  setColumnWidthChars(col: number, widthChars: number): Promise<void>;

  /**
   * Set multiple column widths in pixels.
   *
   * @param widths - Array of [columnIndex, widthPx] pairs
   */
  setColumnWidths(widths: Array<[number, number]>): Promise<void>;

  /**
   * Set multiple column widths in character-width units.
   *
   * @param widths - Array of [columnIndex, widthChars] pairs
   */
  setColumnWidthsChars(widths: Array<[number, number]>): Promise<void>;

  /**
   * Auto-fit a column width to its content.
   *
   * @param col - Column index (0-based)
   */
  autoFitColumn(col: number): Promise<void>;

  /**
   * Auto-fit multiple columns to their content in a single batch call.
   *
   * @param cols - Array of column indices (0-based)
   */
  autoFitColumns(cols: number[]): Promise<void>;

  /**
   * Auto-fit a row height to its content.
   *
   * @param row - Row index (0-based)
   */
  autoFitRow(row: number): Promise<void>;

  /**
   * Auto-fit multiple rows to their content in a single batch call.
   *
   * @param rows - Array of row indices (0-based)
   */
  autoFitRows(rows: number[]): Promise<void>;

  /**
   * Get row heights for a range of rows.
   *
   * @param startRow - Start row index (0-based, inclusive)
   * @param endRow - End row index (0-based, inclusive)
   * @returns Array of [rowIndex, height] pairs
   */
  getRowHeightsBatch(startRow: number, endRow: number): Promise<Array<[number, number]>>;

  /**
   * Get column widths for a range of columns in pixels.
   *
   * @param startCol - Start column index (0-based, inclusive)
   * @param endCol - End column index (0-based, inclusive)
   * @returns Array of [colIndex, widthPx] pairs
   */
  getColWidthsBatch(startCol: number, endCol: number): Promise<Array<[number, number]>>;

  /**
   * Get column widths for a range of columns in character-width units
   * (relative to the Normal style font's maximum digit width, matching OOXML/Excel convention).
   *
   * @param startCol - Start column index (0-based, inclusive)
   * @param endCol - End column index (0-based, inclusive)
   * @returns Array of [colIndex, charWidth] pairs
   */
  getColWidthsBatchChars(startCol: number, endCol: number): Promise<Array<[number, number]>>;

  /**
   * Set the visibility of a single row.
   *
   * @param row - Row index (0-based)
   * @param visible - True to show, false to hide
   */
  setRowVisible(row: number, visible: boolean): Promise<void>;

  /**
   * Set the visibility of a single column.
   *
   * @param col - Column index (0-based)
   * @param visible - True to show, false to hide
   */
  setColumnVisible(col: number, visible: boolean): Promise<void>;

  /**
   * Check whether a row is hidden.
   *
   * @param row - Row index (0-based)
   * @returns True if the row is hidden
   */
  isRowHidden(row: number): Promise<boolean>;

  /**
   * Check whether a column is hidden.
   *
   * @param col - Column index (0-based)
   * @returns True if the column is hidden
   */
  isColumnHidden(col: number): Promise<boolean>;

  /**
   * Unhide all rows in a range.
   *
   * @param startRow - Start row index (0-based, inclusive)
   * @param endRow - End row index (0-based, inclusive)
   */
  unhideRows(startRow: number, endRow: number): Promise<void>;

  /**
   * Unhide all columns in a range.
   *
   * @param startCol - Start column index (0-based, inclusive)
   * @param endCol - End column index (0-based, inclusive)
   */
  unhideColumns(startCol: number, endCol: number): Promise<void>;

  /**
   * Hide multiple rows by index.
   *
   * @param rows - Array of row indices to hide (0-based)
   */
  hideRows(rows: number[]): Promise<void>;

  /**
   * Hide multiple columns by index.
   *
   * @param cols - Array of column indices to hide (0-based)
   */
  hideColumns(cols: number[]): Promise<void>;

  /**
   * Get the set of all hidden row indices.
   *
   * @returns Set of hidden row indices
   */
  getHiddenRowsBitmap(): Promise<Set<number>>;

  /**
   * Get the set of row indices hidden by active filters.
   *
   * This excludes rows hidden only by manual row visibility or structural
   * grouping, and is used by visible-cell copy/export paths.
   *
   * @returns Set of filter-hidden row indices
   */
  getFilterHiddenRowsBitmap(): Promise<Set<number>>;

  /**
   * Get the set of all hidden column indices.
   *
   * @returns Set of hidden column indices
   */
  getHiddenColumnsBitmap(): Promise<Set<number>>;

  /**
   * Reset a row's height to the sheet default.
   *
   * @param row - Row index (0-based)
   */
  resetRowHeight(row: number): Promise<void>;

  /**
   * Reset a column's width to the sheet default.
   *
   * @param col - Column index (0-based)
   */
  resetColumnWidth(col: number): Promise<void>;

  // ===========================================================================
  // Pixel position queries (spreadsheet special-cell typeRange.top / .left / .height / .width)
  // ===========================================================================

  /**
   * Get the pixel offset of a row's top edge from the worksheet origin.
   *
   * @param row - Row index (0-based)
   * @returns Pixel offset from the top of the worksheet
   */
  getRowPosition(row: number): Promise<number>;

  /**
   * Get the pixel offset of a column's left edge from the worksheet origin.
   *
   * @param col - Column index (0-based)
   * @returns Pixel offset from the left of the worksheet
   */
  getColPosition(col: number): Promise<number>;

  /**
   * Get the pixel bounds of a range (top, left, height, width).
   *
   * Returns range pixel bounds in a single call.
   *
   * @param range - The cell range to measure
   * @returns Pixel bounds relative to the worksheet origin
   */
  getRangePosition(range: CellRange): Promise<RangePixelPosition>;
}
