/**
 * WorksheetPrint — Sub-API Interface for Print Settings and Page Breaks
 *
 * Methods for managing print settings, print area, and manual page breaks.
 */
import type { HeaderFooterImageInfo, HfImagePosition, PageMargins } from '@mog/types-core';
import type { PrintSettings } from '../types';

/** Sub-API for worksheet print and page break operations. */
export interface WorksheetPrint {
  /**
   * Get the current print settings for the sheet.
   *
   * @returns Current print settings
   */
  getSettings(): Promise<PrintSettings>;

  /**
   * Update print settings. Only the provided keys are changed.
   *
   * @param settings - Partial print settings to apply
   */
  setSettings(settings: Partial<PrintSettings>): Promise<void>;

  /**
   * Get the current print area as an A1-notation range string.
   *
   * @returns The print area range string, or null if no print area is set
   */
  getArea(): Promise<string | null>;

  /**
   * Set the print area to the specified A1-notation range.
   *
   * @param area - A1-notation range string (e.g., "A1:H20")
   */
  setArea(area: string): Promise<void>;

  /**
   * Clear the print area so the entire sheet prints.
   */
  clearArea(): Promise<void>;

  /**
   * Add a manual page break at the specified position.
   *
   * @param type - 'horizontal' (row break) or 'vertical' (column break)
   * @param position - 0-based row or column index for the break
   */
  addPageBreak(type: 'horizontal' | 'vertical', position: number): Promise<void>;

  /**
   * Remove a manual page break at the specified position.
   *
   * @param type - 'horizontal' or 'vertical'
   * @param position - 0-based row or column index of the break to remove
   */
  removePageBreak(type: 'horizontal' | 'vertical', position: number): Promise<void>;

  /**
   * Get all manual page breaks in the sheet.
   *
   * @returns Object containing arrays of horizontal and vertical break positions
   */
  getPageBreaks(): Promise<{
    rowBreaks: Array<{ id: number; min: number; max: number; manual: boolean; pt: boolean }>;
    colBreaks: Array<{ id: number; min: number; max: number; manual: boolean; pt: boolean }>;
  }>;

  /**
   * Remove all manual page breaks from the sheet.
   */
  clearPageBreaks(): Promise<void>;

  /**
   * Set the rows to repeat at the top of each printed page (print titles).
   *
   * @param startRow - 0-based start row index
   * @param endRow - 0-based end row index (inclusive)
   */
  setPrintTitleRows(startRow: number, endRow: number): Promise<void>;

  /**
   * Set the columns to repeat at the left of each printed page (print titles).
   *
   * @param startCol - 0-based start column index
   * @param endCol - 0-based end column index (inclusive)
   */
  setPrintTitleColumns(startCol: number, endCol: number): Promise<void>;

  /**
   * Get the rows configured to repeat at the top of each printed page.
   *
   * @returns A [startRow, endRow] tuple (0-based, inclusive), or null if no repeat rows are set
   */
  getPrintTitleRows(): Promise<[number, number] | null>;

  /**
   * Get the columns configured to repeat at the left of each printed page.
   *
   * @returns A [startCol, endCol] tuple (0-based, inclusive), or null if no repeat columns are set
   */
  getPrintTitleColumns(): Promise<[number, number] | null>;

  /**
   * Clear all print titles (both repeat rows and repeat columns).
   * Other print settings (margins, orientation, etc.) are preserved.
   */
  clearPrintTitles(): Promise<void>;

  /**
   * Set page margins with unit conversion.
   * Values are converted to inches (OOXML native unit) before storing.
   * Only provided margin fields are updated; others are preserved.
   *
   * @param unit - Unit of the provided values: 'inches', 'points', or 'centimeters'
   * @param options - Partial margin values to set
   */
  setPrintMargins(
    unit: 'inches' | 'points' | 'centimeters',
    options: Partial<PageMargins>,
  ): Promise<void>;

  /**
   * Get the cell position immediately after a page break.
   *
   * @param type - Break type: 'horizontal' (row break) or 'vertical' (column break)
   * @param position - 0-based row or column index of the break
   * @returns Cell coordinates of the first cell after the break
   */
  getCellAfterBreak(
    type: 'horizontal' | 'vertical',
    position: number,
  ): { row: number; col: number };

  /**
   * Get all header/footer images for this sheet.
   *
   * @returns Array of image info objects, one per occupied position
   */
  getHeaderFooterImages(): Promise<HeaderFooterImageInfo[]>;

  /**
   * Set or replace a header/footer image at the specified position.
   * The engine automatically manages the `&G` format code in the corresponding
   * header/footer string.
   *
   * @param info - Image info including position, src (data-URL or path), and dimensions
   */
  setHeaderFooterImage(info: HeaderFooterImageInfo): Promise<void>;

  /**
   * Remove the header/footer image at the specified position.
   * The engine automatically removes the `&G` format code from the corresponding
   * header/footer string.
   *
   * @param position - Which of the 6 header/footer positions to clear
   */
  removeHeaderFooterImage(position: HfImagePosition): Promise<void>;
}
