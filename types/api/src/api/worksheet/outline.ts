/**
 * WorksheetOutline — Sub-API for row/column grouping and outline operations.
 *
 * Provides methods to group/ungroup rows and columns, manage collapse state,
 * apply subtotals, and configure outline settings.
 */
import type { GroupState, OutlineSettings, SubtotalConfig, SubtotalResult } from '../types';

/** Sub-API for outline (row/column grouping) operations on a worksheet. */
export interface WorksheetOutline {
  /**
   * Group rows in a range.
   *
   * @param startRow - Start row index (0-based, inclusive)
   * @param endRow - End row index (0-based, inclusive)
   */
  groupRows(startRow: number, endRow: number): Promise<void>;

  /**
   * Ungroup rows in a range.
   *
   * @param startRow - Start row index (0-based, inclusive)
   * @param endRow - End row index (0-based, inclusive)
   */
  ungroupRows(startRow: number, endRow: number): Promise<void>;

  /**
   * Group columns in a range.
   *
   * @param startCol - Start column index (0-based, inclusive)
   * @param endCol - End column index (0-based, inclusive)
   */
  groupColumns(startCol: number, endCol: number): Promise<void>;

  /**
   * Ungroup columns in a range.
   *
   * @param startCol - Start column index (0-based, inclusive)
   * @param endCol - End column index (0-based, inclusive)
   */
  ungroupColumns(startCol: number, endCol: number): Promise<void>;

  /**
   * Toggle the collapsed state of a group.
   *
   * @param groupId - Group identifier
   */
  toggleCollapsed(groupId: string): Promise<void>;

  /**
   * Expand all groups in the worksheet.
   */
  expandAll(): Promise<void>;

  /**
   * Collapse all groups in the worksheet.
   */
  collapseAll(): Promise<void>;

  /**
   * Get the full group state for the worksheet.
   *
   * @returns Group state including row groups, column groups, and max levels
   */
  getState(): Promise<GroupState>;

  /**
   * Get the outline level of a specific row or column.
   *
   * @param type - Whether to query a row or column
   * @param index - Row or column index (0-based)
   * @returns The outline level (0 if not in any group)
   */
  getLevel(type: 'row' | 'column', index: number): Promise<number>;

  /**
   * Get the maximum outline level for rows or columns.
   *
   * @param type - Whether to query rows or columns
   * @returns The maximum outline level
   */
  getMaxLevel(type: 'row' | 'column'): Promise<number>;

  /**
   * Apply automatic subtotals.
   *
   * @param config - Subtotal configuration
   */
  subtotal(config: SubtotalConfig): Promise<SubtotalResult>;

  /**
   * Get the outline display settings.
   *
   * @returns Current outline settings
   */
  getSettings(): Promise<OutlineSettings>;

  /**
   * Update outline display settings.
   *
   * @param settings - Partial outline settings to update
   */
  setSettings(settings: Partial<OutlineSettings>): Promise<void>;

  /**
   * Show outline to a specific level for rows and/or columns.
   * Groups at levels > the specified level are collapsed; groups at levels <= are expanded.
   * Pass 0 to collapse all, or a number > maxLevel to expand all.
   *
   * @param rowLevels - Target outline level for rows (0 = collapse all rows)
   * @param colLevels - Target outline level for columns (0 = collapse all columns)
   */
  showOutlineLevels(rowLevels: number, colLevels: number): Promise<void>;
}
