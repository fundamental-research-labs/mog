/**
 * WorksheetFormats — Sub-API for cell formatting operations.
 *
 * Provides methods to get, set, and clear cell formats, as well as
 * apply format patterns across ranges (Format Painter).
 */
import type { CellFormat, CellRange, FormatChangeResult, ResolvedCellFormat } from '../types';
import type { NumberFormatType } from '@mog/types-core/core';

/** Sub-API for cell formatting operations on a worksheet. */
export interface WorksheetFormats {
  /**
   * Set format for a single cell.
   *
   * @param address - A1-style cell address (e.g. "A1", "B3")
   * @param format - Format properties to apply
   *
   * @example
   * // Bold red currency
   * await ws.formats.set('A1', { bold: true, fontColor: '#ff0000', numberFormat: '$#,##0.00' });
   * // Date format
   * await ws.formats.set('B1', { numberFormat: 'YYYY-MM-DD' });
   * // Header style
   * await ws.formats.set('A1', { bold: true, fontSize: 14, backgroundColor: '#4472c4', fontColor: '#ffffff' });
   */
  set(address: string, format: CellFormat): Promise<FormatChangeResult>;
  /**
   * Set format for a single cell.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @param format - Format properties to apply
   */
  set(row: number, col: number, format: CellFormat): Promise<FormatChangeResult>;

  /**
   * Set format for a contiguous range.
   *
   * @param range - A1-style range string (e.g. "A1:B2")
   * @param format - Format properties to apply
   *
   * @example
   * // Currency column
   * await ws.formats.setRange('B2:B100', { numberFormat: '$#,##0.00' });
   * // Header row with borders
   * await ws.formats.setRange('A1:F1', {
   *   bold: true,
   *   backgroundColor: '#4472c4',
   *   fontColor: '#ffffff',
   *   borders: { bottom: { style: 'medium', color: '#2f5496' } }
   * });
   */
  setRange(range: string, format: CellFormat): Promise<FormatChangeResult>;
  /**
   * Set format for a contiguous range.
   *
   * @param range - Range object with start/end row and column
   * @param format - Format properties to apply
   */
  setRange(range: CellRange, format: CellFormat): Promise<FormatChangeResult>;

  /**
   * Set format for multiple ranges, with full row/column optimization.
   *
   * @param ranges - Array of range objects
   * @param format - Format properties to apply
   */
  setRanges(ranges: CellRange[], format: CellFormat): Promise<void>;

  /**
   * Check if a cell has explicit formatting applied (not just inherited from row/column/sheet).
   *
   * Returns true if the cell has any non-default explicit format properties set directly
   * on it. Returns false if the cell only inherits formatting from the row, column,
   * or sheet cascade.
   *
   * @param address - A1-style cell address
   * @returns True if the cell has explicit formatting
   */
  hasExplicit(address: string): Promise<boolean>;
  /**
   * Check if a cell has explicit formatting applied (not just inherited from row/column/sheet).
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @returns True if the cell has explicit formatting
   */
  hasExplicit(row: number, col: number): Promise<boolean>;

  /**
   * Clear format from a single cell, resetting it to default.
   *
   * @param address - A1-style cell address
   */
  clearCell(address: string): Promise<void>;
  /**
   * Clear format from a single cell, resetting it to default.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   */
  clearCell(row: number, col: number): Promise<void>;

  /**
   * Clear all cell formats in the worksheet, resetting to defaults.
   */
  clear(): Promise<void>;

  /**
   * Clear all format properties from cells in a contiguous range.
   *
   * Unlike `setRange(range, {})` which merges (and leaves existing properties untouched),
   * this removes all explicit formatting, resetting cells to the inherited cascade.
   *
   * @param range - A1-style range string (e.g. "A1:B2")
   */
  clearRange(range: string): Promise<void>;
  /**
   * Clear all format properties from cells in a contiguous range.
   *
   * @param range - Range object with start/end row and column
   */
  clearRange(range: CellRange): Promise<void>;

  /**
   * Clear all format properties from cells in multiple ranges.
   *
   * @param ranges - Array of range objects
   */
  clearRanges(ranges: CellRange[]): Promise<void>;

