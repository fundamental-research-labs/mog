/**
 * WorksheetHyperlinks — Sub-API for cell hyperlink operations.
 *
 * Provides methods to set, get, and remove hyperlinks on cells.
 */

/** Public readback for a worksheet hyperlink. */
export interface WorksheetHyperlink {
  /** A1-style cell address or range reference. */
  address: string;
  /** A1-style cell address or range reference. Alias for `address`. */
  ref: string;
  /** Hyperlink target URL or workbook location. */
  url: string;
  /** Optional display text stored with the hyperlink. */
  display?: string;
  /** Optional tooltip text stored with the hyperlink. */
  tooltip?: string;
}

/** Sub-API for hyperlink operations on a worksheet. */
export interface WorksheetHyperlinks {
  /**
   * Set a hyperlink on a cell.
   *
   * @param address - A1-style cell address (e.g. "A1")
   * @param url - Hyperlink URL
   */
  set(address: string, url: string): Promise<void>;
  /**
   * Set a hyperlink on a cell.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @param url - Hyperlink URL
   */
  set(row: number, col: number, url: string): Promise<void>;

  /**
   * Get the hyperlink URL for a cell.
   *
   * @param address - A1-style cell address
   * @returns The hyperlink URL, or null if no hyperlink
   */
  get(address: string): Promise<string | null>;
  /**
   * Get the hyperlink URL for a cell.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @returns The hyperlink URL, or null if no hyperlink
   */
  get(row: number, col: number): Promise<string | null>;

  /**
   * Check if a cell has a hyperlink.
   *
   * @param address - A1-style cell address
   * @returns True if the cell has a hyperlink
   */
  has(address: string): Promise<boolean>;
  /**
   * Check if a cell has a hyperlink.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @returns True if the cell has a hyperlink
   */
  has(row: number, col: number): Promise<boolean>;

  /**
   * Remove a hyperlink from a cell.
   *
   * @param address - A1-style cell address
   */
  remove(address: string): Promise<void>;
  /**
   * Remove a hyperlink from a cell.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   */
  remove(row: number, col: number): Promise<void>;

  /**
   * List all hyperlinks in the worksheet.
   *
   * @returns Array of hyperlink entries with cell address, URL, and metadata
   */
  list(): Promise<WorksheetHyperlink[]>;

  /**
   * Remove all hyperlinks from the worksheet.
   */
  clear(): Promise<void>;
}
