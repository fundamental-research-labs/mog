/**
 * WorksheetStyles — Sub-API for named cell style operations.
 *
 * Provides methods to apply and query named cell styles on a worksheet.
 * Named styles are defined at the workbook level (wb.styles) and applied
 * at the worksheet level via this sub-API.
 *
 * Note: Mog copies format values to cells rather than storing a style reference.
 * getStyle() is a best-effort reverse lookup that matches cell format against
 * known style formats.
 */
import type { CellRange } from '../types';

/** Sub-API for named cell style operations on a worksheet. */
export interface WorksheetStyles {
  /**
   * Apply a named style to a cell.
   * Resolves the style name to its format definition and applies all format
   * properties to the target cell.
   *
   * @param address - A1-style cell address
   * @param styleName - Name of the style to apply (e.g., "Normal", "Heading 1")
   * @throws KernelError if style name is not found
   */
  applyStyle(address: string, styleName: string): Promise<void>;

  /**
   * Apply a named style to a range.
   *
   * @param range - A1-style range string (e.g. "A1:C3")
   * @param styleName - Name of the style to apply
   * @throws KernelError if style name is not found
   */
  applyStyleToRange(range: string | CellRange, styleName: string): Promise<void>;

  /**
   * Get the name of the named style that matches a cell's format (best-effort).
   *
   * Since Mog copies format values rather than storing a style reference,
   * this performs a reverse lookup by comparing the cell's current format
   * against all known style formats.
   *
   * @param address - A1-style cell address
   * @returns Style name if a matching style is found, null otherwise
   */
  getStyle(address: string): Promise<string | null>;

  /**
   * Get the name of the named style that matches a cell's format.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   */
  getStyle(row: number, col: number): Promise<string | null>;
}