  /**
   * Get the fully-resolved format of a single cell.
   *
   * Returns a dense CellFormat with all fields present (null for unset properties,
   * never undefined). Includes the full cascade (default → col → row → table → cell → CF)
   * with theme colors resolved to hex.
   *
   * @param address - A1-style cell address
   * @returns The resolved cell format (always an object, never null)
   */
  get(address: string): Promise<ResolvedCellFormat>;
  /**
   * Get the fully-resolved format of a single cell.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @returns The resolved cell format (always an object, never null)
   */
  get(row: number, col: number): Promise<ResolvedCellFormat>;

  /**
   * Get the fully-resolved displayed format of a single cell.
   *
   * Includes the full 6-layer cascade (default → col → row → table → cell → CF)
   * with theme colors resolved to hex. Unlike `get()`, this includes the
   * conditional formatting overlay.
   *
   * @param address - A1-style cell address
   * @returns The displayed cell format with CF applied
   */
  getDisplayedCellProperties(address: string): Promise<CellFormat>;
  /**
   * Get the fully-resolved displayed format of a single cell.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   */
  getDisplayedCellProperties(row: number, col: number): Promise<CellFormat>;

  /**
   * Get displayed formats for a rectangular range.
   *
   * Each element includes the full 6-layer cascade with CF overlay.
   * Maximum 10,000 cells per call.
   *
   * @param range - A1-style range string (e.g. "A1:C3")
   * @returns 2D array of displayed cell formats
   */
  getDisplayedRangeProperties(range: string | CellRange): Promise<CellFormat[][]>;

  /**
   * Adjust the indent level of a cell by a relative amount.
   *
   * @param address - A1-style cell address
   * @param amount - Relative indent change (positive to increase, negative to decrease)
   */
  adjustIndent(address: string, amount: number): Promise<void>;
  /**
   * Adjust the indent level of a cell by a relative amount.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @param amount - Relative indent change (positive to increase, negative to decrease)
   */
  adjustIndent(row: number, col: number, amount: number): Promise<void>;

  /**
   * Clear only fill properties of a cell (backgroundColor, patternType, patternForegroundColor, gradientFill).
   * Unlike `clearCell()`, this preserves font, alignment, borders, and other formatting.
   *
   * @param address - A1-style cell address
   */
  clearFill(address: string): Promise<void>;
  /**
   * Clear only fill properties of a cell.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   */
  clearFill(row: number, col: number): Promise<void>;

  /**
   * Clear only fill properties for multiple ranges.
   * Preserves font, alignment, borders, and other formatting via read-modify-write.
   */
  clearFillForRanges(ranges: CellRange[]): Promise<void>;

  /**
   * Get the auto-derived number format category for a cell based on its format code.
   *
   * @param address - A1-style cell address
   * @returns The detected NumberFormatType category
   */
  getNumberFormatCategory(address: string): Promise<NumberFormatType>;
  /**
   * Get the auto-derived number format category for a cell based on its format code.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @returns The detected NumberFormatType category
   */
  getNumberFormatCategory(row: number, col: number): Promise<NumberFormatType>;

  /**
   * Get the locale-aware number format for a cell (spreadsheet special-cell typeRange.numberFormatLocal equivalent).
   *
   * Resolves the `[$-LCID]` token in the stored format code and transforms
   * separators to match the locale's conventions. For example, a cell with
   * format `[$-407]#,##0.00` returns `#.##0,00` (German conventions).
   *
   * If no LCID token is present, returns the raw format code unchanged.
   *
   * @param address - A1-style cell address
   * @returns The locale-resolved format string
   */
  getNumberFormatLocal(address: string): Promise<string>;
  /**
   * Get the locale-aware number format for a cell.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @returns The locale-resolved format string
   */
  getNumberFormatLocal(row: number, col: number): Promise<string>;

