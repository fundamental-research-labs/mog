/**
 * WorksheetView — Sub-API for worksheet view and display options.
 *
 * Provides methods to manage freeze panes, split view configuration,
 * gridlines, headings, tab color, and general view options.
 */
import type { SplitViewportConfig } from '@mog/types-viewport/viewport-config';
import type { ScrollPosition, ViewOptions } from '../types';

/** Sub-API for worksheet view and display operations. */
export interface WorksheetView {
  /**
   * Freeze the top N rows. Preserves any existing column freeze.
   *
   * @param count - Number of rows to freeze (0 to unfreeze rows)
   */
  freezeRows(count: number): Promise<void>;

  /**
   * Freeze the left N columns. Preserves any existing row freeze.
   *
   * @param count - Number of columns to freeze (0 to unfreeze columns)
   */
  freezeColumns(count: number): Promise<void>;

  /**
   * Freeze rows and columns simultaneously.
   *
   * This is the atomic form of Freeze Panes. The first unfrozen cell is at
   * (rows, cols): for example, freezePanes(1, 1) freezes row 0 and column 0.
   *
   * @param rows - Number of top rows to freeze (0 to freeze no rows)
   * @param cols - Number of left columns to freeze (0 to freeze no columns)
   */
  freezePanes(rows: number, cols: number): Promise<void>;

  /**
   * Compatibility alias for freezePanes(rows, cols).
   *
   * Agent-discovered API workflows may refer to this operation by the storage
   * route name. Prefer freezePanes for new code.
   *
   * @param rows - Number of top rows to freeze (0 to freeze no rows)
   * @param cols - Number of left columns to freeze (0 to freeze no columns)
   */
  setFrozenPanes(rows: number, cols: number): Promise<void>;

  /**
   * Remove all frozen panes (both rows and columns).
   */
  unfreeze(): Promise<void>;

  /**
   * Get the current frozen panes configuration.
   *
   * @returns Object with the number of frozen rows and columns
   */
  getFrozenPanes(): Promise<{ rows: number; cols: number }>;

  /**
   * Freeze rows and columns simultaneously using a range reference.
   * The top-left cell of the range becomes the first unfrozen cell.
   * For example, freezeAt("B3") freezes 2 rows and 1 column.
   *
   * @param range - A cell reference (e.g., "B3") indicating the split point
   */
  freezeAt(range: string): Promise<void>;

  /**
   * Get the current split view configuration.
   *
   * @returns The split configuration, or null if the view is not split
   */
  getSplitConfig(): Promise<SplitViewportConfig | null>;

  /**
   * Set or clear the split view configuration.
   *
   * @param config - Split configuration to apply, or null to remove split
   */
  setSplitConfig(config: SplitViewportConfig | null): Promise<void>;

  /**
   * Show or hide gridlines.
   *
   * @param show - True to show gridlines, false to hide
   */
  setGridlines(show: boolean): Promise<void>;

  /**
   * Show or hide row/column headings.
   *
   * @param show - True to show headings, false to hide
   */
  setHeadings(show: boolean): Promise<void>;

  /**
   * Get the current view options (gridlines, headings).
   *
   * @returns Current view options
   */
  getViewOptions(): Promise<ViewOptions>;

  /**
   * Show formula source text in cells instead of calculated display values.
   *
   * This is a persisted per-sheet view option.
   *
   * @param show - True to show formulas, false to show calculated values
   */
  setShowFormulas(show: boolean): Promise<void>;

  /**
   * Get the tab color of this worksheet.
   *
   * @returns The tab color as a hex string, or null if no color is set
   */
  getTabColor(): Promise<string | null>;

  /**
   * Set or clear the tab color for this worksheet.
   *
   * @param color - Hex color string, or null to clear
   */
  setTabColor(color: string | null): Promise<void>;

  /** Get the persistent scroll position (cell-level) for this sheet. */
  getScrollPosition(): Promise<ScrollPosition>;

  /** Set the persistent scroll position (cell-level) for this sheet. */
  setScrollPosition(topRow: number, leftCol: number): Promise<void>;
}
