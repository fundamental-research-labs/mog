/**
 * WorksheetSparklines — Sub-API for sparkline operations.
 *
 * Provides methods to add, query, update, and remove sparklines and
 * sparkline groups on a worksheet.
 */
import type {
  CreateSparklineGroupOptions,
  CreateSparklineOptions,
  Sparkline,
  SparklineGroup,
  SparklineType,
} from '@mog/types-data/data/sparklines';
import type { CellRange } from '../types';

/** Sub-API for sparkline operations on a worksheet. */
export interface WorksheetSparklines {
  /**
   * Add a sparkline to a cell (A1 address form).
   *
   * @param cell - A1-style cell address (e.g. "B1")
   * @param dataRange - Data range (A1-style string or CellRange)
   * @param type - Sparkline type (line, column, winLoss)
   * @param options - Optional creation settings
   * @returns The created sparkline
   */
  add(
    cell: string,
    dataRange: string | CellRange,
    type: SparklineType,
    options?: CreateSparklineOptions,
  ): Promise<Sparkline>;
  /**
   * Add a sparkline to a cell (numeric row/col form).
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @param dataRange - Data range (A1-style string or CellRange)
   * @param type - Sparkline type (line, column, winLoss)
   * @param options - Optional creation settings
   * @returns The created sparkline
   */
  add(
    row: number,
    col: number,
    dataRange: string | CellRange,
    type: SparklineType,
    options?: CreateSparklineOptions,
  ): Promise<Sparkline>;
  /**
   * Add a sparkline to a cell (object form, legacy).
   *
   * @param cell - Cell position object
   * @param dataRange - Data range (A1-style string or CellRange)
   * @param type - Sparkline type (line, column, winLoss)
   * @param options - Optional creation settings
   * @returns The created sparkline
   */
  add(
    cell: { row: number; col: number },
    dataRange: string | CellRange,
    type: SparklineType,
    options?: CreateSparklineOptions,
  ): Promise<Sparkline>;

  /**
   * Add a group of sparklines with shared settings.
   *
   * @param cells - Array of cell positions
   * @param dataRanges - Array of data ranges (must match cells length)
   * @param type - Sparkline type
   * @param options - Optional group creation settings
   * @returns The created sparkline group
   */
  addGroup(
    cells: Array<{ row: number; col: number }>,
    dataRanges: CellRange[],
    type: SparklineType,
    options?: CreateSparklineGroupOptions,
  ): Promise<SparklineGroup>;

  /**
   * Get a sparkline by ID.
   *
   * @param sparklineId - Sparkline identifier
   * @returns The sparkline, or null if not found
   */
  get(sparklineId: string): Promise<Sparkline | null>;

  /**
   * Get the sparkline at a specific cell.
   *
   * @param address - A1-style cell address (e.g. "B1")
   * @returns The sparkline at the cell, or null if none
   */
  getAtCell(address: string): Promise<Sparkline | null>;
  /**
   * Get the sparkline at a specific cell.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @returns The sparkline at the cell, or null if none
   */
  getAtCell(row: number, col: number): Promise<Sparkline | null>;

  /**
   * List all sparklines in the worksheet.
   *
   * @returns Array of all sparklines
   */
  list(): Promise<Sparkline[]>;

  /**
   * Get a sparkline group by ID.
   *
   * @param groupId - Group identifier
   * @returns The sparkline group, or null if not found
   */
  getGroup(groupId: string): Promise<SparklineGroup | null>;

  /**
   * List all sparkline groups in the worksheet.
   *
   * @returns Array of all sparkline groups
   */
  listGroups(): Promise<SparklineGroup[]>;

  /**
   * Update a sparkline's settings.
   *
   * @param sparklineId - Sparkline identifier
   * @param updates - Partial sparkline properties to update
   * @throws `SPARKLINE_NOT_FOUND` when the ID is absent from this worksheet
   */
  update(sparklineId: string, updates: Partial<Sparkline>): Promise<void>;

  /**
   * Update a sparkline group's settings (applies to all members).
   *
   * @param groupId - Group identifier
   * @param updates - Partial group properties to update
   * @throws `SPARKLINE_GROUP_NOT_FOUND` when the group is absent
   */
  updateGroup(groupId: string, updates: Partial<SparklineGroup>): Promise<void>;

  /**
   * Remove a sparkline.
   *
   * @param sparklineId - Sparkline identifier
   * @throws `SPARKLINE_NOT_FOUND` when the ID is absent
   */
  remove(sparklineId: string): Promise<void>;

  /**
   * Remove a sparkline group and all its member sparklines.
   *
   * @param groupId - Group identifier
   * @throws `SPARKLINE_GROUP_NOT_FOUND` when the group is absent
   */
  removeGroup(groupId: string): Promise<void>;

  /**
   * Clear all sparklines whose cell falls within a range.
   *
   * @param range - A1-style range string or CellRange object
   */
  clearInRange(range: string | CellRange): Promise<void>;

  /**
   * Clear all sparklines in the worksheet.
   */
  clear(): Promise<void>;

  /**
   * Clear all sparklines in the worksheet.
   * @deprecated Use `clear()` instead.
   */
  clearAll(): Promise<void>;

  /**
   * Add a sparkline to a group.
   *
   * @param sparklineId - Sparkline identifier
   * @param groupId - Group identifier
   * @throws `SPARKLINE_NOT_FOUND` or `SPARKLINE_GROUP_NOT_FOUND` for stale IDs
   */
  addToGroup(sparklineId: string, groupId: string): Promise<void>;

  /**
   * Remove a sparkline from its group (becomes standalone).
   *
   * @param sparklineId - Sparkline identifier
   * @throws `SPARKLINE_NOT_FOUND` when the ID is absent; `SPARKLINE_GROUP_NOT_FOUND` for dangling membership
   */
  removeFromGroup(sparklineId: string): Promise<void>;

  /**
   * Ungroup all sparklines in a group (members become standalone).
   *
   * @param groupId - Group identifier
   * @returns IDs of sparklines that were ungrouped
   * @throws `SPARKLINE_GROUP_NOT_FOUND` when the group is absent
   */
  ungroupAll(groupId: string): Promise<string[]>;

  /**
   * Check if a cell has a sparkline.
   *
   * @param address - A1-style cell address (e.g. "B1")
   * @returns True if the cell has a sparkline
   */
  has(address: string): Promise<boolean>;
  /**
   * Check if a cell has a sparkline.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @returns True if the cell has a sparkline
   */
  has(row: number, col: number): Promise<boolean>;

  /**
   * Get the total number of sparklines on this sheet.
   *
   * @returns The count of sparklines
   */
  getCount(): Promise<number>;

  /**
   * Get sparklines whose data range intersects with a given range.
   *
   * @param range - A1-style range string or CellRange object
   * @returns Sparklines with data in the range
   */
  getWithDataInRange(range: string | CellRange): Promise<Sparkline[]>;
}