  /**
   * Set the locale-aware number format for a cell (spreadsheet special-cell typeRange.numberFormatLocal equivalent).
   *
   * Encodes the locale-specific format by prepending the appropriate `[$-LCID]`
   * token and transforming separators to internal (en-US) conventions.
   *
   * For example, setting `#.##0,00` with locale `de-DE` stores `[$-407]#,##0.00`.
   *
   * @param address - A1-style cell address
   * @param localFormat - The locale-specific format string
   * @param locale - BCP-47 locale tag (e.g., "de-DE", "fr-FR")
   */
  setNumberFormatLocal(address: string, localFormat: string, locale: string): Promise<void>;
  /**
   * Set the locale-aware number format for a cell.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @param localFormat - The locale-specific format string
   * @param locale - BCP-47 locale tag (e.g., "de-DE", "fr-FR")
   */
  setNumberFormatLocal(
    row: number,
    col: number,
    localFormat: string,
    locale: string,
  ): Promise<void>;

  /**
   * Apply a format pattern from a source range to a target range.
   *
   * When the target range is larger than the source range, the source format
   * pattern is tiled to fill the target (like Excel's Format Painter with
   * multi-cell sources).
   *
   * @param format - The base format to apply (used when sourceRange is null or single-cell)
   * @param sourceRange - Source range for pattern replication, or null for simple application
   * @param targetRange - Target range to apply formats to
   */
  applyPattern(
    format: CellFormat,
    sourceRange: CellRange | null,
    targetRange: CellRange,
  ): Promise<void>;

  // ---------------------------------------------------------------------------
  // Bulk Property Operations (row / column / cell-level CRUD)
  // ---------------------------------------------------------------------------

  /**
   * Get effective (resolved) cell formats for a rectangular range.
   *
   * Returns a 2D array (row-major) where each element is the fully resolved
   * format from the 5-layer cascade (default -> col -> row -> table -> cell).
   * Cells with no explicit format may return null.
   *
   * @param range - A1-style range string (e.g. "A1:C3")
   * @returns 2D array of CellFormat (or null for cells with default format)
   */
  getCellProperties(range: string): Promise<Array<Array<CellFormat | null>>>;
  /**
   * Get effective (resolved) cell formats for a rectangular range.
   *
   * @param startRow - Start row (0-based)
   * @param startCol - Start column (0-based)
   * @param endRow - End row (0-based, inclusive)
   * @param endCol - End column (0-based, inclusive)
   * @returns 2D array of CellFormat (or null for cells with default format)
   */
  getCellProperties(
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
  ): Promise<Array<Array<CellFormat | null>>>;

  /**
   * Set cell formats for a batch of individual cells with heterogeneous formats.
   *
   * Unlike setRange (which applies one format to all cells), this allows each
   * cell to receive a different format. Formats merge with existing cell formats
   * on a per-property basis.
   *
   * @param updates - Array of {row, col, format} entries
   */
  setCellProperties(
    updates: Array<{ row: number; col: number; format: Partial<CellFormat> }>,
  ): Promise<void>;

  /**
   * Get row-level formats for the specified rows.
   *
   * Returns a Map from row index to CellFormat (only rows with explicit
   * formats are included; rows with no format are omitted).
   *
   * @param rows - Row indices (0-based)
   * @returns Map of row index to CellFormat
   */
  getRowProperties(rows: number[]): Promise<Map<number, CellFormat>>;

  /**
   * Set row-level formats for multiple rows.
   *
   * Formats merge with existing row formats on a per-property basis.
   *
   * @param updates - Map of row index to format properties
   */
  setRowProperties(updates: Map<number, Partial<CellFormat>>): Promise<void>;

  /**
   * Get column-level formats for the specified columns.
   *
   * Returns a Map from column index to CellFormat (only columns with
   * explicit formats are included).
   *
   * @param cols - Column indices (0-based)
   * @returns Map of column index to CellFormat
   */
  getColumnProperties(cols: number[]): Promise<Map<number, CellFormat>>;

  /**
   * Set column-level formats for multiple columns.
   *
   * Formats merge with existing column formats on a per-property basis.
   *
   * @param updates - Map of column index to format properties
   */
  setColumnProperties(updates: Map<number, Partial<CellFormat>>): Promise<void>;
}
